import { commentOnIssue, findCritterIssues } from "./linear.js";
import { log, logError, logTask, logTaskError } from "./logger.js";
import { resolveRepoUrl } from "./prompt.js";
import type { Spawner } from "./spawner.js";
import type { Config } from "./types.js";
import { sleep } from "./utils.js";

export class Watcher {
  private config: Config;
  private spawner: Spawner;
  private activeIssueIds = new Set<string>();
  private stopped = false;

  constructor(config: Config, spawner: Spawner) {
    this.config = config;
    this.spawner = spawner;
  }

  async start(): Promise<void> {
    log("Polling Linear...");

    while (!this.stopped) {
      try {
        await this.poll();
      } catch (err) {
        logError(`Poll failed: ${err}`);
      }

      await sleep(this.config.pollIntervalSeconds * 1000);
    }
  }

  stop(): void {
    this.stopped = true;
    this.spawner.stop();
  }

  private async poll(): Promise<void> {
    const issues = await findCritterIssues(this.config.triggerLabel);

    for (const task of issues) {
      if (this.activeIssueIds.has(task.issueId)) {
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
      this.spawner.dispatch(task).then((result) => {
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
  }
}
