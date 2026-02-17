import { commentOnIssue, findCritterIssues } from "./linear.js";
import { log, logError, logTask, logTaskError } from "./logger.js";
import { recordMetric } from "./metrics.js";
import { resolveRepoUrl, resolveRepoUrlWithSource } from "./prompt.js";
import type { Spawner } from "./spawner.js";
import type { Config } from "./types.js";
import { sleep } from "./utils.js";

export class Watcher {
  private config: Config;
  private spawner: Spawner | null;
  private activeIssueIds = new Set<string>();
  private stopped = false;
  private onPoll?: () => void;

  constructor(config: Config, spawner: Spawner | null, onPoll?: () => void) {
    this.config = config;
    this.spawner = spawner;
    this.onPoll = onPoll;
  }

  async start(): Promise<void> {
    log("Polling Linear...");

    while (!this.stopped) {
      try {
        const issuesFound = await this.poll();
        recordMetric({ timestamp: "", event: "poll_completed", outcome: `${issuesFound} issues found` });
        this.onPoll?.();
      } catch (err) {
        logError(`Poll failed: ${err}`);
      }

      await sleep(this.config.pollIntervalSeconds * 1000);
    }
  }

  stop(): void {
    this.stopped = true;
    this.spawner?.stop();
  }

  async dryRunPoll(): Promise<{ total: number; wouldPickUp: number; blocked: number; skipped: number }> {
    const issues = await findCritterIssues(this.config.triggerLabel);
    let wouldPickUp = 0;
    let blocked = 0;
    let skipped = 0;

    for (const task of issues) {
      const resolved = resolveRepoUrlWithSource(task, this.config);

      if (!resolved) {
        log(`[DRY RUN] Skipping ${task.identifier} "${task.title}" — no repo URL found`);
        skipped++;
        continue;
      }

      if (task.blockedBy && task.blockedBy.length > 0) {
        const blockerList = task.blockedBy
          .map((b) => `${b.identifier} (${b.status})`)
          .join(", ");
        log(`[DRY RUN] Would pick up ${task.identifier} "${task.title}"`);
        log(`  repo: ${resolved.url} (${resolved.source})`);
        log(`  blocked by: ${blockerList}`);
        blocked++;
        continue;
      }

      log(`[DRY RUN] Would pick up ${task.identifier} "${task.title}"`);
      log(`  repo: ${resolved.url} (${resolved.source})`);
      log(`  blocked by: (none)`);
      wouldPickUp++;
    }

    return { total: issues.length, wouldPickUp, blocked, skipped };
  }

  private async poll(): Promise<number> {
    const issues = await findCritterIssues(this.config.triggerLabel);

    for (const task of issues) {
      if (this.activeIssueIds.has(task.issueId)) {
        continue;
      }

      // Check for unresolved blockers
      if (task.blockedBy && task.blockedBy.length > 0) {
        const blockerList = task.blockedBy
          .map((b) => `${b.identifier} (${b.status})`)
          .join(", ");
        logTask(task.identifier, `Blocked by ${blockerList} — skipping`);
        continue;
      }

      // Resolve repo URL
      const repoUrl = resolveRepoUrl(task, this.config);
      if (!repoUrl) {
        logTask(task.identifier, "Could not determine repository — skipping");
        try {
          await commentOnIssue(
            task.issueId,
            "Could not determine repository. Add a `repo: <url>` line to the description, or configure a project/team mapping in critters.config.yaml.",
          );
        } catch {
          // Best effort
        }
        continue;
      }

      task.repoUrl = repoUrl;
      this.activeIssueIds.add(task.issueId);
      logTask(task.identifier, `Picked up: ${task.title}`);

      // Dispatch and handle completion (don't await — let it run concurrently)
      this.spawner?.dispatch(task).then((result) => {
        this.activeIssueIds.delete(task.issueId);
        if (result.success) {
          logTask(task.identifier, "Completed successfully");
        } else {
          logTask(task.identifier, `Failed: ${result.error}`);
        }
      }).catch((err) => {
        this.activeIssueIds.delete(task.issueId);
        logTaskError(task.identifier, `Dispatch failed: ${err}`);
      });
    }

    return issues.length;
  }
}
