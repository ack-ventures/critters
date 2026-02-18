import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnClaude, spawnClaudeSubprocess } from "./claude.js";
import {
  autoCommit,
  cleanupStaleWorkDirs,
  cleanupWorkDir,
  commitFile,
  createBranch,
  hasCommitsOnBranch,
  hasUncommittedChanges,
  shallowClone,
} from "./git.js";
import { triggerHook } from "./hooks.js";
import { commentOnIssue, updateIssueStatus, uploadFileToIssue } from "./linear.js";
import { log, logTask, logTaskError } from "./logger.js";
import { recordMetric } from "./metrics.js";
import {
  buildExecutionPrompt,
  buildPlanningPrompt,
  getExecutionAllowedTools,
  getPlanningAllowedTools,
} from "./prompt.js";
import { loadRepoConfig } from "./repo-config.js";
import { withRetry } from "./retry.js";
import {
  formatFailure,
  formatPlanningComplete,
  formatSuccess,
  formatTaskPickedUp,
  formatTimeoutWarning,
  sendSlackNotification,
} from "./slack.js";
import type { Config, CritterResult, CritterTask, SpawnResult, TeamStatuses } from "./types.js";
import { branchName, formatDuration, formatPhaseStats, runCommand, tailLines } from "./utils.js";

interface QueuedTask {
  task: CritterTask;
  resolve: (result: CritterResult) => void;
}

export class Spawner {
  private config: Config;
  private teamStatuses: TeamStatuses;
  private queue: QueuedTask[] = [];
  private running = 0;
  private activeProcesses: Set<AbortController> = new Set();
  private stopped = false;
  private cleanupInterval: Timer | null = null;
  private activeWorkDirs = new Set<string>();

  constructor(config: Config, teamStatuses: TeamStatuses) {
    this.config = config;
    this.teamStatuses = teamStatuses;
  }

  cleanupStale(): void {
    cleanupStaleWorkDirs(this.config.workDir, this.activeWorkDirs);
  }

  startPeriodicCleanup(): void {
    const intervalMs = 60 * 60 * 1000; // 1 hour
    this.cleanupInterval = setInterval(() => {
      log("Running periodic stale work directory cleanup");
      this.cleanupStale();
    }, intervalMs);
    // Allow the process to exit even if the interval is still active
    this.cleanupInterval.unref();
  }

  getActiveCount(): number {
    return this.running;
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  async dispatch(task: CritterTask): Promise<CritterResult> {
    return new Promise((resolve) => {
      this.queue.push({ task, resolve });
      logTask(task.identifier, `Task queued (queue: ${this.queue.length}, running: ${this.running})`);
      this.processQueue();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    for (const ac of this.activeProcesses) {
      ac.abort();
    }
  }

  private processQueue(): void {
    while (this.running < this.config.concurrency && this.queue.length > 0 && !this.stopped) {
      const item = this.queue.shift();
      if (!item) break;
      this.running++;
      logTask(item.task.identifier, `Task started (queue: ${this.queue.length}, running: ${this.running})`);
      recordMetric({
        timestamp: "",
        event: "task_started",
        issueId: item.task.issueId,
        identifier: item.task.identifier,
        repoUrl: item.task.repoUrl,
      });
      this.runTask(item.task).then((result) => {
        this.running--;
        logTask(item.task.identifier, `Task finished (queue: ${this.queue.length}, running: ${this.running})`);
        item.resolve(result);
        this.processQueue();
      });
    }
  }

  private async runTask(task: CritterTask): Promise<CritterResult> {
    const branch = branchName(task.identifier, task.title);
    const workDir = `${this.config.workDir}/${task.identifier}-${Date.now()}`;
    this.activeWorkDirs.add(workDir);
    const abortController = new AbortController();
    this.activeProcesses.add(abortController);
    const taskStart = Date.now();

    // Timeout for the entire task (both phases)
    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.config.timeoutMinutes * 60 * 1000);

    const warningTimeout = setTimeout(async () => {
      const elapsedMinutes = Math.round(this.config.timeoutMinutes * 0.8);
      await sendSlackNotification(
        this.config.slackWebhookUrl,
        formatTimeoutWarning(task.identifier, task.title, elapsedMinutes, this.config.timeoutMinutes),
      );
    }, this.config.timeoutMinutes * 0.8 * 60 * 1000);

    try {
      // Ensure work dir base exists
      if (!existsSync(this.config.workDir)) {
        mkdirSync(this.config.workDir, { recursive: true });
      }

      // Update status to In Progress
      const inProgressId = this.teamStatuses[task.teamId]?.["In Progress"];
      if (inProgressId) {
        await updateIssueStatus(task.issueId, inProgressId);
      }

      await commentOnIssue(task.issueId, "Cloning repo...");

      // 1. Clone repo
      await shallowClone(task.repoUrl, workDir, task.identifier, this.config.workDir);

      // 2. Create branch (or reuse existing remote branch for resume)
      let resuming = false;
      const lsRemote = await runCommand("git", ["ls-remote", "--heads", "origin", branch], { cwd: workDir });
      if (lsRemote.code === 0 && lsRemote.stdout.trim().length > 0) {
        // Branch exists remotely — check it out for resume
        logTask(task.identifier, `Branch ${branch} exists remotely, checking out for resume`);
        const fetchResult = await runCommand("git", ["fetch", "origin", branch], { cwd: workDir });
        if (fetchResult.code !== 0) {
          throw new Error(`Failed to fetch existing branch: ${fetchResult.stderr}`);
        }
        const checkoutResult = await runCommand("git", ["checkout", "-b", branch, `origin/${branch}`], { cwd: workDir });
        if (checkoutResult.code !== 0) {
          throw new Error(`Failed to checkout existing branch: ${checkoutResult.stderr}`);
        }
        resuming = true;
      } else {
        await createBranch(workDir, branch, task.identifier);
      }

      if (resuming) {
        await commentOnIssue(task.issueId, "Resuming from previous attempt (branch already exists)...");
      }

      // Exclude critter temp files from git so they don't trigger warnings
      appendFileSync(`${workDir}/.git/info/exclude`, "\n.critter-*\n");

      await sendSlackNotification(
        this.config.slackWebhookUrl,
        formatTaskPickedUp(task.identifier, task.title, task.repoUrl),
      );

      triggerHook(this.config, "onTaskStarted", {
        CRITTER_ISSUE_ID: task.issueId,
        CRITTER_IDENTIFIER: task.identifier,
        CRITTER_TITLE: task.title,
        CRITTER_REPO_URL: task.repoUrl,
        CRITTER_BRANCH: branch,
      }, task.identifier);

      // Ensure plans directory exists
      const plansDir = `${workDir}/critters/plans`;
      mkdirSync(plansDir, { recursive: true });

      // Load per-repo config if present
      const repoConfig = loadRepoConfig(workDir);
      if (repoConfig) {
        logTask(task.identifier, "Found per-repo .critters.yaml");
      }

      // 3. Phase 1: Planning
      await commentOnIssue(task.issueId, "Planning...");
      logTask(task.identifier, "Starting Phase 1: Planning");

      const planAllowedTools = getPlanningAllowedTools();
      logTask(task.identifier, `Planning phase allowed tools: ${planAllowedTools.join(", ")}`);

      const planStart = Date.now();
      const planResult = this.config.noTmux
        ? await spawnClaudeSubprocess(
            buildPlanningPrompt(task, repoConfig),
            planAllowedTools,
            workDir,
            this.config.maxPlanningTurns,
            task.identifier,
            task.title,
            "plan",
            this.config.planningModel,
            abortController.signal,
          )
        : await spawnClaude(
            buildPlanningPrompt(task, repoConfig),
            planAllowedTools,
            workDir,
            this.config.maxPlanningTurns,
            task.identifier,
            task.title,
            "plan",
            this.config.tmuxSession,
            this.config.planningModel,
            abortController.signal,
          );

      validatePhaseResult(planResult, "planning");

      // Verify plan file exists
      const planFile = `${workDir}/critters/plans/${task.identifier}.md`;
      if (!existsSync(planFile)) {
        throw new Error("Planning failed to produce a plan file");
      }

      const planDuration = Date.now() - planStart;
      const planStats = `Planning completed in ${formatDuration(planDuration)}${formatPhaseStats(planResult)}`;
      logTask(task.identifier, planStats);
      await commentOnIssue(task.issueId, planStats);
      await sendSlackNotification(
        this.config.slackWebhookUrl,
        formatPlanningComplete(task.identifier, task.title, planResult.numTurns, planResult.costUsd),
      );

      // Commit plan file to branch
      await commitFile(
        workDir,
        `critters/plans/${task.identifier}.md`,
        `[${task.identifier}] Add implementation plan`,
        task.identifier,
      );

      // 4. Phase 2: Execution
      await commentOnIssue(task.issueId, "Plan approved, executing...");
      logTask(task.identifier, "Starting Phase 2: Execution");

      const execStart = Date.now();
      const execAllowedTools = getExecutionAllowedTools(this.config, task, repoConfig);
      logTask(task.identifier, `Execution phase allowed tools: ${execAllowedTools.join(", ")}`);
      const execResult = this.config.noTmux
        ? await spawnClaudeSubprocess(
            buildExecutionPrompt(task, execAllowedTools, { resuming, repoConfig }),
            execAllowedTools,
            workDir,
            this.config.maxExecutionTurns,
            task.identifier,
            task.title,
            "exec",
            this.config.executionModel,
            abortController.signal,
          )
        : await spawnClaude(
            buildExecutionPrompt(task, execAllowedTools, { resuming, repoConfig }),
            execAllowedTools,
            workDir,
            this.config.maxExecutionTurns,
            task.identifier,
            task.title,
            "exec",
            this.config.tmuxSession,
            this.config.executionModel,
            abortController.signal,
          );

      validatePhaseResult(execResult, "execution");

      const execDuration = Date.now() - execStart;
      const execStats = `Execution completed in ${formatDuration(execDuration)}${formatPhaseStats(execResult)}`;
      logTask(task.identifier, execStats);
      await commentOnIssue(task.issueId, execStats);

      // 5. Check for commits, auto-commit if needed
      if (await hasUncommittedChanges(workDir)) {
        await autoCommit(workDir, task.identifier, `[${task.identifier}] Auto-commit remaining changes`);
      }

      if (!(await hasCommitsOnBranch(workDir, branch, task.identifier))) {
        throw new Error("Execution completed but no commits were made");
      }

      // 6. Detect PR
      const prUrl = await detectPr(workDir, branch, task.identifier);

      if (prUrl) {
        // Update to In Review
        const inReviewId = this.teamStatuses[task.teamId]?.["In Review"];
        if (inReviewId) {
          await updateIssueStatus(task.issueId, inReviewId);
        }
        const totalDuration = formatDuration(Date.now() - taskStart);
        logTask(task.identifier, `Completed in ${totalDuration}`);
        await commentOnIssue(task.issueId, `PR created: ${prUrl} (completed in ${totalDuration})`);
        await sendSlackNotification(
          this.config.slackWebhookUrl,
          formatSuccess(task.identifier, task.title, prUrl, totalDuration),
        );
        logTask(task.identifier, `Success — PR: ${prUrl}`);
        recordMetric({
          timestamp: "",
          event: "task_completed",
          issueId: task.issueId,
          identifier: task.identifier,
          repoUrl: task.repoUrl,
          duration: Date.now() - taskStart,
          prUrl,
          numTurns: (planResult.numTurns ?? 0) + (execResult.numTurns ?? 0),
          inputTokens: (planResult.inputTokens ?? 0) + (execResult.inputTokens ?? 0),
          outputTokens: (planResult.outputTokens ?? 0) + (execResult.outputTokens ?? 0),
          cacheReadTokens: (planResult.cacheReadTokens ?? 0) + (execResult.cacheReadTokens ?? 0),
          costUsd: (planResult.costUsd ?? 0) + (execResult.costUsd ?? 0),
        });
        triggerHook(this.config, "onPrCreated", {
          CRITTER_ISSUE_ID: task.issueId,
          CRITTER_IDENTIFIER: task.identifier,
          CRITTER_TITLE: task.title,
          CRITTER_REPO_URL: task.repoUrl,
          CRITTER_BRANCH: branch,
          CRITTER_PR_URL: prUrl,
        }, task.identifier);
        return { success: true, prUrl };
      } else {
        // Commits exist but no PR — still a partial success
        await commentOnIssue(task.issueId, "Execution completed with commits but no PR was created.");
        throw new Error("Execution completed but no PR was detected");
      }
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

      // Attempt to salvage partial progress
      const salvage = await salvagePartialProgress(workDir, branch, task.identifier, task.title);
      if (salvage.prUrl) {
        logTask(task.identifier, `Salvaged partial progress — draft PR: ${salvage.prUrl}`);
      } else if (salvage.branchPushed) {
        logTask(task.identifier, `Salvaged partial progress — branch pushed: ${branch}`);
      }

      // Upload logs and plan file as attachments for debugging
      const { uploaded: attachmentUrls, fallbackExcerpts } = await uploadFailureLogs(task, workDir);

      // Read checkpoint file if it exists
      let checkpointStatus = "";
      const checkpointFile = `${workDir}/critters/plans/${task.identifier}.checkpoint.md`;
      if (existsSync(checkpointFile)) {
        try {
          const checkpointContent = readFileSync(checkpointFile, "utf-8");
          const completed = (checkpointContent.match(/- \[x\]/gi) || []).length;
          const total = (checkpointContent.match(/- \[[ x]\]/gi) || []).length;
          if (total > 0) {
            checkpointStatus = `\n\nCheckpoint: completed ${completed}/${total} steps before failure.`;
          }
        } catch {
          // Best effort — don't fail the failure handler
        }
      }

      try {
        let failComment = `Critter failed after ${totalDuration}: ${error}`;
        if (salvage.prUrl) {
          failComment += `\n\nPartial progress was saved as a draft PR: ${salvage.prUrl}`;
        } else if (salvage.branchPushed) {
          failComment += `\n\nPartial commits were pushed to branch \`${branch}\`.`;
        }
        if (attachmentUrls.length > 0) {
          failComment += `\n\nAttached logs:\n${attachmentUrls.map((a) => `- [${a.name}](${a.url})`).join("\n")}`;
        }
        if (fallbackExcerpts) {
          failComment += `\n\n<details><summary>Log excerpts</summary>\n\n${fallbackExcerpts}\n</details>`;
        }
        failComment += checkpointStatus;
        await commentOnIssue(task.issueId, failComment);
      } catch {
        logTaskError(task.identifier, "Failed to post error comment");
      }

      await sendSlackNotification(
        this.config.slackWebhookUrl,
        formatFailure(task.identifier, task.title, error, totalDuration),
      );

      recordMetric({
        timestamp: "",
        event: "task_failed",
        issueId: task.issueId,
        identifier: task.identifier,
        repoUrl: task.repoUrl,
        duration: Date.now() - taskStart,
        error,
      });
      triggerHook(this.config, "onTaskFailed", {
        CRITTER_ISSUE_ID: task.issueId,
        CRITTER_IDENTIFIER: task.identifier,
        CRITTER_TITLE: task.title,
        CRITTER_REPO_URL: task.repoUrl,
        CRITTER_BRANCH: branch,
      }, task.identifier);
      return { success: false, error };
    } finally {
      clearTimeout(timeout);
      clearTimeout(warningTimeout);
      this.activeProcesses.delete(abortController);
      this.activeWorkDirs.delete(workDir);
      cleanupWorkDir(workDir);
      logTask(task.identifier, "Cleaned up work directory");
    }
  }
}

export async function salvagePartialProgress(
  workDir: string,
  branch: string,
  identifier: string,
  title: string,
): Promise<{ prUrl?: string; branchPushed?: boolean }> {
  try {
    // Auto-commit any uncommitted changes so they're not lost
    try {
      if (await hasUncommittedChanges(workDir)) {
        await autoCommit(workDir, identifier, `[${identifier}] Auto-commit in-progress work`);
      }
    } catch {
      logTaskError(identifier, "Salvage: auto-commit failed, continuing anyway");
    }

    // Check if there are any commits worth saving
    if (!(await hasCommitsOnBranch(workDir, branch, identifier))) {
      return {};
    }

    // Check if a PR already exists for this branch
    const listResult = await runCommand(
      "gh",
      ["pr", "list", "--head", branch, "--json", "url", "--limit", "1"],
      { cwd: workDir },
    );
    if (listResult.code === 0) {
      try {
        const prs = JSON.parse(listResult.stdout);
        if (prs.length > 0) {
          return { prUrl: prs[0].url, branchPushed: true };
        }
      } catch {
        // JSON parse failed — continue to push and create PR
      }
    }

    // Push the branch
    const pushResult = await runCommand("git", ["push", "origin", branch], { cwd: workDir });
    if (pushResult.code !== 0) {
      logTaskError(identifier, `Salvage: push failed: ${pushResult.stderr}`);
      return {};
    }

    // Create a draft PR
    const prResult = await runCommand(
      "gh",
      [
        "pr", "create", "--draft",
        "--head", branch,
        "--title", `[${identifier}] ${title} (partial)`,
        "--body", "Critter failed mid-execution. See Linear issue for details.",
      ],
      { cwd: workDir },
    );
    if (prResult.code === 0) {
      const prUrl = prResult.stdout.trim();
      return { prUrl, branchPushed: true };
    }

    // PR creation failed but branch was pushed
    logTaskError(identifier, `Salvage: draft PR creation failed: ${prResult.stderr}`);
    return { branchPushed: true };
  } catch (err) {
    logTaskError(identifier, `Salvage failed entirely: ${err}`);
    return {};
  }
}

function validatePhaseResult(
  result: SpawnResult,
  phaseName: string,
): void {
  if (result.timedOut) {
    throw new Error(`Timed out during ${phaseName} phase`);
  }

  if (result.exitCode !== 0) {
    const errTail = tailLines(result.stderr || result.stdout, 20);
    const label = phaseName.charAt(0).toUpperCase() + phaseName.slice(1);
    throw new Error(`${label} failed (exit ${result.exitCode}):\n${errTail}`);
  }
}

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB cap per file

async function uploadFailureLogs(
  task: CritterTask,
  workDir: string,
): Promise<{ uploaded: Array<{ name: string; url: string }>; fallbackExcerpts: string }> {
  const uploaded: Array<{ name: string; url: string }> = [];
  let fallbackExcerpts = "";

  const logFiles = [
    { path: `${workDir}/.critter-output-plan.json`, name: `${task.identifier}-plan-output.txt` },
    { path: `${workDir}/.critter-err-plan.log`, name: `${task.identifier}-plan-stderr.txt` },
    { path: `${workDir}/.critter-output-exec.json`, name: `${task.identifier}-exec-output.txt` },
    { path: `${workDir}/.critter-err-exec.log`, name: `${task.identifier}-exec-stderr.txt` },
    { path: `${workDir}/critters/plans/${task.identifier}.md`, name: `${task.identifier}-plan.md` },
    { path: `${workDir}/critters/plans/${task.identifier}.checkpoint.md`, name: `${task.identifier}-checkpoint.md` },
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
        // Upload returned null — add fallback excerpt for stderr files
        const excerpt = tailLines(content.toString("utf-8"), 50);
        fallbackExcerpts += `### ${file.name} (last 50 lines)\n\`\`\`\n${excerpt}\n\`\`\`\n\n`;
      }
    } catch (err) {
      logTaskError(task.identifier, `Failed to upload ${file.name}: ${err}`);
      // Add fallback excerpt for stderr files that threw during upload
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

async function detectPr(
  workDir: string,
  branch: string,
  identifier: string,
): Promise<string | null> {
  try {
    return await withRetry(
      async () => {
        const { code, stdout, stderr } = await runCommand(
          "gh",
          ["pr", "list", "--head", branch, "--json", "url", "--limit", "1"],
          { cwd: workDir },
        );

        if (code !== 0) {
          throw new Error(`gh pr list failed: ${stderr}`);
        }

        const prs = JSON.parse(stdout);
        if (prs.length > 0) {
          return prs[0].url as string;
        }
        throw new Error("PR not found yet");
      },
      {
        maxRetries: 4,
        baseDelayMs: 3000,
        maxDelayMs: 15000,
        onRetry: (_error, attempt, delayMs) => {
          logTask(identifier, `PR not found yet, retrying in ${Math.round(delayMs)}ms... (attempt ${attempt + 1}/4)`);
        },
      },
    );
  } catch {
    logTaskError(identifier, "PR not detected after 5 attempts");
    return null;
  }
}
