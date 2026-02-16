import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnClaude } from "./claude.js";
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
import { commentOnIssue, updateIssueStatus, uploadFileToIssue } from "./linear.js";
import { log, logTask, logTaskError } from "./logger.js";
import {
  buildExecutionPrompt,
  buildPlanningPrompt,
  getExecutionAllowedTools,
  getPlanningAllowedTools,
} from "./prompt.js";
import { formatFailure, formatSuccess, sendSlackNotification } from "./slack.js";
import type { Config, CritterResult, CritterTask, SpawnResult, TeamStatuses } from "./types.js";
import { branchName, formatDuration, formatPhaseStats, runCommand, sleep, tailLines } from "./utils.js";

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

      // Exclude critter temp files from git so they don't trigger warnings
      appendFileSync(`${workDir}/.git/info/exclude`, "\n.critter-*\n");

      // Ensure plans directory exists
      const plansDir = `${workDir}/critters/plans`;
      mkdirSync(plansDir, { recursive: true });

      // 3. Phase 1: Planning
      await commentOnIssue(task.issueId, "Planning...");
      logTask(task.identifier, "Starting Phase 1: Planning");

      const planAllowedTools = getPlanningAllowedTools();
      logTask(task.identifier, `Planning phase allowed tools: ${planAllowedTools.join(", ")}`);

      const planStart = Date.now();
      const planResult = await spawnClaude(
        buildPlanningPrompt(task),
        planAllowedTools,
        workDir,
        this.config.maxPlanningTurns,
        task.identifier,
        "plan",
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
      const execAllowedTools = getExecutionAllowedTools(this.config, task);
      logTask(task.identifier, `Execution phase allowed tools: ${execAllowedTools.join(", ")}`);
      const execResult = await spawnClaude(
        buildExecutionPrompt(task, execAllowedTools),
        execAllowedTools,
        workDir,
        this.config.maxExecutionTurns,
        task.identifier,
        "exec",
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

      // Upload logs and plan file as attachments for debugging
      const attachmentUrls = await uploadFailureLogs(task, workDir);

      try {
        let failComment = `Critter failed after ${totalDuration}: ${error}`;
        if (attachmentUrls.length > 0) {
          failComment += `\n\nAttached logs:\n${attachmentUrls.map((a) => `- [${a.name}](${a.url})`).join("\n")}`;
        }
        await commentOnIssue(task.issueId, failComment);
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
      this.activeWorkDirs.delete(workDir);
      cleanupWorkDir(workDir);
      logTask(task.identifier, "Cleaned up work directory");
    }
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
): Promise<Array<{ name: string; url: string }>> {
  const uploaded: Array<{ name: string; url: string }> = [];

  const logFiles = [
    { path: `${workDir}/.critter-output-plan.json`, name: `${task.identifier}-plan-output.txt` },
    { path: `${workDir}/.critter-err-plan.log`, name: `${task.identifier}-plan-stderr.txt` },
    { path: `${workDir}/.critter-output-exec.json`, name: `${task.identifier}-exec-output.txt` },
    { path: `${workDir}/.critter-err-exec.log`, name: `${task.identifier}-exec-stderr.txt` },
    { path: `${workDir}/critters/plans/${task.identifier}.md`, name: `${task.identifier}-plan.md` },
  ];

  for (const file of logFiles) {
    if (!existsSync(file.path)) continue;
    try {
      let content = readFileSync(file.path);
      if (content.length === 0) continue;
      if (content.length > MAX_LOG_SIZE) {
        content = content.subarray(content.length - MAX_LOG_SIZE);
      }
      const url = await uploadFileToIssue(task.issueId, file.name, content, "text/plain");
      if (url) {
        uploaded.push({ name: file.name, url });
        logTask(task.identifier, `Uploaded ${file.name}`);
      }
    } catch {
      logTaskError(task.identifier, `Failed to upload ${file.name}`);
    }
  }

  return uploaded;
}

async function detectPr(
  workDir: string,
  branch: string,
  identifier: string,
): Promise<string | null> {
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 3000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { code, stdout, stderr } = await runCommand(
      "gh",
      ["pr", "list", "--head", branch, "--json", "url", "--limit", "1"],
      { cwd: workDir },
    );

    if (code !== 0) {
      logTaskError(identifier, `gh pr list failed (attempt ${attempt}/${MAX_RETRIES}): ${stderr}`);
    } else {
      try {
        const prs = JSON.parse(stdout);
        if (prs.length > 0) {
          return prs[0].url;
        }
      } catch {
        logTaskError(identifier, `Failed to parse gh pr list output: ${stdout}`);
      }
    }

    if (attempt < MAX_RETRIES) {
      logTask(identifier, `PR not found yet, retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_RETRIES})`);
      await sleep(RETRY_DELAY_MS);
    }
  }

  logTaskError(identifier, `PR not detected after ${MAX_RETRIES} attempts`);
  return null;
}
