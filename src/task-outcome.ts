import type { CritterTypeConfig } from "./critter-type.js";
import { logTaskError } from "./logger.js";
import type { IssueTracker, TrackerTask } from "./tracker/types.js";

export interface TaskResult {
  success: boolean;
  prUrl?: string;
  merged?: boolean;
  error?: string;
}

export async function applyOutcome(
  outcome: { status?: string; removeLabel?: boolean } | undefined,
  task: TrackerTask,
  critterType: CritterTypeConfig,
  tracker: IssueTracker,
): Promise<void> {
  if (outcome?.status) {
    await tracker.updateStatus(task.id, outcome.status, task.groupId, task.identifier);
  }
  if (outcome?.removeLabel) {
    try {
      await tracker.removeLabel(task.id, critterType.trigger.label);
    } catch (err) {
      logTaskError(task.identifier, `Failed to remove label "${critterType.trigger.label}": ${err}`);
    }
  }
}
