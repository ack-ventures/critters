import { logError } from "./logger.js";

export async function sendSlackNotification(
  webhookUrl: string | undefined,
  message: string,
): Promise<void> {
  if (!webhookUrl) return;

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });

    if (!response.ok) {
      logError(`Slack webhook returned ${response.status}`);
    }
  } catch (err) {
    logError(`Slack notification failed: ${err}`);
  }
}

export function formatSuccess(identifier: string, title: string, prUrl: string, duration?: string): string {
  const durationSuffix = duration ? ` (completed in ${duration})` : "";
  return `*${identifier}* — ${title}\nPR created: ${prUrl}${durationSuffix}`;
}

export function formatFailure(identifier: string, title: string, error: string, duration?: string): string {
  const durationPrefix = duration ? ` after ${duration}` : "";
  return `*${identifier}* — ${title}\nFailed${durationPrefix}: ${error}`;
}

export function formatReviewMerged(identifier: string, title: string, prUrl: string, duration?: string): string {
  const durationSuffix = duration ? ` (reviewed in ${duration})` : "";
  return `*${identifier}* — ${title}\nPR merged: ${prUrl}${durationSuffix}`;
}

export function formatReviewNeedsChanges(identifier: string, title: string, reason: string, duration?: string): string {
  const durationSuffix = duration ? ` (reviewed in ${duration})` : "";
  return `*${identifier}* — ${title}\nNeeds changes: ${reason}${durationSuffix}`;
}

export function formatReviewFailure(identifier: string, title: string, error: string, duration?: string): string {
  const durationPrefix = duration ? ` after ${duration}` : "";
  return `*${identifier}* — ${title}\nReview failed${durationPrefix}: ${error}`;
}

export function formatTaskPickedUp(identifier: string, title: string, repoUrl: string): string {
  return `*${identifier}* — ${title}\nPicked up — cloning ${repoUrl}...`;
}

export function formatPlanningComplete(
  identifier: string,
  title: string,
  numTurns?: number,
  costUsd?: number,
): string {
  const stats: string[] = [];
  if (numTurns != null) stats.push(`${numTurns} turns`);
  if (costUsd != null) stats.push(`$${costUsd.toFixed(2)}`);
  const suffix = stats.length > 0 ? ` (${stats.join(", ")})` : "";
  return `*${identifier}* — ${title}\nPlanning complete${suffix} — executing...`;
}

export function formatReviewStarted(identifier: string, title: string, prUrl: string): string {
  return `*${identifier}* — ${title}\nReview started: ${prUrl}`;
}

export function formatTimeoutWarning(
  identifier: string,
  title: string,
  elapsedMinutes: number,
  timeoutMinutes: number,
): string {
  return `*${identifier}* — ${title}\n⚠️ Running for ${elapsedMinutes}/${timeoutMinutes} minutes`;
}
