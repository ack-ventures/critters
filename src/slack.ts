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
