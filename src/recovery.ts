import type { CritterTypeConfig, TriggerConfig } from "./critter-type.js";
import { formatError, log, logError } from "./logger.js";
import type { IssueTracker, TrackerTask } from "./tracker/types.js";
import type { Config } from "./types.js";
import type { UnifiedSpawner } from "./unified-spawner.js";
import { getTracker } from "./utils.js";

interface RecoveryCandidate {
  critterType: CritterTypeConfig;
  issue: TrackerTask;
  tracker: IssueTracker;
}

/**
 * Recover orphaned issues that were left in claimStatus after a daemon crash.
 * For each critter type with a claimStatus, queries the tracker for issues
 * matching that claimed state and reverts any that are not currently active
 * or queued back to the trigger status so the poll loop picks them up.
 */
export async function recoverOrphanedIssues(
  config: Config,
  trackers: Map<string, IssueTracker>,
  spawner: UnifiedSpawner,
  startupActiveIdentifiers: Set<string> = new Set(),
): Promise<void> {
  // Track recovered issue IDs across types to avoid double-processing
  // when multiple types share the same claimStatus
  const recoveredIds = new Set<string>();
  let recoveredCount = 0;

  // Build active/queued identifier sets for quick lookups
  const activeIdentifiers = new Set(
    spawner.getActiveDetails().map((d) => d.identifier),
  );
  for (const identifier of startupActiveIdentifiers) {
    activeIdentifiers.add(identifier);
  }
  const queuedIdentifiers = new Set(
    spawner.getQueuedDetails().map((d) => d.identifier),
  );

  // Filter to types that have a claimStatus and where claimStatus !== trigger.status
  const recoverableTypes = config.critterTypes.filter(
    (ct) => ct.claimStatus && ct.claimStatus !== ct.trigger.status,
  );

  if (recoverableTypes.length === 0) {
    return;
  }

  const results = await Promise.allSettled(
    recoverableTypes.map(async (critterType) => {
      let tracker: IssueTracker;
      try {
        tracker = getTracker(critterType, config, trackers);
      } catch (err) {
        logError(`Orphan recovery skipped for type "${critterType.name}": ${formatError(err)}`);
        return [];
      }

      const claimStatus = critterType.claimStatus;
      if (!claimStatus) return [];

      const orphanTrigger: TriggerConfig = {
        label: critterType.trigger.label,
        status: claimStatus,
        assignee: critterType.trigger.assignee,
      };

      let issues: TrackerTask[];
      try {
        issues = await tracker.findIssues(orphanTrigger);
      } catch (err) {
        logError(`Orphan recovery failed for type "${critterType.name}": ${formatError(err)}`);
        return [];
      }

      return issues.map((issue) => ({ critterType, issue, tracker }));
    }),
  );

  const candidates: RecoveryCandidate[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      candidates.push(...result.value);
    }
  }

  for (const { critterType, issue, tracker } of candidates) {
    // Skip if already recovered by another type with same claimStatus.
    if (recoveredIds.has(issue.id)) continue;

    // Skip if currently active or queued.
    if (activeIdentifiers.has(issue.identifier)) continue;
    if (queuedIdentifiers.has(issue.identifier)) continue;

    recoveredIds.add(issue.id);
    try {
      await tracker.updateStatus(
        issue.id,
        critterType.trigger.status,
        issue.groupId,
        issue.identifier,
      );
      recoveredCount++;
      log(`Recovered orphaned issue ${issue.identifier} from ${critterType.claimStatus} -> ${critterType.trigger.status}`);
    } catch (err) {
      logError(`Failed to recover issue ${issue.identifier}: ${formatError(err)}`);
    }
  }

  if (recoveredCount > 0) {
    log(`Orphan recovery complete: ${recoveredCount} issue(s) recovered`);
  } else {
    log("Orphan recovery complete: no orphaned issues found");
  }
}
