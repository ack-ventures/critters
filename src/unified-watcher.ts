import type { CritterTypeConfig } from "./critter-type.js";
import { log, logError, logTask, logTaskError } from "./logger.js";
import { recordMetric } from "./metrics.js";
import { resolveRepoUrl, resolveRepoUrlWithSource } from "./prompt.js";
import type { IssueTracker, TrackerTask } from "./tracker/types.js";
import type { Config } from "./types.js";
import type { UnifiedSpawner } from "./unified-spawner.js";
import { sleep } from "./utils.js";

const PR_URL_RE = /PR created:\s*(https:\/\/github\.com\/[^\s)]+\/pull\/(\d+))/;

export function extractPrFromComments(comments: string[]): { prUrl: string; prNumber: number } | null {
  for (let i = comments.length - 1; i >= 0; i--) {
    const match = comments[i].match(PR_URL_RE);
    if (match) {
      return { prUrl: match[1], prNumber: parseInt(match[2], 10) };
    }
  }
  return null;
}

export class UnifiedWatcher {
  private config: Config;
  private trackers: Map<string, IssueTracker>;
  private spawner: UnifiedSpawner | null;
  /** Per-type dedup: Map<typeName, Set<taskId>> */
  private activeIssueIds = new Map<string, Set<string>>();
  private stopped = false;
  private polling = false;
  private onPoll?: () => void;

  constructor(
    config: Config,
    trackers: Map<string, IssueTracker>,
    spawner: UnifiedSpawner | null,
    onPoll?: () => void,
  ) {
    this.config = config;
    this.trackers = trackers;
    this.spawner = spawner;
    this.onPoll = onPoll;
  }

  private getTracker(critterType: CritterTypeConfig): IssueTracker {
    const providerName = critterType.provider ?? this.config.provider;
    const tracker = this.trackers.get(providerName);
    if (!tracker) {
      throw new Error(`No tracker configured for provider "${providerName}" (critter type "${critterType.name}")`);
    }
    return tracker;
  }

  async start(): Promise<void> {
    log("Polling for issues...");

    while (!this.stopped) {
      if (this.polling) {
        await sleep(this.config.pollIntervalSeconds * 1000);
        continue;
      }
      this.polling = true;
      try {
        const issuesFound = await this.poll();
        recordMetric({ timestamp: "", event: "poll_completed", outcome: `${issuesFound} issues found` });
        this.onPoll?.();
      } catch (err) {
        logError(`Poll failed: ${err}`);
      } finally {
        this.polling = false;
      }

      await sleep(this.config.pollIntervalSeconds * 1000);
    }
  }

  stop(): void {
    this.stopped = true;
    this.spawner?.stop();
  }

  async triggerPoll(): Promise<number> {
    if (this.polling) return 0;
    this.polling = true;
    try {
      return await this.poll();
    } finally {
      this.polling = false;
    }
  }

  async dryRunPoll(): Promise<{ total: number; wouldPickUp: number; blocked: number; skipped: number }> {
    let total = 0;
    let wouldPickUp = 0;
    let blocked = 0;
    let skipped = 0;

    for (const critterType of this.config.critterTypes) {
      const tracker = this.getTracker(critterType);
      const issues = await tracker.findIssues(critterType.trigger);

      for (const task of issues) {
        total++;
        const resolved = resolveRepoUrlWithSource(
          { issueId: task.id, identifier: task.identifier, title: task.title, description: task.description, repoUrl: "", teamId: task.groupId, projectId: task.projectId },
          this.config,
        );

        if (!resolved) {
          log(`[DRY RUN] [${critterType.name}] Skipping ${task.identifier} "${task.title}" — no repo URL found`);
          skipped++;
          continue;
        }

        // Check blockers (for create-like types)
        if (task.blockedBy && task.blockedBy.length > 0) {
          const blockerList = task.blockedBy
            .map((b) => `${b.identifier} (${b.status})`)
            .join(", ");
          log(`[DRY RUN] [${critterType.name}] Would pick up ${task.identifier} "${task.title}"`);
          log(`  repo: ${resolved.url} (${resolved.source})`);
          log(`  blocked by: ${blockerList}`);
          blocked++;
          continue;
        }

        // Check enrichment requirements
        if (critterType.enrichment === "extractPrUrl") {
          let comments: string[];
          try {
            comments = await tracker.getComments(task.id);
          } catch {
            log(`[DRY RUN] [${critterType.name}] Skipping ${task.identifier} "${task.title}" — failed to fetch comments`);
            skipped++;
            continue;
          }
          const prInfo = extractPrFromComments(comments);
          if (!prInfo) {
            log(`[DRY RUN] [${critterType.name}] Skipping ${task.identifier} "${task.title}" — no PR URL in comments`);
            skipped++;
            continue;
          }
          log(`[DRY RUN] [${critterType.name}] Would pick up ${task.identifier} "${task.title}"`);
          log(`  repo: ${resolved.url} (${resolved.source})`);
          log(`  PR: ${prInfo.prUrl}`);
        } else {
          log(`[DRY RUN] [${critterType.name}] Would pick up ${task.identifier} "${task.title}"`);
          log(`  repo: ${resolved.url} (${resolved.source})`);
          log(`  blocked by: (none)`);
        }
        wouldPickUp++;
      }
    }

    return { total, wouldPickUp, blocked, skipped };
  }

  private async poll(): Promise<number> {
    let totalIssues = 0;

    for (const critterType of this.config.critterTypes) {
      const tracker = this.getTracker(critterType);
      const issues = await tracker.findIssues(critterType.trigger);
      totalIssues += issues.length;

      for (const task of issues) {
        // Per-type dedup
        if (!this.activeIssueIds.has(critterType.name)) {
          this.activeIssueIds.set(critterType.name, new Set());
        }
        const activeIds = this.activeIssueIds.get(critterType.name)!;

        if (activeIds.has(task.id)) continue;

        // Check blockers
        if (task.blockedBy && task.blockedBy.length > 0) {
          const blockerList = task.blockedBy
            .map((b) => `${b.identifier} (${b.status})`)
            .join(", ");
          logTask(task.identifier, `Blocked by ${blockerList} — skipping`);
          continue;
        }

        // Resolve repo URL
        const critterTask = {
          issueId: task.id,
          identifier: task.identifier,
          title: task.title,
          description: task.description,
          repoUrl: "",
          teamId: task.groupId,
          projectId: task.projectId,
        };
        const repoUrl = resolveRepoUrl(critterTask, this.config);
        if (!repoUrl) {
          logTask(task.identifier, "Could not determine repository — skipping");
          try {
            await tracker.comment(
              task.id,
              "Could not determine repository. Add a `repo: <url>` line to the description, or configure a project/team mapping in critters.config.yaml.",
            );
          } catch {
            // Best effort
          }
          continue;
        }
        task.repoUrl = repoUrl;

        // Per-type enrichment
        if (critterType.enrichment === "extractPrUrl") {
          const enriched = await this.enrichReviewTask(task, tracker);
          if (!enriched) continue;
        }

        activeIds.add(task.id);
        logTask(task.identifier, `Picked up [${critterType.name}]: ${task.title}`);

        // Dispatch
        this.spawner?.dispatch(task, critterType).then((result) => {
          activeIds.delete(task.id);
          if (result.success) {
            logTask(task.identifier, "Completed successfully");
          } else {
            logTask(task.identifier, `Failed: ${result.error}`);
          }
        }).catch((err) => {
          activeIds.delete(task.id);
          logTaskError(task.identifier, `Dispatch failed: ${err}`);
        });
      }
    }

    return totalIssues;
  }

  private async enrichReviewTask(task: TrackerTask, tracker: IssueTracker): Promise<boolean> {
    let comments: string[];
    try {
      comments = await tracker.getComments(task.id);
    } catch (err) {
      logTaskError(task.identifier, `Failed to fetch comments: ${err}`);
      return false;
    }

    const prInfo = extractPrFromComments(comments);
    if (!prInfo) {
      logTask(task.identifier, "No PR URL found in comments — skipping (will retry next poll)");
      try {
        await tracker.comment(
          task.id,
          "Review critter could not find a PR URL in the issue comments. Waiting for a `PR created: <url>` comment.",
        );
      } catch {
        // Best effort
      }
      return false;
    }

    task.prUrl = prInfo.prUrl;
    task.prNumber = prInfo.prNumber;
    task.prBranch = ""; // resolved in the review runner
    return true;
  }
}
