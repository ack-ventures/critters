import { commentOnIssue, findReviewIssues, getIssueComments } from "./linear.js";
import { log, logError, logTask, logTaskError } from "./logger.js";
import { recordMetric } from "./metrics.js";
import { resolveRepoUrl, resolveRepoUrlWithSource } from "./prompt.js";
import type { ReviewSpawner } from "./review-spawner.js";
import type { Config, ReviewTask } from "./types.js";
import { sleep } from "./utils.js";

const PR_URL_RE = /PR created:\s*(https:\/\/github\.com\/[^\s)]+\/pull\/(\d+))/;

export function extractPrFromComments(comments: string[]): { prUrl: string; prNumber: number } | null {
  // Search newest comment first
  for (let i = comments.length - 1; i >= 0; i--) {
    const match = comments[i].match(PR_URL_RE);
    if (match) {
      return { prUrl: match[1], prNumber: parseInt(match[2], 10) };
    }
  }
  return null;
}

export class ReviewWatcher {
  private config: Config;
  private spawner: ReviewSpawner | null;
  private activeIssueIds = new Set<string>();
  private stopped = false;
  private onPoll?: () => void;

  constructor(config: Config, spawner: ReviewSpawner | null, onPoll?: () => void) {
    this.config = config;
    this.spawner = spawner;
    this.onPoll = onPoll;
  }

  async start(): Promise<void> {
    log("Polling Linear for review issues...");

    while (!this.stopped) {
      try {
        const issuesFound = await this.poll();
        recordMetric({ timestamp: "", event: "poll_completed", outcome: `${issuesFound} review issues found` });
        this.onPoll?.();
      } catch (err) {
        logError(`Review poll failed: ${err}`);
      }

      await sleep(this.config.pollIntervalSeconds * 1000);
    }
  }

  stop(): void {
    this.stopped = true;
    this.spawner?.stop();
  }

  async dryRunPoll(): Promise<{ total: number; wouldPickUp: number; skipped: number }> {
    const issues = await findReviewIssues(this.config.reviewTriggerLabel);
    let wouldPickUp = 0;
    let skipped = 0;

    for (const issue of issues) {
      const resolved = resolveRepoUrlWithSource(issue, this.config);
      if (!resolved) {
        log(`[DRY RUN] Skipping review ${issue.identifier} "${issue.title}" — no repo URL found`);
        skipped++;
        continue;
      }

      let comments: string[];
      try {
        comments = await getIssueComments(issue.issueId);
      } catch {
        log(`[DRY RUN] Skipping review ${issue.identifier} "${issue.title}" — failed to fetch comments`);
        skipped++;
        continue;
      }

      const prInfo = extractPrFromComments(comments);
      if (!prInfo) {
        log(`[DRY RUN] Skipping review ${issue.identifier} "${issue.title}" — no PR URL in comments`);
        skipped++;
        continue;
      }

      log(`[DRY RUN] Would pick up review ${issue.identifier} "${issue.title}"`);
      log(`  repo: ${resolved.url} (${resolved.source})`);
      log(`  PR: ${prInfo.prUrl}`);
      wouldPickUp++;
    }

    return { total: issues.length, wouldPickUp, skipped };
  }

  private async poll(): Promise<number> {
    const issues = await findReviewIssues(this.config.reviewTriggerLabel);

    for (const issue of issues) {
      if (this.activeIssueIds.has(issue.issueId)) {
        continue;
      }

      // Resolve repo URL
      const repoUrl = resolveRepoUrl(issue, this.config);
      if (!repoUrl) {
        logTask(issue.identifier, "Could not determine repository for review — skipping");
        continue;
      }

      // Extract PR URL from comments
      let comments: string[];
      try {
        comments = await getIssueComments(issue.issueId);
      } catch (err) {
        logTaskError(issue.identifier, `Failed to fetch comments: ${err}`);
        continue;
      }

      const prInfo = extractPrFromComments(comments);
      if (!prInfo) {
        logTask(issue.identifier, "No PR URL found in comments — skipping (will retry next poll)");
        try {
          await commentOnIssue(
            issue.issueId,
            "Review critter could not find a PR URL in the issue comments. Waiting for a `PR created: <url>` comment.",
          );
        } catch {
          // Best effort
        }
        continue;
      }

      const reviewTask: ReviewTask = {
        ...issue,
        repoUrl,
        prUrl: prInfo.prUrl,
        prNumber: prInfo.prNumber,
        prBranch: "", // resolved in spawner after checkout
      };

      this.activeIssueIds.add(issue.issueId);
      logTask(issue.identifier, `Picked up for review: ${issue.title} (PR #${prInfo.prNumber})`);

      this.spawner?.dispatch(reviewTask).then((result) => {
        this.activeIssueIds.delete(issue.issueId);
        if (result.success) {
          logTask(issue.identifier, result.merged ? "Review completed — merged" : "Review completed — needs changes");
        } else {
          logTask(issue.identifier, `Review failed: ${result.error}`);
        }
      }).catch((err) => {
        this.activeIssueIds.delete(issue.issueId);
        logTaskError(issue.identifier, `Review dispatch failed: ${err}`);
      });
    }

    return issues.length;
  }
}
