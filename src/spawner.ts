import { existsSync, mkdirSync } from "fs";
import { spawn } from "child_process";
import type { Config, CritterTask, CritterResult, TeamStatuses } from "./types.js";
import { branchName, formatDuration, formatPhaseStats } from "./utils.js";
import { logTask, logTaskError } from "./logger.js";
import {
  shallowClone,
  createBranch,
  hasCommitsOnBranch,
  hasUncommittedChanges,
  autoCommit,
  commitFile,
  cleanupWorkDir,
  cleanupStaleWorkDirs,
} from "./git.js";
import { spawnClaude } from "./claude.js";
import {
  buildPlanningPrompt,
  buildExecutionPrompt,
  getPlanningAllowedTools,
  getExecutionAllowedTools,
} from "./prompt.js";
import { updateIssueStatus, commentOnIssue } from "./linear.js";
import { sendSlackNotification, formatSuccess, formatFailure } from "./slack.js";
import { tailLines } from "./utils.js";

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

  constructor(config: Config, teamStatuses: TeamStatuses) {
    this.config = config;
    this.teamStatuses = teamStatuses;
  }

  cleanupStale(): void {
    cleanupStaleWorkDirs(this.config.workDir);
  }

  async dispatch(task: CritterTask): Promise<CritterResult> {
    return new Promise((resolve) => {
      this.queue.push({ task, resolve });
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
    while (this.running < this.config.concurrency && this.queue.length > 0 && !this.stopped) {
      const item = this.queue.shift()!;
      this.running++;
      this.runTask(item.task).then((result) => {
        this.running--;
        item.resolve(result);
        this.processQueue();
      });
    }
  }

  private async runTask(task: CritterTask): Promise<CritterResult> {
    const branch = branchName(task.identifier, task.title);
    const workDir = `${this.config.workDir}/${task.identifier}-${Date.now()}`;
    const abortController = new AbortController();
    this.activeProcesses.add(abortController);
    const taskStart = Date.now();

    // Timeout for the entire task (both phases)
    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.config.timeoutMinutes * 60 * 1000);

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
      await shallowClone(task.repoUrl, workDir, task.identifier);

      // 2. Create branch
      await createBranch(workDir, branch, task.identifier);

      // Ensure plans directory exists
      const plansDir = `${workDir}/critters/plans`;
      mkdirSync(plansDir, { recursive: true });

      // 3. Phase 1: Planning
      await commentOnIssue(task.issueId, "Planning...");
      logTask(task.identifier, "Starting Phase 1: Planning");

      const planStart = Date.now();
      const planResult = await spawnClaude(
        buildPlanningPrompt(task),
        getPlanningAllowedTools(),
        workDir,
        this.config.maxTurns,
        task.identifier,
        "plan",
        abortController.signal,
      );

      if (planResult.timedOut) {
        throw new Error("Timed out during planning phase");
      }

      if (planResult.exitCode !== 0) {
        const errTail = tailLines(planResult.stderr || planResult.stdout, 20);
        throw new Error(`Planning failed (exit ${planResult.exitCode}):\n${errTail}`);
      }

      // Verify plan file exists
      const planFile = `${workDir}/critters/plans/${task.identifier}.md`;
      if (!existsSync(planFile)) {
        throw new Error("Planning failed to produce a plan file");
      }

      const planDuration = Date.now() - planStart;
      const planStats = `Planning completed in ${formatDuration(planDuration)}${formatPhaseStats(planResult)}`;
      logTask(task.identifier, planStats);
      await commentOnIssue(task.issueId, planStats);

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
      const execResult = await spawnClaude(
        buildExecutionPrompt(task),
        getExecutionAllowedTools(this.config, task),
        workDir,
        this.config.maxTurns,
        task.identifier,
        "exec",
        abortController.signal,
      );

      if (execResult.timedOut) {
        throw new Error("Timed out during execution phase");
      }

      if (execResult.exitCode !== 0) {
        const errTail = tailLines(execResult.stderr || execResult.stdout, 20);
        throw new Error(`Execution failed (exit ${execResult.exitCode}):\n${errTail}`);
      }

      const execDuration = Date.now() - execStart;
      const execStats = `Execution completed in ${formatDuration(execDuration)}${formatPhaseStats(execResult)}`;
      logTask(task.identifier, execStats);
      await commentOnIssue(task.issueId, execStats);

      // 5. Check for commits, auto-commit if needed
      if (await hasUncommittedChanges(workDir)) {
        await autoCommit(workDir, task.identifier, `[${task.identifier}] Auto-commit remaining changes`);
      }

      if (!(await hasCommitsOnBranch(workDir, branch))) {
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
        await commentOnIssue(task.issueId, `Draft PR created: ${prUrl} (completed in ${totalDuration})`);
        await sendSlackNotification(
          this.config.slackWebhookUrl,
          formatSuccess(task.identifier, task.title, prUrl, totalDuration),
        );
        logTask(task.identifier, `Success — PR: ${prUrl}`);
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

      try {
        await commentOnIssue(task.issueId, `Critter failed after ${totalDuration}: ${error}`);
      } catch {
        logTaskError(task.identifier, "Failed to post error comment");
      }

      await sendSlackNotification(
        this.config.slackWebhookUrl,
        formatFailure(task.identifier, task.title, error, totalDuration),
      );

      return { success: false, error };
    } finally {
      clearTimeout(timeout);
      this.activeProcesses.delete(abortController);
      cleanupWorkDir(workDir);
      logTask(task.identifier, "Cleaned up work directory");
    }
  }
}

async function detectPr(
  workDir: string,
  branch: string,
  identifier: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("gh", ["pr", "list", "--head", branch, "--json", "url", "--limit", "1"], {
      cwd: workDir,
    });
    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.on("close", (code) => {
      if (code !== 0) {
        logTaskError(identifier, "gh pr list failed");
        resolve(null);
        return;
      }
      try {
        const prs = JSON.parse(stdout);
        if (prs.length > 0) {
          resolve(prs[0].url);
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    });
  });
}
