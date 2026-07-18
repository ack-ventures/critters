import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { loadConfig } from "./config.js";
import type { CritterTypeConfig } from "./critter-type.js";
import { formatError } from "./logger.js";
import { createTracker } from "./tracker/index.js";
import type { IssueTracker, IssueTrackerIssue, TrackerTask } from "./tracker/types.js";

function loadEnv(): void {
  const cwdEnv = "./.env";
  const userEnv = `${homedir()}/.critters/.env`;
  if (!existsSync(cwdEnv) && existsSync(userEnv)) {
    const envContent = readFileSync(userEnv, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

export async function runRetry(identifier: string, force: boolean): Promise<void> {
  loadEnv();

  const config = loadConfig();

  // Build at most one tracker per provider used by the configured critter
  // types (mirrors runRetryAllFailed). We don't know which critter type owns
  // this issue up front, so look it up per provider and match by trigger label.
  const trackerMap = new Map<string, IssueTracker>();
  const getTracker = (provider: string): IssueTracker => {
    let tracker = trackerMap.get(provider);
    if (!tracker) {
      tracker = createTracker({
        type: provider as "linear" | "jira",
        apiKey: config.linear.apiKey,
        host: config.jira.host,
        email: config.jira.email,
        apiToken: config.jira.apiToken,
        statusMap: config.jira.statusMap,
      });
      trackerMap.set(provider, tracker);
    }
    return tracker;
  };

  // Cache issue lookups per provider so we never re-fetch the same provider.
  const issueByProvider = new Map<string, IssueTrackerIssue | null>();
  const lookupIssue = async (provider: string, tracker: IssueTracker): Promise<IssueTrackerIssue | null> => {
    if (!issueByProvider.has(provider)) {
      issueByProvider.set(provider, await tracker.findIssueByIdentifier(identifier));
    }
    return issueByProvider.get(provider) ?? null;
  };

  // Find the critter type whose trigger label this issue carries, using that
  // type's provider. This keeps retry config-aware: the matched type drives the
  // retry target status and the recognized failure status.
  let matched: { type: CritterTypeConfig; tracker: IssueTracker; issue: IssueTrackerIssue } | null = null;
  let foundIssue: IssueTrackerIssue | null = null;
  for (const ct of config.critterTypes) {
    const provider = ct.provider ?? config.provider;
    const tracker = getTracker(provider);
    const issue = await lookupIssue(provider, tracker);
    if (!issue) continue;
    foundIssue = issue;
    if (issue.labels.includes(ct.trigger.label)) {
      matched = { type: ct, tracker, issue };
      break;
    }
  }

  if (!foundIssue) {
    console.error(`Error: Issue ${identifier} not found.`);
    process.exit(1);
  }

  if (!matched) {
    const labelList = config.critterTypes.map((ct) => `"${ct.trigger.label}"`).join(" or ");
    console.error(
      `Error: ${identifier} isn't a critter task (missing ${labelList} label).`,
    );
    process.exit(1);
  }

  const { type, tracker, issue } = matched;
  const retryStatus = type.trigger.status;
  const failureStatus = type.outcomes.failure?.status ?? "Critter Failed";
  const statusName = issue.statusName;

  if (statusName === retryStatus) {
    console.log(
      `${identifier} is already in ${retryStatus} — it will be picked up on the next poll.`,
    );
    return;
  }

  if (statusName === "In Progress" || statusName === "In Review") {
    console.error(`Error: ${identifier} is currently being worked on.`);
    process.exit(1);
  }

  if (statusName === failureStatus) {
    // Always allowed — no force needed
  } else if (statusName === "Human Review") {
    if (!force) {
      console.error(
        `Error: ${identifier} was flagged for human review. Use --force to override.`,
      );
      process.exit(1);
    }
  } else if (statusName === "Done") {
    if (!force) {
      console.error(`Error: ${identifier} is already completed.`);
      process.exit(1);
    }
  } else {
    if (!force) {
      console.error(
        `Error: ${identifier} is in unexpected status '${statusName}'. Use --force to override.`,
      );
      process.exit(1);
    }
  }

  await tracker.updateStatus(issue.id, retryStatus, issue.groupId);
  await tracker.comment(issue.id, "Retry triggered via CLI");

  console.log(
    `Retried ${identifier} — status set to ${retryStatus}. The daemon will pick it up on the next poll cycle.`,
  );
}

interface FailedIssue {
  task: TrackerTask;
  tracker: IssueTracker;
  targetStatus: string;
}

export function parseDuration(s: string): number | null {
  const match = s.match(/^(\d+)(h|d|w)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { h: 3600000, d: 86400000, w: 604800000 };
  return value * multipliers[unit];
}

export async function runRetryAllFailed(options: {
  dryRun: boolean;
  since?: string;
  typeName?: string;
}): Promise<void> {
  loadEnv();
  const config = loadConfig();

  // Determine which critter types to query
  let typesToQuery: CritterTypeConfig[] = config.critterTypes;
  if (options.typeName) {
    typesToQuery = config.critterTypes.filter(
      (ct) => ct.name === options.typeName || ct.name.startsWith(options.typeName + ":"),
    );
    if (typesToQuery.length === 0) {
      console.error(`Error: Unknown critter type "${options.typeName}".`);
      process.exit(1);
    }
  }

  // Parse --since if provided
  let sinceCutoff: number | null = null;
  if (options.since) {
    const durationMs = parseDuration(options.since);
    if (durationMs === null) {
      console.error(`Error: Invalid --since format "${options.since}". Use e.g. 24h, 3d, 1w.`);
      process.exit(1);
    }
    sinceCutoff = Date.now() - durationMs;
  }

  // Build tracker map (one per unique provider)
  const trackerMap = new Map<string, IssueTracker>();
  for (const ct of typesToQuery) {
    const provider = ct.provider ?? config.provider;
    if (!trackerMap.has(provider)) {
      trackerMap.set(provider, createTracker({
        type: provider,
        apiKey: config.linear.apiKey,
        host: config.jira.host,
        email: config.jira.email,
        apiToken: config.jira.apiToken,
        statusMap: config.jira.statusMap,
      }));
    }
  }

  // Query failed issues for each critter type
  const seen = new Set<string>();
  const failedIssues: FailedIssue[] = [];

  for (const ct of typesToQuery) {
    const provider = ct.provider ?? config.provider;
    const tracker = trackerMap.get(provider)!;
    const failureStatus = ct.outcomes.failure?.status ?? "Critter Failed";
    const targetStatus = ct.trigger.status;

    const tasks = await tracker.findIssues({
      label: ct.trigger.label,
      status: failureStatus,
    });

    for (const task of tasks) {
      const dedupeKey = `${provider}:${task.identifier}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      // Apply --since filter
      if (sinceCutoff !== null && task.updatedAt && task.updatedAt.getTime() < sinceCutoff) {
        continue;
      }

      failedIssues.push({ task, tracker, targetStatus });
    }
  }

  if (failedIssues.length === 0) {
    console.log("No failed critters found.");
    return;
  }

  console.log(`Found ${failedIssues.length} failed critter${failedIssues.length === 1 ? "" : "s"}:`);
  for (const { task } of failedIssues) {
    console.log(`  - ${task.identifier}: ${task.title}`);
  }

  if (options.dryRun) {
    console.log("Dry run — no changes made.");
    return;
  }

  console.log("Retrying...");
  let succeeded = 0;
  for (const { task, tracker, targetStatus } of failedIssues) {
    try {
      await tracker.updateStatus(task.id, targetStatus, task.groupId);
      await tracker.comment(task.id, "Bulk retry triggered via CLI");
      console.log(`  Retried ${task.identifier}`);
      succeeded++;
    } catch (err) {
      console.error(`  Failed to retry ${task.identifier}: ${formatError(err)}`);
    }
  }

  console.log(`Retried ${succeeded}/${failedIssues.length} critters.`);
}
