import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnClaude, spawnClaudeSubprocess } from "./claude.js";
import { cleanupWorkDir, shallowClone } from "./git.js";
import { commentOnIssue, updateIssueStatus, uploadFileToIssue } from "./linear.js";
import { log, logTask, logTaskError } from "./logger.js";
import { recordMetric } from "./metrics.js";
import { buildReviewPrompt, getReviewAllowedTools } from "./review-prompt.js";
import {
  formatReviewFailure,
  formatReviewMerged,
  formatReviewNeedsChanges,
  formatReviewStarted,
  sendSlackNotification,
} from "./slack.js";
import type { Config, ReviewResult, ReviewTask, TeamStatuses } from "./types.js";
import { formatDuration, formatPhaseStats, runCommand, tailLines } from "./utils.js";

interface QueuedReview {
  task: ReviewTask;
  resolve: (result: ReviewResult) => void;
}

export interface ReviewOutcome {
  decision: "merged" | "needs_changes" | "unknown";
  reason?: string;
}

export function parseReviewOutcome(logFilePath: string): ReviewOutcome {
  if (!existsSync(logFilePath)) {
    return { decision: "unknown" };
  }

  try {
    const content = readFileSync(logFilePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    // Search from the end for the REVIEW_RESULT sentinel in stream-json output
    for (let i = lines.length - 1; i >= 0; i--) {
      let text: string;
      try {
        const obj = JSON.parse(lines[i]);
        // In stream-json, the result text appears in assistant messages or result
        if (obj.type === "assistant" && typeof obj.message?.content === "string") {
          text = obj.message.content;
        } else if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
          text = obj.message.content
            .filter((b: { type: string }) => b.type === "text")
            .map((b: { text: string }) => b.text)
            .join("\n");
        } else if (obj.type === "result" && typeof obj.result === "string") {
          text = obj.result;
        } else {
          continue;
        }
      } catch {
        continue;
      }

      const match = text.match(/REVIEW_RESULT:(MERGED|NEEDS_CHANGES)(?::(.+))?/);
      if (match) {
        if (match[1] === "MERGED") {
          return { decision: "merged" };
        }
        return { decision: "needs_changes", reason: match[2] || "No reason provided" };
      }
    }
  } catch {
    // File read or parse error
  }

  return { decision: "unknown" };
}

export class ReviewSpawner {
  private config: Config;
  private teamStatuses: TeamStatuses;
  private queue: QueuedReview[] = [];
  private running = 0;
  private activeProcesses: Set<AbortController> = new Set();
  private stopped = false;
  private activeWorkDirs = new Set<string>();

  constructor(config: Config, teamStatuses: TeamStatuses) {
    this.config = config;
    this.teamStatuses = teamStatuses;
  }

  async dispatch(task: ReviewTask): Promise<ReviewResult> {
    return new Promise((resolve) => {
      this.queue.push({ task, resolve });
      logTask(task.identifier, `Review queued (queue: ${this.queue.length}, running: ${this.running})`);
      this.processQueue();
    });
  }

  stop(): void {
    this.stopped = true;
    for (const ac of this.activeProcesses) {
      ac.abort();
    }
  }

  private processQueue(): void {
    while (this.running < this.config.reviewConcurrency && this.queue.length > 0 && !this.stopped) {
      const item = this.queue.shift();
      if (!item) break;
      this.running++;
      logTask(item.task.identifier, `Review started (queue: ${this.queue.length}, running: ${this.running})`);
      recordMetric({
        timestamp: "",
        event: "review_started",
        issueId: item.task.issueId,
        identifier: item.task.identifier,
        repoUrl: item.task.repoUrl,
        prUrl: item.task.prUrl,
      });
      this.runReview(item.task).then((result) => {
        this.running--;
        logTask(item.task.identifier, `Review finished (queue: ${this.queue.length}, running: ${this.running})`);
        item.resolve(result);
        this.processQueue();
      });
    }
  }

  private async runReview(task: ReviewTask): Promise<ReviewResult> {
    const workDir = `${this.config.workDir}/review-${task.identifier}-${Date.now()}`;
    this.activeWorkDirs.add(workDir);
    const abortController = new AbortController();
    this.activeProcesses.add(abortController);
    const taskStart = Date.now();

    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.config.reviewTimeoutMinutes * 60 * 1000);

    try {
      if (!existsSync(this.config.workDir)) {
        mkdirSync(this.config.workDir, { recursive: true });
      }

      await commentOnIssue(task.issueId, "Review critter picking up PR...");

      // 1. Clone repo
      await shallowClone(task.repoUrl, workDir, task.identifier, this.config.workDir);

      // Exclude critter temp files from git
      appendFileSync(`${workDir}/.git/info/exclude`, "\n.critter-*\n");

      // 2. Verify PR is still open
      const prState = await runCommand(
        "gh",
        ["pr", "view", String(task.prNumber), "--json", "state", "--jq", ".state"],
        { cwd: workDir },
      );

      const state = prState.stdout.trim();
      if (state === "MERGED") {
        logTask(task.identifier, "PR already merged, moving to Done");
        const doneId = this.teamStatuses[task.teamId]?.["Done"];
        if (doneId) {
          await updateIssueStatus(task.issueId, doneId);
        }
        await commentOnIssue(task.issueId, "PR was already merged.");
        recordMetric({
          timestamp: "",
          event: "review_completed",
          issueId: task.issueId,
          identifier: task.identifier,
          repoUrl: task.repoUrl,
          prUrl: task.prUrl,
          duration: Date.now() - taskStart,
          outcome: "merged",
        });
        return { success: true, merged: true };
      }
      if (state === "CLOSED") {
        throw new Error("PR is closed");
      }

      // 3. Resolve PR branch name and checkout
      const branchResult = await runCommand(
        "gh",
        ["pr", "view", String(task.prNumber), "--json", "headRefName", "--jq", ".headRefName"],
        { cwd: workDir },
      );
      task.prBranch = branchResult.stdout.trim();

      // Fetch the PR branch explicitly (shallow clone doesn't have it)
      const fetchResult = await runCommand(
        "git",
        ["fetch", "origin", `${task.prBranch}:${task.prBranch}`],
        { cwd: workDir },
      );
      if (fetchResult.code !== 0) {
        throw new Error(`Failed to fetch PR branch: ${fetchResult.stderr}`);
      }

      const checkoutResult = await runCommand(
        "git",
        ["checkout", task.prBranch],
        { cwd: workDir },
      );
      if (checkoutResult.code !== 0) {
        throw new Error(`Failed to checkout PR branch: ${checkoutResult.stderr}`);
      }

      await sendSlackNotification(
        this.config.slackWebhookUrl,
        formatReviewStarted(task.identifier, task.title, task.prUrl),
      );

      // 5. Spawn Claude review phase
      logTask(task.identifier, "Starting review phase");
      await commentOnIssue(task.issueId, "Reviewing PR...");

      const allowedTools = getReviewAllowedTools();
      const reviewStart = Date.now();

      const reviewResult = this.config.noTmux
        ? await spawnClaudeSubprocess(
            buildReviewPrompt(task),
            allowedTools,
            workDir,
            this.config.maxReviewTurns,
            task.identifier,
            "review",
            this.config.reviewModel,
            abortController.signal,
          )
        : await spawnClaude(
            buildReviewPrompt(task),
            allowedTools,
            workDir,
            this.config.maxReviewTurns,
            task.identifier,
            "review",
            this.config.tmuxSession,
            this.config.reviewModel,
            abortController.signal,
          );

      if (reviewResult.timedOut) {
        throw new Error("Timed out during review phase");
      }

      if (reviewResult.exitCode !== 0) {
        const errTail = tailLines(reviewResult.stderr || reviewResult.stdout, 20);
        throw new Error(`Review failed (exit ${reviewResult.exitCode}):\n${errTail}`);
      }

      const reviewDuration = Date.now() - reviewStart;
      const reviewStats = `Review completed in ${formatDuration(reviewDuration)}${formatPhaseStats(reviewResult)}`;
      logTask(task.identifier, reviewStats);
      await commentOnIssue(task.issueId, reviewStats);

      // 6. Parse review outcome
      const jsonLogFile = `${workDir}/.critter-output-review.json`;
      const outcome = parseReviewOutcome(jsonLogFile);

      // 7. Fallback: if no sentinel, check if PR was actually merged
      if (outcome.decision === "unknown") {
        const fallbackState = await runCommand(
          "gh",
          ["pr", "view", String(task.prNumber), "--json", "state", "--jq", ".state"],
          { cwd: workDir },
        );
        if (fallbackState.stdout.trim() === "MERGED") {
          outcome.decision = "merged";
        }
      }

      const totalDuration = formatDuration(Date.now() - taskStart);

      if (outcome.decision === "merged") {
        // Move to Done
        const doneId = this.teamStatuses[task.teamId]?.["Done"];
        if (doneId) {
          await updateIssueStatus(task.issueId, doneId);
        }
        await commentOnIssue(task.issueId, `PR merged by review critter (${totalDuration})`);
        await sendSlackNotification(
          this.config.slackWebhookUrl,
          formatReviewMerged(task.identifier, task.title, task.prUrl, totalDuration),
        );
        logTask(task.identifier, `Review complete — PR merged`);
        recordMetric({
          timestamp: "",
          event: "review_completed",
          issueId: task.issueId,
          identifier: task.identifier,
          repoUrl: task.repoUrl,
          prUrl: task.prUrl,
          duration: Date.now() - taskStart,
          outcome: "merged",
          numTurns: reviewResult.numTurns,
          inputTokens: reviewResult.inputTokens,
          outputTokens: reviewResult.outputTokens,
          cacheReadTokens: reviewResult.cacheReadTokens,
          costUsd: reviewResult.costUsd,
        });
        return { success: true, merged: true };
      }

      if (outcome.decision === "needs_changes") {
        // Move to Human Review
        const humanReviewId = this.teamStatuses[task.teamId]?.["Human Review"];
        if (humanReviewId) {
          await updateIssueStatus(task.issueId, humanReviewId);
        }
        await commentOnIssue(task.issueId, `Review critter requested changes: ${outcome.reason}`);
        await sendSlackNotification(
          this.config.slackWebhookUrl,
          formatReviewNeedsChanges(task.identifier, task.title, outcome.reason!, totalDuration),
        );
        logTask(task.identifier, `Review complete — needs changes: ${outcome.reason}`);
        recordMetric({
          timestamp: "",
          event: "review_completed",
          issueId: task.issueId,
          identifier: task.identifier,
          repoUrl: task.repoUrl,
          prUrl: task.prUrl,
          duration: Date.now() - taskStart,
          outcome: "needs_changes",
          numTurns: reviewResult.numTurns,
          inputTokens: reviewResult.inputTokens,
          outputTokens: reviewResult.outputTokens,
          cacheReadTokens: reviewResult.cacheReadTokens,
          costUsd: reviewResult.costUsd,
        });
        return { success: true, merged: false };
      }

      // Unknown outcome — treat as failure
      throw new Error("Could not determine review outcome (no REVIEW_RESULT sentinel and PR not merged)");
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logTaskError(task.identifier, error);

      const totalDuration = formatDuration(Date.now() - taskStart);

      // Move to Critter Failed
      const failedId = this.teamStatuses[task.teamId]?.["Critter Failed"];
      if (failedId) {
        try {
          await updateIssueStatus(task.issueId, failedId);
        } catch {
          logTaskError(task.identifier, "Failed to update status to Critter Failed");
        }
      }

      // Upload logs
      const { uploaded: attachmentUrls, fallbackExcerpts } = await uploadReviewLogs(task, workDir);

      try {
        let failComment = `Review critter failed after ${totalDuration}: ${error}`;
        if (attachmentUrls.length > 0) {
          failComment += `\n\nAttached logs:\n${attachmentUrls.map((a) => `- [${a.name}](${a.url})`).join("\n")}`;
        }
        if (fallbackExcerpts) {
          failComment += `\n\n<details><summary>Log excerpts</summary>\n\n${fallbackExcerpts}\n</details>`;
        }
        await commentOnIssue(task.issueId, failComment);
      } catch {
        logTaskError(task.identifier, "Failed to post error comment");
      }

      await sendSlackNotification(
        this.config.slackWebhookUrl,
        formatReviewFailure(task.identifier, task.title, error, totalDuration),
      );

      recordMetric({
        timestamp: "",
        event: "review_failed",
        issueId: task.issueId,
        identifier: task.identifier,
        repoUrl: task.repoUrl,
        prUrl: task.prUrl,
        duration: Date.now() - taskStart,
        error,
      });
      return { success: false, error };
    } finally {
      clearTimeout(timeout);
      this.activeProcesses.delete(abortController);
      this.activeWorkDirs.delete(workDir);
      cleanupWorkDir(workDir);
      logTask(task.identifier, "Cleaned up review work directory");
    }
  }
}

const MAX_LOG_SIZE = 5 * 1024 * 1024;

async function uploadReviewLogs(
  task: ReviewTask,
  workDir: string,
): Promise<{ uploaded: Array<{ name: string; url: string }>; fallbackExcerpts: string }> {
  const uploaded: Array<{ name: string; url: string }> = [];
  let fallbackExcerpts = "";

  const logFiles = [
    { path: `${workDir}/.critter-output-review.json`, name: `${task.identifier}-review-output.txt` },
    { path: `${workDir}/.critter-err-review.log`, name: `${task.identifier}-review-stderr.txt` },
  ];

  for (const file of logFiles) {
    if (!existsSync(file.path)) continue;
    try {
      let content = readFileSync(file.path);
      if (content.length === 0) continue;
      if (content.length > MAX_LOG_SIZE) {
        content = content.subarray(content.length - MAX_LOG_SIZE);
      }
      const url = await uploadFileToIssue(task.issueId, file.name, content, "text/plain", task.identifier);
      if (url) {
        uploaded.push({ name: file.name, url });
        logTask(task.identifier, `Uploaded ${file.name}`);
      } else if (file.name.endsWith("-stderr.txt")) {
        const excerpt = tailLines(content.toString("utf-8"), 50);
        fallbackExcerpts += `### ${file.name} (last 50 lines)\n\`\`\`\n${excerpt}\n\`\`\`\n\n`;
      }
    } catch (err) {
      logTaskError(task.identifier, `Failed to upload ${file.name}: ${err}`);
      if (file.name.endsWith("-stderr.txt")) {
        try {
          const raw = readFileSync(file.path, "utf-8");
          const excerpt = tailLines(raw, 50);
          fallbackExcerpts += `### ${file.name} (last 50 lines)\n\`\`\`\n${excerpt}\n\`\`\`\n\n`;
        } catch {
          // Can't even read the file — skip
        }
      }
    }
  }

  return { uploaded, fallbackExcerpts: fallbackExcerpts.trim() };
}
