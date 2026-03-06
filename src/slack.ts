import { logError } from "./logger.js";
import { withRetry } from "./retry.js";

export interface SlackNotifierConfig {
  webhookUrl?: string;
  botToken?: string;
  channel?: string;
}

export class SlackNotifier {
  private botToken: string | undefined;
  private channel: string | undefined;
  private webhookUrl: string | undefined;
  private threadMap = new Map<string, string>();

  constructor(config: SlackNotifierConfig) {
    this.botToken = config.botToken;
    this.channel = config.channel;
    this.webhookUrl = config.webhookUrl;
  }

  get isConfigured(): boolean {
    return !!(this.botToken && this.channel) || !!this.webhookUrl;
  }

  async notify(issueId: string, message: string): Promise<void> {
    try {
      if (this.botToken && this.channel) {
        await this.sendViaWebApi(issueId, message);
      } else if (this.webhookUrl) {
        await this.sendViaWebhook(message);
      }
    } catch (err) {
      logError(`Slack notification failed: ${err}`);
    }
  }

  clearThread(issueId: string): void {
    this.threadMap.delete(issueId);
  }

  private async sendViaWebApi(issueId: string, message: string): Promise<void> {
    const channel = this.channel as string;
    await withRetry(
      async () => {
        const threadTs = this.threadMap.get(issueId);
        const payload: Record<string, string> = {
          channel,
          text: message,
        };
        if (threadTs) {
          payload.thread_ts = threadTs;
        }

        const response = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.botToken}`,
          },
          body: JSON.stringify(payload),
        });

        const body = await response.json() as { ok: boolean; ts?: string; error?: string };
        if (!body.ok) {
          throw new Error(`Slack API error: ${body.error ?? "unknown"}`);
        }

        if (!threadTs && body.ts) {
          this.threadMap.set(issueId, body.ts);
        }
      },
      {
        maxRetries: 2,
        baseDelayMs: 1000,
        onRetry: (_error, attempt, delayMs) => {
          logError(`Slack notification failed, retrying in ${Math.round(delayMs)}ms... (attempt ${attempt + 1}/2)`);
        },
      },
    );
  }

  private async sendViaWebhook(message: string): Promise<void> {
    const webhookUrl = this.webhookUrl as string;
    await withRetry(
      async () => {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message }),
        });

        if (!response.ok) {
          throw new Error(`Slack webhook returned ${response.status}`);
        }
      },
      {
        maxRetries: 2,
        baseDelayMs: 1000,
        onRetry: (_error, attempt, delayMs) => {
          logError(`Slack notification failed, retrying in ${Math.round(delayMs)}ms... (attempt ${attempt + 1}/2)`);
        },
      },
    );
  }
}

export async function sendSlackNotification(
  webhookUrl: string | undefined,
  message: string,
): Promise<void> {
  if (!webhookUrl) return;

  try {
    await withRetry(
      async () => {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message }),
        });

        if (!response.ok) {
          throw new Error(`Slack webhook returned ${response.status}`);
        }
      },
      {
        maxRetries: 2,
        baseDelayMs: 1000,
        onRetry: (_error, attempt, delayMs) => {
          logError(`Slack notification failed, retrying in ${Math.round(delayMs)}ms... (attempt ${attempt + 1}/2)`);
        },
      },
    );
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

export function formatCostAlert(
  identifier: string,
  title: string,
  costUsd: number,
  threshold: number,
  currentPhase: string,
): string {
  return `*${identifier}* — ${title}\n⚠️ Cost alert: spent *$${costUsd.toFixed(2)}* (threshold: $${threshold.toFixed(2)}) — currently in phase: ${currentPhase}`;
}
