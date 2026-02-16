import { log, logError } from "./logger.js";

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

export function formatSuccess(identifier: string, title: string, prUrl: string): string {
  return `*${identifier}* — ${title}\nDraft PR created: ${prUrl}`;
}

export function formatFailure(identifier: string, title: string, error: string): string {
  return `*${identifier}* — ${title}\nFailed: ${error}`;
}
