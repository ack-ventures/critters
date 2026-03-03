import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import type { CritterTypeConfig } from "./critter-type.js";
import {
  autoCommit,
  cleanupStaleWorkDirs,
  cleanupWorkDir,
  createBranch,
  hasCommitsOnBranch,
  hasUncommittedChanges,
  shallowClone,
} from "./git.js";
import { triggerHook } from "./hooks.js";
import { logTask, logTaskError } from "./logger.js";
import { recordMetric } from "./metrics.js";
import { loadRepoConfig } from "./repo-config.js";
import { getPhaseRunner } from "./runner/index.js";
import type { PhaseContext } from "./runner/types.js";
import {
  formatFailure,
  formatPlanningComplete,
  formatReviewFailure,
  formatReviewMerged,
  formatReviewNeedsChanges,
  formatReviewStarted,
  formatSuccess,
  formatTaskPickedUp,
  formatTimeoutWarning,
  sendSlackNotification,
} from "./slack.js";
import type { IssueTracker, TrackerTask } from "./tracker/types.js";
import type { Config, SpawnResult } from "./types.js";
import { branchName, extractOwnerRepo, formatDuration, formatPhaseStats, runCommand, tailLines } from "./utils.js";

interface QueuedTask {
  task: TrackerTask;
  critterType: CritterTypeConfig;
  resolve: (result: TaskResult) => void;
}

export interface TaskResult {
  success: boolean;
  prUrl?: string;
  merged?: boolean;
  error?: string;
}

export class UnifiedSpawner {
  private config: Config;
  private tracker: IssueTracker;
  /** Per-type queues */
  private queues = new Map<string, QueuedTask[]>();
  /** Per-type running counts */
  private running = new Map<string, number>();
  private activeProcesses = new Set<AbortController>();
  private stopped = false;
  private cleanupInterval: Timer | null = null;
  private activeWorkDirs = new Set<string>();

  constructor(config: Config, tracker: IssueTracker) {
    this.config = config;
    this.tracker = tracker;
  }

  cleanupStale(): void {
    cleanupStaleWorkDirs(this.config.workDir, this.activeWorkDirs);
  }

  startPeriodicCleanup(): void {
    const intervalMs = 60 * 60 * 1000;
    this.cleanupInterval = setInterval(() => {
      this.cleanupStale();
    }, intervalMs);
    this.cleanupInterval.unref();
  }

  getActiveCount(typeName?: string): number {
    if (typeName) return this.running.get(typeName) ?? 0;
    let total = 0;
    for (const count of this.running.values()) total += count;
    return total;
  }

  getQueueSize(typeName?: string): number {
    if (typeName) return this.queues.get(typeName)?.length ?? 0;
    let total = 0;
    for (const q of this.queues.values()) total += q.length;
    return total;
  }

  /** Get active/queued counts broken down by type */
  getPerTypeCounts(): Record<string, { active: number; queued: number }> {
    const result: Record<string, { active: number; queued: number }> = {};
    for (const ct of this.config.critterTypes) {
      result[ct.name] = {
        active: this.running.get(ct.name) ?? 0,
        queued: this.queues.get(ct.name)?.length ?? 0,
      };
    }
    return result;
  }

  async dispatch(task: TrackerTask, critterType: CritterTypeConfig): Promise<TaskResult> {
    return new Promise((resolve) => {
      if (!this.queues.has(critterType.name)) {
        this.queues.set(critterType.name, []);
      }
      this.queues.get(critterType.name)!.push({ task, critterType, resolve });
      logTask(task.identifier, `Task queued [${critterType.name}] (queue: ${this.getQueueSize(critterType.name)}, running: ${this.getActiveCount(critterType.name)})`);
      this.processQueue(critterType.name);
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

  private processQueue(typeName: string): void {
    const queue = this.queues.get(typeName) ?? [];
    const typeConfig = this.config.critterTypes.find((ct) => ct.name === typeName);
    if (!typeConfig) return;

    const currentRunning = this.running.get(typeName) ?? 0;

    while (currentRunning + (this.running.get(typeName) ?? 0) - currentRunning < typeConfig.concurrency
      && queue.length > 0
      && !this.stopped) {
      const runningNow = this.running.get(typeName) ?? 0;
      if (runningNow >= typeConfig.concurrency) break;

      const item = queue.shift();
      if (!item) break;
      this.running.set(typeName, runningNow + 1);
      logTask(item.task.identifier, `Task started [${typeName}] (queue: ${queue.length}, running: ${(this.running.get(typeName) ?? 0)})`);

      const metricEvent = typeName === "review" ? "review_started" : "task_started";
      recordMetric({
        timestamp: "",
        event: metricEvent,
        issueId: item.task.id,
        identifier: item.task.identifier,
        repoUrl: item.task.repoUrl,
        ...(item.task.prUrl ? { prUrl: item.task.prUrl } : {}),
        critterType: typeName,
      });

      this.runTask(item.task, item.critterType).then((result) => {
        this.running.set(typeName, (this.running.get(typeName) ?? 1) - 1);
        logTask(item.task.identifier, `Task finished [${typeName}] (queue: ${queue.length}, running: ${this.running.get(typeName) ?? 0})`);
        item.resolve(result);
        this.processQueue(typeName);
      });
    }
  }

  private async runTask(task: TrackerTask, critterType: CritterTypeConfig): Promise<TaskResult> {
    const isReviewType = critterType.name === "review";
    const workDirPrefix = isReviewType ? "review-" : "";
    const branch = critterType.repo.branch
      ? branchName(task.identifier, task.title)
      : "";
    const workDir = `${this.config.workDir}/${workDirPrefix}${task.identifier}-${Date.now()}`;
    this.activeWorkDirs.add(workDir);
    const abortController = new AbortController();
    this.activeProcesses.add(abortController);
    const taskStart = Date.now();

    // Timeout for the entire task
    const timeout = setTimeout(() => {
      abortController.abort();
    }, critterType.timeoutMinutes * 60 * 1000);

    // Warning at 80% timeout (only for create types)
    let warningTimeout: Timer | undefined;
    if (!isReviewType) {
      warningTimeout = setTimeout(async () => {
        const elapsedMinutes = Math.round(critterType.timeoutMinutes * 0.8);
        await sendSlackNotification(
          this.config.slackWebhookUrl,
          formatTimeoutWarning(task.identifier, task.title, elapsedMinutes, critterType.timeoutMinutes),
        );
      }, critterType.timeoutMinutes * 0.8 * 60 * 1000);
    }

    try {
      // Ensure work dir base exists
      if (!existsSync(this.config.workDir)) {
        mkdirSync(this.config.workDir, { recursive: true });
      }

      // Handle status update for create-type tasks
      if (critterType.name === "create") {
        await this.tracker.updateStatus(task.id, "In Progress", task.groupId);
        await this.tracker.comment(task.id, "Cloning repo...");
      } else if (isReviewType) {
        await this.tracker.comment(task.id, "Review critter picking up PR...");
      } else {
        // Custom type — update to first phase status or just comment
        await this.tracker.comment(task.id, `Critter [${critterType.name}] picking up task...`);
      }

      // 1. Clone repo
      if (critterType.repo.clone) {
        await shallowClone(task.repoUrl, workDir, task.identifier, this.config.workDir);
      }

      // 2. Create branch (if type requires it)
      let resuming = false;
      if (critterType.repo.branch && branch) {
        const lsRemote = await runCommand("git", ["ls-remote", "--heads", "origin", branch], { cwd: workDir });
        if (lsRemote.code === 0 && lsRemote.stdout.trim().length > 0) {
          logTask(task.identifier, `Branch ${branch} exists remotely, checking out for resume`);
          const fetchResult = await runCommand("git", ["fetch", "origin", `${branch}:refs/remotes/origin/${branch}`], { cwd: workDir });
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
          await this.tracker.comment(task.id, "Resuming from previous attempt (branch already exists)...");
        }
      }

      // Exclude critter temp files from git
      if (existsSync(`${workDir}/.git`)) {
        appendFileSync(`${workDir}/.git/info/exclude`, "\n.critter-*\n");
      }

      // Notify and trigger hooks
      if (critterType.name === "create") {
        await sendSlackNotification(
          this.config.slackWebhookUrl,
          formatTaskPickedUp(task.identifier, task.title, task.repoUrl),
        );
        triggerHook(this.config, "onTaskStarted", {
          CRITTER_ISSUE_ID: task.id,
          CRITTER_IDENTIFIER: task.identifier,
          CRITTER_TITLE: task.title,
          CRITTER_REPO_URL: task.repoUrl,
          CRITTER_BRANCH: branch,
        }, task.identifier);
      } else if (isReviewType) {
        await sendSlackNotification(
          this.config.slackWebhookUrl,
          formatReviewStarted(task.identifier, task.title, task.prUrl ?? ""),
        );
        triggerHook(this.config, "onReviewStarted", {
          CRITTER_ISSUE_ID: task.id,
          CRITTER_IDENTIFIER: task.identifier,
          CRITTER_TITLE: task.title,
          CRITTER_REPO_URL: task.repoUrl,
          CRITTER_BRANCH: task.prBranch ?? "",
          CRITTER_PR_URL: task.prUrl ?? "",
        }, task.identifier);
      }

      // Ensure plans directory exists (for create type)
      if (critterType.name === "create") {
        const plansDir = `${workDir}/critters/plans`;
        mkdirSync(plansDir, { recursive: true });
      }

      // Load per-repo config
      const repoConfig = existsSync(`${workDir}/.critters.yaml`)
        ? loadRepoConfig(workDir)
        : null;
      if (repoConfig) {
        logTask(task.identifier, "Found per-repo .critters.yaml");
      }

      // Run phases sequentially
      const phaseResults: SpawnResult[] = [];
      const phaseDataList: Record<string, unknown>[] = [];
      for (const phase of critterType.phases) {
        if (critterType.name === "create") {
          await this.tracker.comment(task.id, `${phase.name === "planning" ? "Planning" : "Plan approved, executing"}...`);
        }
        logTask(task.identifier, `Starting phase: ${phase.name}`);

        const phaseStart = Date.now();
        const runner = getPhaseRunner(phase);
        const ctx: PhaseContext = {
          task,
          critterType,
          phase,
          workDir,
          branch,
          tracker: this.tracker,
          config: this.config,
          repoConfig,
          signal: abortController.signal,
          resuming,
        };

        const phaseResult = await runner.run(ctx);
        phaseResults.push(phaseResult.spawn);
        phaseDataList.push(phaseResult.data);

        const phaseDuration = Date.now() - phaseStart;
        const phaseStats = `${phase.name} completed in ${formatDuration(phaseDuration)}${formatPhaseStats(phaseResult.spawn)}`;
        logTask(task.identifier, phaseStats);
        await this.tracker.comment(task.id, phaseStats);

        // Slack notification for planning completion
        if (phase.name === "planning" && critterType.name === "create") {
          await sendSlackNotification(
            this.config.slackWebhookUrl,
            formatPlanningComplete(task.identifier, task.title, phaseResult.spawn.numTurns, phaseResult.spawn.costUsd),
          );
        }

        // Handle review phase outcomes inline
        if (phase.prompt === "builtin:review") {
          return this.handleReviewOutcome(task, critterType, phaseResult.data, phaseResult.spawn, taskStart);
        }

        // Handle execution phase outcomes inline
        if (phase.prompt === "builtin:execution") {
          const prUrl = phaseResult.data.prUrl as string | null;
          if (prUrl) {
            return this.handleCreateSuccess(task, critterType, prUrl, branch, phaseResults, taskStart);
          }
          // Commits exist but no PR
          await this.tracker.comment(task.id, "Execution completed with commits but no PR was created.");
          throw new Error("Execution completed but no PR was detected");
        }
      }

      // Generic success (custom types)
      const totalDuration = formatDuration(Date.now() - taskStart);
      logTask(task.identifier, `Completed in ${totalDuration}`);

      const successOutcome = critterType.outcomes.success;
      if (successOutcome) {
        await this.tracker.updateStatus(task.id, successOutcome.status, task.groupId);
      }

      // Upload report from the last phase (generic runner writes .critter-report.md)
      const lastPhaseData = phaseDataList.length > 0 ? phaseDataList[phaseDataList.length - 1] : null;
      const responseText = lastPhaseData?.responseText as string | undefined;
      if (responseText) {
        // Upload as a .md attachment
        const filename = `${task.identifier}-${critterType.name}.md`;
        const mdContent = `# ${task.identifier}: ${task.title}\n\n**Type**: ${critterType.name}  \n**Duration**: ${totalDuration}\n\n---\n\n${responseText}`;
        const url = await this.tracker.uploadAttachment(
          task.id, filename, Buffer.from(mdContent), "text/markdown", task.identifier,
        );

        // Post as inline comment too
        const MAX_COMMENT_LENGTH = 10000;
        let comment = responseText.length > MAX_COMMENT_LENGTH
          ? `${responseText.slice(0, MAX_COMMENT_LENGTH)}\n\n*(truncated)*`
          : responseText;
        if (url) {
          comment += `\n\n[Full report](${url})`;
        }
        await this.tracker.comment(task.id, comment);
      } else {
        await this.tracker.comment(task.id, `Critter [${critterType.name}] completed in ${totalDuration}`);
      }

      const totalCost = phaseResults.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      const totalTurns = phaseResults.reduce((sum, r) => sum + (r.numTurns ?? 0), 0);
      recordMetric({
        timestamp: "",
        event: "task_completed",
        issueId: task.id,
        identifier: task.identifier,
        repoUrl: task.repoUrl,
        duration: Date.now() - taskStart,
        numTurns: totalTurns,
        costUsd: totalCost,
        critterType: critterType.name,
      });

      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logTaskError(task.identifier, error);

      const totalDuration = formatDuration(Date.now() - taskStart);

      // Move to failure status
      const failureOutcome = critterType.outcomes.failure;
      if (failureOutcome) {
        try {
          await this.tracker.updateStatus(task.id, failureOutcome.status, task.groupId);
        } catch {
          logTaskError(task.identifier, `Failed to update status to ${failureOutcome.status}`);
        }
      }

      // Salvage partial progress (for create type)
      let salvageInfo = "";
      if (critterType.name === "create" && critterType.repo.branch && branch) {
        const salvage = await salvagePartialProgress(workDir, branch, task.identifier, task.title, task.repoUrl);
        if (salvage.prUrl) {
          salvageInfo = `\n\nPartial progress was saved as a draft PR: ${salvage.prUrl}`;
          logTask(task.identifier, `Salvaged partial progress — draft PR: ${salvage.prUrl}`);
        } else if (salvage.branchPushed) {
          salvageInfo = `\n\nPartial commits were pushed to branch \`${branch}\`.`;
          logTask(task.identifier, `Salvaged partial progress — branch pushed: ${branch}`);
        }
      }

      // Upload logs
      const { uploaded: attachmentUrls, fallbackExcerpts } = await this.uploadFailureLogs(task, critterType, workDir);

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
          // Best effort
        }
      }

      try {
        let failComment = `${isReviewType ? "Review critter" : "Critter"} failed after ${totalDuration}: ${error}`;
        failComment += salvageInfo;
        if (attachmentUrls.length > 0) {
          failComment += `\n\nAttached logs:\n${attachmentUrls.map((a) => `- [${a.name}](${a.url})`).join("\n")}`;
        }
        if (fallbackExcerpts) {
          failComment += `\n\n<details><summary>Log excerpts</summary>\n\n${fallbackExcerpts}\n</details>`;
        }
        failComment += checkpointStatus;
        await this.tracker.comment(task.id, failComment);
      } catch {
        logTaskError(task.identifier, "Failed to post error comment");
      }

      // Slack notification
      if (isReviewType) {
        await sendSlackNotification(
          this.config.slackWebhookUrl,
          formatReviewFailure(task.identifier, task.title, error, totalDuration),
        );
      } else {
        await sendSlackNotification(
          this.config.slackWebhookUrl,
          formatFailure(task.identifier, task.title, error, totalDuration),
        );
      }

      const metricEvent = isReviewType ? "review_failed" : "task_failed";
      recordMetric({
        timestamp: "",
        event: metricEvent,
        issueId: task.id,
        identifier: task.identifier,
        repoUrl: task.repoUrl,
        ...(task.prUrl ? { prUrl: task.prUrl } : {}),
        duration: Date.now() - taskStart,
        error,
        critterType: critterType.name,
      });

      if (isReviewType) {
        // No hook for review failure currently
      } else {
        triggerHook(this.config, "onTaskFailed", {
          CRITTER_ISSUE_ID: task.id,
          CRITTER_IDENTIFIER: task.identifier,
          CRITTER_TITLE: task.title,
          CRITTER_REPO_URL: task.repoUrl,
          CRITTER_BRANCH: branch,
        }, task.identifier);
      }

      return { success: false, error };
    } finally {
      clearTimeout(timeout);
      if (warningTimeout) clearTimeout(warningTimeout);
      this.activeProcesses.delete(abortController);
      this.activeWorkDirs.delete(workDir);
      cleanupWorkDir(workDir);
      logTask(task.identifier, "Cleaned up work directory");
    }
  }

  private async handleCreateSuccess(
    task: TrackerTask,
    critterType: CritterTypeConfig,
    prUrl: string,
    branch: string,
    phaseResults: SpawnResult[],
    taskStart: number,
  ): Promise<TaskResult> {
    const successOutcome = critterType.outcomes.success;
    if (successOutcome) {
      await this.tracker.updateStatus(task.id, successOutcome.status, task.groupId);
    }

    const totalDuration = formatDuration(Date.now() - taskStart);
    logTask(task.identifier, `Completed in ${totalDuration}`);
    await this.tracker.comment(task.id, `PR created: ${prUrl} (completed in ${totalDuration})`);
    await sendSlackNotification(
      this.config.slackWebhookUrl,
      formatSuccess(task.identifier, task.title, prUrl, totalDuration),
    );
    logTask(task.identifier, `Success — PR: ${prUrl}`);

    const totalTurns = phaseResults.reduce((sum, r) => sum + (r.numTurns ?? 0), 0);
    const totalInput = phaseResults.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0);
    const totalOutput = phaseResults.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0);
    const totalCache = phaseResults.reduce((sum, r) => sum + (r.cacheReadTokens ?? 0), 0);
    const totalCost = phaseResults.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

    recordMetric({
      timestamp: "",
      event: "task_completed",
      issueId: task.id,
      identifier: task.identifier,
      repoUrl: task.repoUrl,
      duration: Date.now() - taskStart,
      prUrl,
      numTurns: totalTurns,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCache,
      costUsd: totalCost,
      critterType: critterType.name,
    });

    triggerHook(this.config, "onPrCreated", {
      CRITTER_ISSUE_ID: task.id,
      CRITTER_IDENTIFIER: task.identifier,
      CRITTER_TITLE: task.title,
      CRITTER_REPO_URL: task.repoUrl,
      CRITTER_BRANCH: branch,
      CRITTER_PR_URL: prUrl,
    }, task.identifier);

    return { success: true, prUrl };
  }

  private async handleReviewOutcome(
    task: TrackerTask,
    critterType: CritterTypeConfig,
    data: Record<string, unknown>,
    spawn: SpawnResult,
    taskStart: number,
  ): Promise<TaskResult> {
    const decision = data.reviewDecision as string;
    const reason = data.reviewReason as string | undefined;
    const totalDuration = formatDuration(Date.now() - taskStart);

    if (decision === "merged" || data.alreadyMerged) {
      const mergedOutcome = critterType.outcomes.merged;
      if (mergedOutcome) {
        await this.tracker.updateStatus(task.id, mergedOutcome.status, task.groupId);
      }
      await this.tracker.comment(task.id, `PR merged by review critter (${totalDuration})`);
      await sendSlackNotification(
        this.config.slackWebhookUrl,
        formatReviewMerged(task.identifier, task.title, task.prUrl ?? "", totalDuration),
      );
      logTask(task.identifier, `Review complete — PR merged`);
      recordMetric({
        timestamp: "",
        event: "review_completed",
        issueId: task.id,
        identifier: task.identifier,
        repoUrl: task.repoUrl,
        prUrl: task.prUrl,
        duration: Date.now() - taskStart,
        outcome: "merged",
        numTurns: spawn.numTurns,
        inputTokens: spawn.inputTokens,
        outputTokens: spawn.outputTokens,
        cacheReadTokens: spawn.cacheReadTokens,
        costUsd: spawn.costUsd,
        critterType: critterType.name,
      });
      triggerHook(this.config, "onMerged", {
        CRITTER_ISSUE_ID: task.id,
        CRITTER_IDENTIFIER: task.identifier,
        CRITTER_TITLE: task.title,
        CRITTER_REPO_URL: task.repoUrl,
        CRITTER_BRANCH: task.prBranch ?? "",
        CRITTER_PR_URL: task.prUrl ?? "",
      }, task.identifier);
      return { success: true, merged: true };
    }

    if (decision === "needs_changes") {
      const needsChangesOutcome = critterType.outcomes.needsChanges;
      if (needsChangesOutcome) {
        await this.tracker.updateStatus(task.id, needsChangesOutcome.status, task.groupId);
      }
      await this.tracker.comment(task.id, `Review critter requested changes: ${reason}`);
      await sendSlackNotification(
        this.config.slackWebhookUrl,
        formatReviewNeedsChanges(task.identifier, task.title, reason ?? "No reason provided", totalDuration),
      );
      logTask(task.identifier, `Review complete — needs changes: ${reason}`);
      recordMetric({
        timestamp: "",
        event: "review_completed",
        issueId: task.id,
        identifier: task.identifier,
        repoUrl: task.repoUrl,
        prUrl: task.prUrl,
        duration: Date.now() - taskStart,
        outcome: "needs_changes",
        numTurns: spawn.numTurns,
        inputTokens: spawn.inputTokens,
        outputTokens: spawn.outputTokens,
        cacheReadTokens: spawn.cacheReadTokens,
        costUsd: spawn.costUsd,
        critterType: critterType.name,
      });
      triggerHook(this.config, "onNeedsChanges", {
        CRITTER_ISSUE_ID: task.id,
        CRITTER_IDENTIFIER: task.identifier,
        CRITTER_TITLE: task.title,
        CRITTER_REPO_URL: task.repoUrl,
        CRITTER_BRANCH: task.prBranch ?? "",
        CRITTER_PR_URL: task.prUrl ?? "",
      }, task.identifier);
      return { success: true, merged: false };
    }

    // Unknown outcome — treat as failure
    throw new Error("Could not determine review outcome (no REVIEW_RESULT sentinel and PR not merged)");
  }

  private async uploadFailureLogs(
    task: TrackerTask,
    critterType: CritterTypeConfig,
    workDir: string,
  ): Promise<{ uploaded: Array<{ name: string; url: string }>; fallbackExcerpts: string }> {
    const uploaded: Array<{ name: string; url: string }> = [];
    let fallbackExcerpts = "";
    const MAX_LOG_SIZE = 5 * 1024 * 1024;

    // Build log file list based on phases
    const logFiles: Array<{ path: string; name: string }> = [];
    for (const phase of critterType.phases) {
      const phaseTag = phase.name === "planning" ? "plan" : phase.name === "execution" ? "exec" : phase.name;
      logFiles.push(
        { path: `${workDir}/.critter-output-${phaseTag}.json`, name: `${task.identifier}-${phaseTag}-output.txt` },
        { path: `${workDir}/.critter-err-${phaseTag}.log`, name: `${task.identifier}-${phaseTag}-stderr.txt` },
      );
    }
    // Always include plan and checkpoint files
    logFiles.push(
      { path: `${workDir}/critters/plans/${task.identifier}.md`, name: `${task.identifier}-plan.md` },
      { path: `${workDir}/critters/plans/${task.identifier}.checkpoint.md`, name: `${task.identifier}-checkpoint.md` },
    );

    for (const file of logFiles) {
      if (!existsSync(file.path)) continue;
      try {
        let content = readFileSync(file.path);
        if (content.length === 0) continue;
        if (content.length > MAX_LOG_SIZE) {
          content = content.subarray(content.length - MAX_LOG_SIZE);
        }
        const url = await this.tracker.uploadAttachment(task.id, file.name, content, "text/plain", task.identifier);
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
}

export async function salvagePartialProgress(
  workDir: string,
  branch: string,
  identifier: string,
  title: string,
  repoUrl?: string,
): Promise<{ prUrl?: string; branchPushed?: boolean }> {
  try {
    const ownerRepo = repoUrl ? extractOwnerRepo(repoUrl) : null;
    const repoArgs = ownerRepo ? ["--repo", ownerRepo] : [];
    try {
      if (await hasUncommittedChanges(workDir)) {
        await autoCommit(workDir, identifier, `[${identifier}] Auto-commit in-progress work`);
      }
    } catch {
      logTaskError(identifier, "Salvage: auto-commit failed, continuing anyway");
    }

    if (!(await hasCommitsOnBranch(workDir, branch, identifier))) {
      return {};
    }

    // Check if a PR already exists
    const listResult = await runCommand(
      "gh",
      ["pr", "list", "--head", branch, "--json", "url", "--limit", "1", ...repoArgs],
      { cwd: workDir },
    );
    if (listResult.code === 0) {
      try {
        const prs = JSON.parse(listResult.stdout);
        if (prs.length > 0) {
          return { prUrl: prs[0].url, branchPushed: true };
        }
      } catch {
        // JSON parse failed
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
        ...repoArgs,
      ],
      { cwd: workDir },
    );
    if (prResult.code === 0) {
      return { prUrl: prResult.stdout.trim(), branchPushed: true };
    }

    logTaskError(identifier, `Salvage: draft PR creation failed: ${prResult.stderr}`);
    return { branchPushed: true };
  } catch (err) {
    logTaskError(identifier, `Salvage failed entirely: ${err}`);
    return {};
  }
}
