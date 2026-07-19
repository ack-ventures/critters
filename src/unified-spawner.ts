import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolvePhaseMcpConfig } from "./cli/mcp.js";
import { getCliAdapter } from "./cli/registry.js";
import type { CritterTypeConfig } from "./critter-type.js";
import {
  cleanupStaleWorkDirs,
  cleanupWorkDir,
  createBranch,
  shallowClone,
} from "./git.js";
import { triggerHook } from "./hooks.js";
import { extractPhaseResult, phaseFileTag } from "./log-resolver.js";
import { formatError, log, logTask, logTaskError } from "./logger.js";
import { recordMetric } from "./metrics.js";
import { loadRepoConfig } from "./repo-config.js";
import { updatePrWithPlan } from "./runner/execution.js";
import { getPhaseRunner } from "./runner/index.js";
import type { PhaseContext } from "./runner/types.js";
import {
  formatCostAlert,
  formatCostBudgetExceeded,
  formatFailure,
  formatPlanningComplete,
  formatReviewFailure,
  formatReviewMerged,
  formatReviewNeedsChanges,
  formatReviewStarted,
  formatSuccess,
  formatTaskPickedUp,
  formatTimeoutWarning,
  SlackNotifier,
} from "./slack.js";
import { applyOutcome, type TaskResult } from "./task-outcome.js";
import { isTransientTaskError, withCappedJitter } from "./task-retry.js";
import { addPrTimeoutComment, buildLogFileList, salvagePartialProgress } from "./task-salvage.js";
import type { IssueTracker, TrackerTask } from "./tracker/types.js";
import type { ActiveCritterDetail, Config, QueuedCritterDetail, SpawnResult } from "./types.js";
import { aggregatePhaseResults, branchName, formatDuration, formatPhaseStats, getTracker, runCommand, sanitizeIdentifier, shortRepoName, tailLines, truncateComment } from "./utils.js";
import { VERSION } from "./version.js";

interface QueuedTask {
  task: TrackerTask;
  critterType: CritterTypeConfig;
  resolve: (result: TaskResult) => void;
  enqueuedAt: number;
}

export class UnifiedSpawner {
  private config: Config;
  private trackers: Map<string, IssueTracker>;
  /** Per-type queues */
  private queues = new Map<string, QueuedTask[]>();
  /** Per-type running counts */
  private running = new Map<string, number>();
  private activeProcesses = new Set<AbortController>();
  private abortControllers = new Map<string, AbortController>();
  private stopped = false;
  private cleanupInterval: Timer | null = null;
  private activeWorkDirs = new Set<string>();
  private activeCritterMap = new Map<string, ActiveCritterDetail>();
  private slackNotifier: SlackNotifier;
  private retryCounts = new Map<string, number>();

  constructor(config: Config, trackers: Map<string, IssueTracker>) {
    this.config = config;
    this.trackers = trackers;
    this.slackNotifier = new SlackNotifier({
      webhookUrl: config.slack.webhookUrl,
      botToken: config.slack.botToken,
      channel: config.slack.channel,
    });
  }

  updateConfig(config: Config, trackers: Map<string, IssueTracker>): void {
    this.config = config;
    this.trackers = trackers;
    this.drainRemovedTypeQueues(config);
  }

  private drainRemovedTypeQueues(config: Config): void {
    const activeTypeNames = new Set(config.critterTypes.map((ct) => ct.name));
    for (const [typeName, queue] of this.queues.entries()) {
      if (!activeTypeNames.has(typeName) && queue.length > 0) {
        log(`Draining ${queue.length} queued tasks for removed type "${typeName}"`);
        for (const item of queue) {
          item.resolve({ success: false, error: `Critter type "${typeName}" was removed from config` });
        }
        this.queues.delete(typeName);
      }
    }
  }

  private getTracker(critterType: CritterTypeConfig): IssueTracker {
    return getTracker(critterType, this.config, this.trackers);
  }

  isTransientError(error: string): boolean {
    return isTransientTaskError(error);
  }

  private shouldAutoRetry(taskId: string, error: string, timedOut: boolean): boolean {
    const autoRetry = this.config.autoRetry;
    if (!autoRetry) return false;
    if (timedOut) return false;
    if (this.stopped) return false;
    const retryCount = this.retryCounts.get(taskId) ?? 0;
    if (retryCount >= autoRetry.maxRetries) return false;
    return this.isTransientError(error);
  }

  cleanupStale(): void {
    // No active/queued guard: cleanupStaleWorkDirs already excludes every dir
    // in activeWorkDirs and only removes dirs older than maxAgeMinutes, so it
    // is safe to run even while critters are busy.
    const maxAgeMinutes = this.config.limits.cleanupStaleMinutes
      ?? Math.max(...this.config.critterTypes.map(ct => ct.timeoutMinutes)) + 30;
    cleanupStaleWorkDirs(this.config.daemon.workDir, this.activeWorkDirs, maxAgeMinutes);
  }

  startPeriodicCleanup(): void {
    const intervalMs = (this.config.limits.cleanupIntervalMinutes ?? 60) * 60 * 1000;
    this.cleanupInterval = setInterval(() => {
      log("Running periodic work directory cleanup...");
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

  getActiveWorkDirs(): Set<string> {
    return new Set(this.activeWorkDirs);
  }

  getActiveDetails(): ActiveCritterDetail[] {
    return Array.from(this.activeCritterMap.values());
  }

  getQueuedDetails(): QueuedCritterDetail[] {
    const result: QueuedCritterDetail[] = [];
    for (const [typeName, queue] of this.queues.entries()) {
      for (const item of queue) {
        result.push({
          identifier: item.task.identifier,
          title: item.task.title,
          critterType: typeName,
          repo: shortRepoName(item.task.repoUrl),
          issueUrl: item.task.issueUrl,
          enqueuedAt: item.enqueuedAt,
        });
      }
    }
    return result;
  }

  async dispatch(task: TrackerTask, critterType: CritterTypeConfig): Promise<TaskResult> {
    return new Promise((resolve) => {
      const queue = this.queues.get(critterType.name) ?? [];
      this.queues.set(critterType.name, queue);
      queue.push({ task, critterType, resolve, enqueuedAt: Date.now() });
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
    // Drain queued-but-unstarted tasks so their dispatch promise settles;
    // otherwise the caller awaits forever and the issue stays in claimStatus.
    for (const queue of this.queues.values()) {
      while (queue.length > 0) {
        const item = queue.shift();
        item?.resolve({ success: false, error: "Daemon stopping" });
      }
    }
  }

  private processQueue(typeName: string): void {
    const queue = this.queues.get(typeName) ?? [];
    const typeConfig = this.config.critterTypes.find((ct) => ct.name === typeName);
    if (!typeConfig) return;

    while (queue.length > 0 && !this.stopped) {
      const runningNow = this.running.get(typeName) ?? 0;
      if (runningNow >= typeConfig.concurrency) break;

      const item = queue.shift();
      if (!item) break;
      this.running.set(typeName, runningNow + 1);
      logTask(item.task.identifier, `Task started [${typeName}] (queue: ${queue.length}, running: ${(this.running.get(typeName) ?? 0)})`);
      logTask(item.task.identifier, `Repo: ${shortRepoName(item.task.repoUrl)} | Branch: ${branchName(item.task.identifier, item.task.title, this.config.daemon.branchPrefix)}`);
      // Note: activeCritterMap registration happens at the top of runTask so
      // that each (re)attempt re-registers itself (see runTaskWithRetry).

      const metricEvent = typeName === "review" ? "review_started" : "task_started";
      recordMetric({
        timestamp: "",
        event: metricEvent,
        issueId: item.task.id,
        identifier: item.task.identifier,
        title: item.task.title,
        repoUrl: item.task.repoUrl,
        ...(item.task.prUrl ? { prUrl: item.task.prUrl } : {}),
        ...(item.task.issueUrl ? { issueUrl: item.task.issueUrl } : {}),
        critterType: typeName,
      });

      this.runTaskWithRetry(item.task, item.critterType)
        .catch((err) => {
          logTaskError(item.task.identifier, `Unhandled error in task pipeline: ${err}`);
          return { success: false, error: String(err) } as TaskResult;
        })
        .then((result) => {
          this.running.set(typeName, (this.running.get(typeName) ?? 1) - 1);
          logTask(item.task.identifier, `Task finished [${typeName}] (queue: ${queue.length}, running: ${this.running.get(typeName) ?? 0})`);
          item.resolve(result);
          this.processQueue(typeName);
        });
    }
  }

  private async runTask(task: TrackerTask, critterType: CritterTypeConfig): Promise<TaskResult> {
    // Register (or re-register on retry) this attempt in the active map. The
    // finally block deletes it after every attempt, so runTaskWithRetry's
    // re-invocation would otherwise leave the task invisible/unkillable.
    this.activeCritterMap.set(task.id, {
      identifier: task.identifier,
      title: task.title,
      phase: critterType.phases[0]?.name ?? critterType.name,
      repo: shortRepoName(task.repoUrl),
      branch: task.prBranch ?? branchName(task.identifier, task.title, this.config.daemon.branchPrefix),
      startedAt: Date.now(),
      prUrl: task.prUrl,
      issueUrl: task.issueUrl,
      timeoutMinutes: critterType.timeoutMinutes,
      critterType: critterType.name,
    });

    const tracker = this.getTracker(critterType);
    const isReviewType = critterType.name === "review";
    const workDirPrefix = isReviewType ? "review-" : "";
    const branch = critterType.repo.branch
      ? branchName(task.identifier, task.title, this.config.daemon.branchPrefix)
      : "";
    const workDir = `${this.config.daemon.workDir}/${workDirPrefix}${sanitizeIdentifier(task.identifier)}-${Date.now()}`;
    this.activeWorkDirs.add(workDir);
    const detail = this.activeCritterMap.get(task.id);
    if (detail) detail.workDir = workDir;
    const abortController = new AbortController();
    this.activeProcesses.add(abortController);
    this.abortControllers.set(task.id, abortController);
    const taskStart = Date.now();

    // Timeout for the entire task
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, critterType.timeoutMinutes * 60 * 1000);

    // Warning at 80% timeout (only for create types)
    let warningTimeout: Timer | undefined;
    if (!isReviewType) {
      warningTimeout = setTimeout(async () => {
        const elapsedMinutes = Math.round(critterType.timeoutMinutes * 0.8);
        await this.slackNotifier.notify(
          task.id,
          formatTimeoutWarning(task.identifier, task.title, elapsedMinutes, critterType.timeoutMinutes),
          task.identifier,
        );
      }, critterType.timeoutMinutes * 0.8 * 60 * 1000);
    }

    const phaseResults: SpawnResult[] = [];

    // Resolve effective cost budget
    const effectiveCostBudget = critterType.costBudget ?? this.config.limits.costBudget;
    // Set cost budget on active detail for dashboard display
    const detail2 = this.activeCritterMap.get(task.id);
    if (detail2) detail2.costBudget = effectiveCostBudget;
    let costBudgetExceeded = false;
    let costBudgetSpent = 0;
    let costBudgetLimit = 0;
    let costBudgetPhase = "";

    try {
      // Ensure work dir base exists
      if (!existsSync(this.config.daemon.workDir)) {
        mkdirSync(this.config.daemon.workDir, { recursive: true });
      }

      // Post picking-up comments
      if (critterType.name === "create") {
        if (!critterType.quietComments) {
          await tracker.comment(task.id, "Cloning repo...");
        }
      } else if (isReviewType) {
        if (!critterType.quietComments) {
          await tracker.comment(task.id, `Review critter (${critterType.phases[0].model}) picking up PR...`);
        }
      } else {
        if (!critterType.quietComments) {
          await tracker.comment(task.id, `Critter [${critterType.name}] (${critterType.phases[0].model}) picking up task...`);
        }
      }

      // 1. Clone repo
      if (critterType.repo.clone) {
        // Resolve localPath: per-repo config takes precedence, then critter type default
        const repoLocalPath = Object.values(this.config.repos).find((r) => r.url === task.repoUrl)?.localPath ?? critterType.repo.localPath;
        await shallowClone(task.repoUrl, workDir, task.identifier, this.config.daemon.workDir, critterType.repo.depth ?? 1, repoLocalPath, this.config.limits.minDiskSpaceMb, task.baseBranch);
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
          await createBranch(workDir, branch, task.identifier, task.baseBranch);
        }

        if (resuming && !critterType.quietComments) {
          await tracker.comment(task.id, "Resuming from previous attempt (branch already exists)...");
        }
      }

      // Exclude critter temp files from git
      if (existsSync(`${workDir}/.git`)) {
        let excludes = "\n.critter-*\n";
        if (!critterType.repo.commitPlans) {
          excludes += "critters/\n";
        }
        appendFileSync(`${workDir}/.git/info/exclude`, excludes);
      }

      // Notify and trigger hooks
      if (critterType.name === "create") {
        await this.slackNotifier.notify(
          task.id,
          formatTaskPickedUp(task.identifier, task.title, task.repoUrl),
          task.identifier,
        );
        triggerHook(this.config, "onTaskStarted", {
          CRITTER_ISSUE_ID: task.id,
          CRITTER_IDENTIFIER: task.identifier,
          CRITTER_TITLE: task.title,
          CRITTER_REPO_URL: task.repoUrl,
          CRITTER_BRANCH: branch,
        }, task.identifier);
      } else if (isReviewType) {
        await this.slackNotifier.notify(
          task.id,
          formatReviewStarted(task.identifier, task.title, task.prUrl ?? ""),
          task.identifier,
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

      // Ensure plans directory exists
      mkdirSync(`${workDir}/critters/plans`, { recursive: true });

      // Load per-repo config
      const repoConfig = existsSync(`${workDir}/.critters.yaml`)
        ? loadRepoConfig(workDir)
        : null;
      if (repoConfig) {
        logTask(task.identifier, "Found per-repo .critters.yaml");
      }

      // Run phases sequentially
      const phaseDataList: Record<string, unknown>[] = [];
      const allPhaseStats: { name: string; durationMs: number; costUsd?: number }[] = [];
      let costAlertSent = false;
      for (const phase of critterType.phases) {
        if (critterType.name === "create" && !critterType.quietComments) {
          await tracker.comment(task.id, `${phase.name === "planning" ? "Planning" : "Plan approved, executing"} (${phase.model})...`);
        }
        logTask(task.identifier, `Starting phase: ${phase.name} | ${shortRepoName(task.repoUrl)} | ${branch || task.prBranch || ""}`);
        const detail = this.activeCritterMap.get(task.id);
        if (detail) detail.phase = phase.name;

        const phaseStart = Date.now();
        const runner = getPhaseRunner(phase);
        // Resolve CLI adapter: phase > type > global config, default "claude"
        const cliName = phase.cli ?? critterType.cli ?? this.config.cli ?? "claude";
        const cliAdapter = getCliAdapter(cliName);
        const { mcpConfig, strictMcpConfig } = resolvePhaseMcpConfig(cliAdapter, critterType, this.config);

        const ctx: PhaseContext = {
          task,
          critterType,
          phase,
          workDir,
          branch,
          tracker,
          config: this.config,
          repoConfig,
          signal: abortController.signal,
          resuming,
          mcpConfig,
          strictMcpConfig,
          cliAdapter,
        };

        if (phase.name === "execution" && critterType.name === "create") {
          triggerHook(this.config, "onExecutionStarted", {
            CRITTER_ISSUE_ID: task.id,
            CRITTER_IDENTIFIER: task.identifier,
            CRITTER_TITLE: task.title,
            CRITTER_REPO_URL: task.repoUrl,
            CRITTER_BRANCH: branch,
          }, task.identifier);
        }

        // Cost monitoring interval (30s) — tracks cost for dashboard + budget enforcement
        const phaseTag = phaseFileTag(phase.name);
        const outputFile = `${workDir}/.critter-output-${phaseTag}.json`;
        const costMonitorInterval = setInterval(() => {
          const currentPhaseCost = cliAdapter.readPartialCost(outputFile);
          const completedPhaseCost = aggregatePhaseResults(phaseResults).totalCost;
          const totalCost = completedPhaseCost + currentPhaseCost;
          // Update active detail for dashboard
          const activeDetail = this.activeCritterMap.get(task.id);
          if (activeDetail) activeDetail.costUsd = totalCost;
          // Budget enforcement (only when budget is configured)
          if (effectiveCostBudget != null && totalCost > effectiveCostBudget) {
            logTask(task.identifier, `Cost budget exceeded: $${totalCost.toFixed(2)} spent, $${effectiveCostBudget.toFixed(2)} budget`);
            costBudgetExceeded = true;
            costBudgetSpent = totalCost;
            costBudgetLimit = effectiveCostBudget;
            costBudgetPhase = phase.name;
            abortController.abort();
          }
        }, 30_000);
        costMonitorInterval.unref();

        let phaseResult: Awaited<ReturnType<typeof runner.run>>;
        try {
          phaseResult = await runner.run(ctx);
        } finally {
          clearInterval(costMonitorInterval);
        }
        phaseResults.push(phaseResult.spawn);

        // Update accumulated cost on detail for dashboard accuracy between phases
        const accumulatedCost = aggregatePhaseResults(phaseResults).totalCost;
        const phaseDetail = this.activeCritterMap.get(task.id);
        if (phaseDetail) phaseDetail.costUsd = accumulatedCost;
        phaseDataList.push(phaseResult.data);

        const phaseDuration = Date.now() - phaseStart;
        allPhaseStats.push({
          name: phase.name,
          durationMs: phaseDuration,
          costUsd: phaseResult.spawn.costUsd,
        });
        const phaseStats = `${phase.name} (${phase.model}) completed in ${formatDuration(phaseDuration)}${formatPhaseStats(phaseResult.spawn)}`;
        logTask(task.identifier, phaseStats);
        if (!critterType.quietComments) {
          await tracker.comment(task.id, phaseStats);
        }

        // Post phase report as a comment when phase.comment is true
        if (phase.comment) {
          const responseText = phaseResult.data.responseText as string | undefined;
          if (responseText) {
            await tracker.comment(task.id, truncateComment(responseText));
            logTask(task.identifier, `Posted ${phase.name} report as comment (${responseText.length} chars)`);
          }
        }

        // Slack notification and hook for planning completion
        if (phase.name === "planning" && critterType.name === "create") {
          await this.slackNotifier.notify(
            task.id,
            formatPlanningComplete(task.identifier, task.title, phaseResult.spawn.numTurns, phaseResult.spawn.costUsd),
            task.identifier,
          );
          triggerHook(this.config, "onPlanningCompleted", {
            CRITTER_ISSUE_ID: task.id,
            CRITTER_IDENTIFIER: task.identifier,
            CRITTER_TITLE: task.title,
            CRITTER_REPO_URL: task.repoUrl,
            CRITTER_BRANCH: branch,
          }, task.identifier);
        }

        // Cost threshold check
        if (!costAlertSent && this.config.limits.costAlertThreshold != null) {
          const accumulatedCost = aggregatePhaseResults(phaseResults).totalCost;
          if (accumulatedCost > this.config.limits.costAlertThreshold) {
            costAlertSent = true;
            logTask(task.identifier, `Cost alert: ${task.identifier} has spent $${accumulatedCost.toFixed(2)} (threshold: $${this.config.limits.costAlertThreshold.toFixed(2)})`);
            await this.slackNotifier.notify(
              task.id,
              formatCostAlert(task.identifier, task.title, accumulatedCost, this.config.limits.costAlertThreshold, phase.name),
              task.identifier,
            );
          }
        }

        // Between-phase cost budget check
        if (effectiveCostBudget != null && !costBudgetExceeded) {
          const accumulatedCost = aggregatePhaseResults(phaseResults).totalCost;
          if (accumulatedCost > effectiveCostBudget) {
            costBudgetExceeded = true;
            costBudgetSpent = accumulatedCost;
            costBudgetLimit = effectiveCostBudget;
            costBudgetPhase = phase.name;
            throw new Error(`Cost budget exceeded ($${accumulatedCost.toFixed(2)} spent, $${effectiveCostBudget.toFixed(2)} budget)`);
          }
        }

        // Handle review phase outcomes inline
        if (phase.prompt === "builtin:review") {
          return await this.handleReviewOutcome(task, critterType, phaseResult.data, phaseResult.spawn, workDir, taskStart, tracker);
        }

        // Handle execution phase outcomes inline
        if (phase.prompt === "builtin:execution") {
          const prUrl = phaseResult.data.prUrl as string | null;
          if (prUrl) {
            const detail = this.activeCritterMap.get(task.id);
            if (detail) detail.prUrl = prUrl;
            return await this.handleCreateSuccess(task, critterType, prUrl, branch, phaseResults, allPhaseStats, workDir, taskStart, tracker);
          }
          // No PR — fall through to generic success path
        }
      }

      // Generic success (custom types)
      const totalDuration = formatDuration(Date.now() - taskStart);
      logTask(task.identifier, `Completed in ${totalDuration}`);

      await this.applySuccessOutcome(critterType.outcomes.success, task, critterType, tracker);

      // Upload report from the last phase (generic runner writes .critter-report.md)
      const lastPhaseData = phaseDataList.length > 0 ? phaseDataList[phaseDataList.length - 1] : null;
      const responseText = lastPhaseData?.responseText as string | undefined;
      if (responseText) {
        // Upload as a .md attachment
        const filename = `${sanitizeIdentifier(task.identifier)}-${critterType.name}.md`;
        const mdContent = `# ${task.identifier}: ${task.title}\n\n**Type**: ${critterType.name}  \n**Duration**: ${totalDuration}\n\n---\n\n${responseText}`;
        const url = await tracker.uploadAttachment(
          task.id, filename, Buffer.from(mdContent), "text/markdown", task.identifier,
        );

        // Post as inline comment too
        let comment = truncateComment(responseText);
        if (url) {
          comment += `\n\n[Full report](${url})`;
        }
        await tracker.comment(task.id, comment);
      } else if (!critterType.quietComments) {
        const modelSummary = [...new Set(critterType.phases.map(p => p.model))].join("/");
        await tracker.comment(task.id, `Critter [${critterType.name}] (${modelSummary}, critters v${VERSION}) completed in ${totalDuration}`);
      }

      // Upload full output logs
      const { uploaded: logAttachments } = await this.uploadLogs(task, critterType, workDir, tracker);
      if (logAttachments.length > 0) {
        logTask(task.identifier, `Uploaded ${logAttachments.length} log files`);
      }

      const { totalTurns, totalInput, totalOutput, totalCache, totalCost } = aggregatePhaseResults(phaseResults);
      recordMetric({
        timestamp: "",
        event: "task_completed",
        issueId: task.id,
        identifier: task.identifier,
        title: task.title,
        repoUrl: task.repoUrl,
        duration: Date.now() - taskStart,
        numTurns: totalTurns,
        inputTokens: totalInput,
        outputTokens: totalOutput,
        cacheReadTokens: totalCache,
        costUsd: totalCost,
        ...(task.issueUrl ? { issueUrl: task.issueUrl } : {}),
        critterType: critterType.name,
      });

      return { success: true };
    } catch (err) {
      const killedViaCli = !timedOut && !costBudgetExceeded && abortController.signal.aborted;
      const error = costBudgetExceeded
        ? `Cost budget exceeded ($${costBudgetSpent.toFixed(2)} spent, $${costBudgetLimit.toFixed(2)} budget)`
        : timedOut
          ? `Timed out after ${critterType.timeoutMinutes} minutes`
          : killedViaCli
            ? "Killed via CLI"
            : formatError(err);
      logTaskError(task.identifier, error);

      // Auto-retry: skip heavy failure handling if this will be retried
      if (this.shouldAutoRetry(task.id, error, timedOut)) {
        logTask(task.identifier, `Transient failure detected (will auto-retry): ${error}`);
        try {
          await tracker.comment(task.id, `Transient failure detected (will auto-retry): ${error}`);
        } catch { /* best effort */ }
        return { success: false, error };
      }

      // Graceful shutdown: don't run failure handling (which would flip the
      // issue to a FAILED status and defeat claimStatus-based orphan recovery
      // on the next startup). Mirror the auto-retry early return above.
      if (this.stopped) {
        return { success: false, error };
      }

      const totalDuration = formatDuration(Date.now() - taskStart);

      // Move to failure status
      try {
        await applyOutcome(critterType.outcomes.failure, task, critterType, tracker);
      } catch {
        logTaskError(task.identifier, `Failed to apply failure outcome`);
      }

      // Salvage partial progress (for any type with a feature branch)
      let salvageInfo = "";
      let salvageResult: { prUrl?: string; branchPushed?: boolean } = {};
      if (critterType.repo.branch && branch) {
        salvageResult = await salvagePartialProgress(workDir, branch, task.identifier, task.title, task.repoUrl, task.baseBranch);
        if (salvageResult.prUrl) {
          salvageInfo = `\n\nPartial progress was saved as a draft PR: ${salvageResult.prUrl}`;
          logTask(task.identifier, `Salvaged partial progress — draft PR: ${salvageResult.prUrl}`);
        } else if (salvageResult.branchPushed) {
          salvageInfo = `\n\nPartial commits were pushed to branch \`${branch}\`.`;
          logTask(task.identifier, `Salvaged partial progress — branch pushed: ${branch}`);
        }
      }

      // Post a comment on the PR when timeout occurs
      if (timedOut) {
        const prUrlForComment = salvageResult.prUrl ?? task.prUrl;
        if (prUrlForComment) {
          await addPrTimeoutComment(workDir, prUrlForComment, task.identifier, critterType.timeoutMinutes, task.repoUrl);
        }
      }

      // Upload logs
      const { uploaded: attachmentUrls, fallbackExcerpts } = await this.uploadLogs(task, critterType, workDir, tracker);

      // Read checkpoint file if it exists (sanitized — matches buildExecutionPrompt's path)
      let checkpointStatus = "";
      const checkpointFile = `${workDir}/critters/plans/${sanitizeIdentifier(task.identifier)}.checkpoint.md`;
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
        let failComment = costBudgetExceeded
          ? `Killed: cost budget exceeded ($${costBudgetSpent.toFixed(2)} spent, $${costBudgetLimit.toFixed(2)} budget)`
          : timedOut
            ? `Critter timed out after ${critterType.timeoutMinutes} minutes.`
            : `${isReviewType ? "Review critter" : "Critter"} failed after ${totalDuration}: ${error}`;
        failComment += salvageInfo;
        if (attachmentUrls.length > 0) {
          failComment += `\n\nAttached logs:\n${attachmentUrls.map((a) => `- [${a.name}](${a.url})`).join("\n")}`;
        }
        if (fallbackExcerpts) {
          failComment += `\n\n<details><summary>Log excerpts</summary>\n\n${fallbackExcerpts}\n</details>`;
        }
        failComment += checkpointStatus;
        await tracker.comment(task.id, failComment);
      } catch {
        logTaskError(task.identifier, "Failed to post error comment");
      }

      // Slack notification
      if (costBudgetExceeded) {
        await this.slackNotifier.notify(
          task.id,
          formatCostBudgetExceeded(task.identifier, task.title, costBudgetSpent, costBudgetLimit, costBudgetPhase),
        );
      } else if (isReviewType) {
        await this.slackNotifier.notify(
          task.id,
          formatReviewFailure(task.identifier, task.title, error, totalDuration),
          task.identifier,
        );
      } else {
        await this.slackNotifier.notify(
          task.id,
          formatFailure(task.identifier, task.title, error, totalDuration),
          task.identifier,
        );
      }

      // Salvage cost/token stats for the phase that threw before its spawn result was pushed.
      // The .critter-output-<tag>.json file still exists because cleanup runs in the outer finally.
      const salvageIdx = phaseResults.length;
      const salvagePhase = salvageIdx < critterType.phases.length ? critterType.phases[salvageIdx] : null;
      if (salvagePhase) {
        const salvageFile = `${workDir}/.critter-output-${phaseFileTag(salvagePhase.name)}.json`;
        if (existsSync(salvageFile)) {
          const extracted = extractPhaseResult(salvageFile);
          if (extracted) {
            phaseResults.push({
              exitCode: 1,
              stdout: "",
              stderr: "",
              timedOut,
              numTurns: extracted.numTurns,
              inputTokens: extracted.inputTokens,
              outputTokens: extracted.outputTokens,
              cacheReadTokens: extracted.cacheReadTokens,
              costUsd: extracted.costUsd,
            });
          }
        }
      }

      const { totalTurns, totalInput, totalOutput, totalCache, totalCost } = aggregatePhaseResults(phaseResults);

      const metricEvent = isReviewType ? "review_failed" : "task_failed";
      recordMetric({
        timestamp: "",
        event: metricEvent,
        issueId: task.id,
        identifier: task.identifier,
        title: task.title,
        repoUrl: task.repoUrl,
        ...(task.prUrl ? { prUrl: task.prUrl } : {}),
        ...(task.issueUrl ? { issueUrl: task.issueUrl } : {}),
        duration: Date.now() - taskStart,
        error,
        numTurns: totalTurns || undefined,
        inputTokens: totalInput || undefined,
        outputTokens: totalOutput || undefined,
        cacheReadTokens: totalCache || undefined,
        costUsd: totalCost || undefined,
        critterType: critterType.name,
        retryAttempt: this.retryCounts.get(task.id) ?? undefined,
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
      this.abortControllers.delete(task.id);
      this.activeCritterMap.delete(task.id);
      this.slackNotifier.clearThread(task.id);
      try {
        cleanupWorkDir(workDir);
        logTask(task.identifier, "Cleaned up work directory");
      } catch (cleanupErr) {
        logTaskError(task.identifier, `Work directory cleanup failed: ${cleanupErr}`);
      }
      this.activeWorkDirs.delete(workDir);
    }
  }

  private async runTaskWithRetry(task: TrackerTask, critterType: CritterTypeConfig): Promise<TaskResult> {
    const autoRetry = this.config.autoRetry;
    if (!autoRetry) {
      return this.runTask(task, critterType);
    }

    let lastResult: TaskResult | undefined;
    for (let attempt = 0; attempt <= autoRetry.maxRetries; attempt++) {
      lastResult = await this.runTask(task, critterType);

      // Success or non-retryable — done
      if (lastResult.success || !lastResult.error) break;
      if (lastResult.error.startsWith("Timed out after")) break;
      if (!this.isTransientError(lastResult.error)) break;
      if (attempt >= autoRetry.maxRetries) break;
      if (this.stopped) break;

      // Retryable transient failure — compute exponential backoff delay
      const baseMs = autoRetry.baseDelaySeconds * 1000;
      const maxMs = autoRetry.maxDelaySeconds * 1000;
      const delayMs = withCappedJitter(baseMs * (2 ** attempt), maxMs);

      this.retryCounts.set(task.id, attempt + 1);
      const nextAttempt = attempt + 2;
      const maxAttempts = autoRetry.maxRetries + 1;

      logTask(task.identifier, `Auto-retrying (attempt ${nextAttempt}/${maxAttempts}) in ${Math.round(delayMs / 1000)}s after transient failure: ${lastResult.error}`);
      if (!critterType.quietComments) {
        try {
          const tracker = this.getTracker(critterType);
          await tracker.comment(task.id, `Auto-retrying (attempt ${nextAttempt}/${maxAttempts}) in ${Math.round(delayMs / 1000)}s...\nError: ${lastResult.error}`);
        } catch { /* best effort */ }
      }

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    this.retryCounts.delete(task.id);
    return lastResult ?? { success: false, error: "Auto-retry did not produce a task result" };
  }

  /**
   * Apply a terminal *success* outcome (status transition + optional label removal)
   * defensively. A status-update failure on a genuinely successful task (API 5xx,
   * rate limit, network blip) must never propagate: otherwise the outer catch would
   * demote a real success into the FAILURE path — wrong status, a misleading "failed"
   * comment, lost success comment/metrics, and (for transient errors) a wasteful full
   * re-run of an already-created PR. The failure path already swallows these; mirror it.
   */
  private async applySuccessOutcome(
    outcome: Parameters<typeof applyOutcome>[0],
    task: TrackerTask,
    critterType: CritterTypeConfig,
    tracker: IssueTracker,
  ): Promise<void> {
    try {
      await applyOutcome(outcome, task, critterType, tracker);
    } catch (err) {
      logTaskError(task.identifier, `Failed to apply success status transition (continuing — task succeeded): ${formatError(err)}`);
    }
  }

  private async handleCreateSuccess(
    task: TrackerTask,
    critterType: CritterTypeConfig,
    prUrl: string,
    branch: string,
    phaseResults: SpawnResult[],
    allPhaseStats: { name: string; durationMs: number; costUsd?: number }[],
    workDir: string,
    taskStart: number,
    tracker: IssueTracker,
  ): Promise<TaskResult> {
    await this.applySuccessOutcome(critterType.outcomes.prCreated ?? critterType.outcomes.success, task, critterType, tracker);

    try {
      await updatePrWithPlan(workDir, prUrl, task.identifier, allPhaseStats);
    } catch (err) {
      logTaskError(task.identifier, `Failed to update PR description: ${err}`);
    }

    const totalDuration = formatDuration(Date.now() - taskStart);
    logTask(task.identifier, `Completed in ${totalDuration}`);
    const modelSummary = [...new Set(critterType.phases.map(p => p.model))].join("/");
    await tracker.comment(task.id, `PR created: ${prUrl} (${modelSummary}, critters v${VERSION}, completed in ${totalDuration})`);
    await this.slackNotifier.notify(
      task.id,
      formatSuccess(task.identifier, task.title, prUrl, totalDuration),
      task.identifier,
    );
    logTask(task.identifier, `Success — PR: ${prUrl}`);

    // Upload full output logs
    const { uploaded: logAttachments } = await this.uploadLogs(task, critterType, workDir, tracker);
    if (logAttachments.length > 0) {
      logTask(task.identifier, `Uploaded ${logAttachments.length} log files`);
    }

    const { totalTurns, totalInput, totalOutput, totalCache, totalCost } = aggregatePhaseResults(phaseResults);

    recordMetric({
      timestamp: "",
      event: "task_completed",
      issueId: task.id,
      identifier: task.identifier,
      title: task.title,
      repoUrl: task.repoUrl,
      duration: Date.now() - taskStart,
      prUrl,
      numTurns: totalTurns,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCache,
      costUsd: totalCost,
      ...(task.issueUrl ? { issueUrl: task.issueUrl } : {}),
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
    workDir: string,
    taskStart: number,
    tracker: IssueTracker,
  ): Promise<TaskResult> {
    const decision = data.reviewDecision as string;
    const reason = data.reviewReason as string | undefined;
    const totalDuration = formatDuration(Date.now() - taskStart);

    if (decision === "merged" || data.alreadyMerged) {
      await this.applySuccessOutcome(critterType.outcomes.merged, task, critterType, tracker);
      if (data.alreadyMerged) {
        await tracker.comment(task.id, "PR was already merged");
        logTask(task.identifier, "Review complete — PR was already merged");
      } else {
        await tracker.comment(task.id, `PR merged by review critter (${critterType.phases[0].model}, critters v${VERSION}, ${totalDuration})`);
        await this.slackNotifier.notify(
          task.id,
          formatReviewMerged(task.identifier, task.title, task.prUrl ?? "", totalDuration),
          task.identifier,
        );
        logTask(task.identifier, `Review complete — PR merged`);
      }
      // Upload full output logs
      const { uploaded: logAttachments } = await this.uploadLogs(task, critterType, workDir, tracker);
      if (logAttachments.length > 0) {
        logTask(task.identifier, `Uploaded ${logAttachments.length} log files`);
      }
      recordMetric({
        timestamp: "",
        event: "review_completed",
        issueId: task.id,
        identifier: task.identifier,
        title: task.title,
        repoUrl: task.repoUrl,
        prUrl: task.prUrl,
        ...(task.issueUrl ? { issueUrl: task.issueUrl } : {}),
        ...(data.alreadyMerged ? {} : { duration: Date.now() - taskStart }),
        outcome: data.alreadyMerged ? "already_merged" : "merged",
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
      await this.applySuccessOutcome(critterType.outcomes.needsChanges, task, critterType, tracker);
      await tracker.comment(task.id, `Review critter (${critterType.phases[0].model}) requested changes: ${reason}`);
      await this.slackNotifier.notify(
        task.id,
        formatReviewNeedsChanges(task.identifier, task.title, reason ?? "No reason provided", totalDuration),
        task.identifier,
      );
      logTask(task.identifier, `Review complete — needs changes: ${reason}`);
      // Upload full output logs
      const { uploaded: ncLogAttachments } = await this.uploadLogs(task, critterType, workDir, tracker);
      if (ncLogAttachments.length > 0) {
        logTask(task.identifier, `Uploaded ${ncLogAttachments.length} log files`);
      }
      recordMetric({
        timestamp: "",
        event: "review_completed",
        issueId: task.id,
        identifier: task.identifier,
        title: task.title,
        repoUrl: task.repoUrl,
        prUrl: task.prUrl,
        ...(task.issueUrl ? { issueUrl: task.issueUrl } : {}),
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

  private async uploadLogs(
    task: TrackerTask,
    critterType: CritterTypeConfig,
    workDir: string,
    tracker: IssueTracker,
  ): Promise<{ uploaded: Array<{ name: string; url: string }>; fallbackExcerpts: string }> {
    const uploaded: Array<{ name: string; url: string }> = [];
    let fallbackExcerpts = "";
    const MAX_LOG_SIZE = 5 * 1024 * 1024;

    const logFiles = buildLogFileList(workDir, task.identifier, critterType.phases);

    for (const file of logFiles) {
      if (!existsSync(file.path)) continue;
      try {
        let content = readFileSync(file.path);
        if (content.length === 0) continue;
        if (content.length > MAX_LOG_SIZE) {
          content = content.subarray(content.length - MAX_LOG_SIZE);
        }
        const url = await tracker.uploadAttachment(task.id, file.name, content, "text/plain", task.identifier);
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

  killByIdentifiers(identifiers: string[]): KillResult[] {
    const requested = new Set(identifiers);
    const results: KillResult[] = [];

    for (const [taskId, detail] of this.activeCritterMap.entries()) {
      if (requested.has(detail.identifier)) {
        const ac = this.abortControllers.get(taskId);
        if (ac) {
          ac.abort();
          results.push({
            identifier: detail.identifier,
            critterType: detail.critterType ?? "unknown",
            startedAt: detail.startedAt,
          });
        }
      }
    }

    return results;
  }

  killByType(typeName: string): KillResult[] {
    const matching = Array.from(this.activeCritterMap.values())
      .filter((d) => d.critterType === typeName)
      .map((d) => d.identifier);
    return this.killByIdentifiers(matching);
  }

  killAll(): KillResult[] {
    const all = Array.from(this.activeCritterMap.values()).map((d) => d.identifier);
    return this.killByIdentifiers(all);
  }
}

export interface KillResult {
  identifier: string;
  critterType: string;
  startedAt: number;
}
