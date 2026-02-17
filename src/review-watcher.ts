import { commentOnIssue, findReviewIssues, getIssueComments } from "./linear.js";
import { log, logError, logTask, logTaskError } from "./logger.js";
import { recordMetric } from "./metrics.js";
import { resolveRepoUrl } from "./prompt.js";
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
  private spawner: ReviewSpawner;
  private activeIssueIds = new Set<string>();
  private stopped = false;

  constructor(config: Config, spawner: ReviewSpawner) {
    this.config = config;
    this.spawner = spawner;
  }

  async start(): Promise<void> {
    log("Polling Linear for review issues...");

    while (!this.stopped) {
      try {
        const issuesFound = await this.poll();
        recordMetric({ timestamp: "", event: "poll_completed", outcome: `${issuesFound} review issues found` });
      } catch (err) {
        logError(`Review poll failed: ${err}`);
      }

      await sleep(this.config.pollIntervalSeconds * 1000);
    }
  }

  stop(): void {
    this.stopped = true;
    this.spawner.stop();
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

      this.spawner.dispatch(reviewTask).then((result) => {
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
