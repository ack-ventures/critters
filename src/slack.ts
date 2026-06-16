import { logError, logTaskError } from "./logger.js";
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

  async notify(issueId: string, message: string, identifier?: string): Promise<void> {
    const logErr = identifier
      ? (msg: string) => logTaskError(identifier, msg)
      : (msg: string) => logError(msg);
    try {
      if (this.botToken && this.channel) {
        await this.sendViaWebApi(issueId, message, identifier);
      } else if (this.webhookUrl) {
        await this.sendViaWebhook(message, identifier);
      }
    } catch (err) {
      logErr(`Slack notification failed: ${err}`);
    }
  }

  clearThread(issueId: string): void {
    this.threadMap.delete(issueId);
  }

  private async sendViaWebApi(issueId: string, message: string, identifier?: string): Promise<void> {
    const channel = this.channel as string;
    const logErr = identifier
      ? (msg: string) => logTaskError(identifier, msg)
      : (msg: string) => logError(msg);
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
          logErr(`Slack notification failed, retrying in ${Math.round(delayMs)}ms... (attempt ${attempt + 1}/2)`);
        },
      },
    );
  }

  private async sendViaWebhook(message: string, identifier?: string): Promise<void> {
    const webhookUrl = this.webhookUrl as string;
    const logErr = identifier
      ? (msg: string) => logTaskError(identifier, msg)
      : (msg: string) => logError(msg);
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
          logErr(`Slack notification failed, retrying in ${Math.round(delayMs)}ms... (attempt ${attempt + 1}/2)`);
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

/**
 * Escape text for Slack mrkdwn. Per Slack's rules only `&`, `<` and `>` must be
 * encoded (in that order — `&` first). This neutralizes injection of control
 * sequences like `<!channel>`, `<@U123>` and `<url|text>` via untrusted
 * free-text fields (issue titles, error messages, reasons). URL fields are left
 * verbatim: escaping `&` to `&amp;` would corrupt query strings and break
 * Slack's auto-linking.
 */
export function escapeSlackText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatSuccess(identifier: string, title: string, prUrl: string, duration?: string): string {
  const durationSuffix = duration ? ` (completed in ${duration})` : "";
  return `*${escapeSlackText(identifier)}* — ${escapeSlackText(title)}\nPR created: ${prUrl}${durationSuffix}`;
}

export function formatFailure(identifier: string, title: string, error: string, duration?: string): string {
  const durationPrefix = duration ? ` after ${duration}` : "";
  return `*${escapeSlackText(identifier)}* — ${escapeSlackText(title)}\nFailed${durationPrefix}: ${escapeSlackText(error)}`;
}

export function formatReviewMerged(identifier: string, title: string, prUrl: string, duration?: string): string {
  const durationSuffix = duration ? ` (reviewed in ${duration})` : "";
  return `*${escapeSlackText(identifier)}* — ${escapeSlackText(title)}\nPR merged: ${prUrl}${durationSuffix}`;
}

export function formatReviewNeedsChanges(identifier: string, title: string, reason: string, duration?: string): string {
  const durationSuffix = duration ? ` (reviewed in ${duration})` : "";
  return `*${escapeSlackText(identifier)}* — ${escapeSlackText(title)}\nNeeds changes: ${escapeSlackText(reason)}${durationSuffix}`;
}

export function formatReviewFailure(identifier: string, title: string, error: string, duration?: string): string {
  const durationPrefix = duration ? ` after ${duration}` : "";
  return `*${escapeSlackText(identifier)}* — ${escapeSlackText(title)}\nReview failed${durationPrefix}: ${escapeSlackText(error)}`;
}

export function formatTaskPickedUp(identifier: string, title: string, repoUrl: string): string {
  return `*${escapeSlackText(identifier)}* — ${escapeSlackText(title)}\nPicked up — cloning ${repoUrl}...`;
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
  return `*${escapeSlackText(identifier)}* — ${escapeSlackText(title)}\nPlanning complete${suffix} — executing...`;
}

export function formatReviewStarted(identifier: string, title: string, prUrl: string): string {
  return `*${escapeSlackText(identifier)}* — ${escapeSlackText(title)}\nReview started: ${prUrl}`;
}

export function formatTimeoutWarning(
  identifier: string,
  title: string,
  elapsedMinutes: number,
  timeoutMinutes: number,
): string {
  return `*${escapeSlackText(identifier)}* — ${escapeSlackText(title)}\n⚠️ Running for ${elapsedMinutes}/${timeoutMinutes} minutes`;
}

export function formatCostBudgetExceeded(
  identifier: string,
  title: string,
  costUsd: number,
  budget: number,
  currentPhase: string,
): string {
  return `*${escapeSlackText(identifier)}* — ${escapeSlackText(title)}\n:no_entry: Killed: cost budget exceeded ($${costUsd.toFixed(2)} spent, $${budget.toFixed(2)} budget) — killed during phase: ${escapeSlackText(currentPhase)}`;
}

export function formatCostAlert(
  identifier: string,
  title: string,
  costUsd: number,
  threshold: number,
  currentPhase: string,
): string {
  return `*${escapeSlackText(identifier)}* — ${escapeSlackText(title)}\n⚠️ Cost alert: spent *$${costUsd.toFixed(2)}* (threshold: $${threshold.toFixed(2)}) — currently in phase: ${escapeSlackText(currentPhase)}`;
}
