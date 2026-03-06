import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { log, logError } from "./logger.js";

export type MetricEvent = {
  timestamp: string;
  event:
    | "task_started"
    | "task_completed"
    | "task_failed"
    | "review_started"
    | "review_completed"
    | "review_failed"
    | "poll_completed";
  issueId?: string;
  identifier?: string;
  repoUrl?: string;
  duration?: number;
  phase?: "planning" | "execution" | "review";
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
  prUrl?: string;
  outcome?: string;
  error?: string;
  critterType?: string;
};

let metricsFile: string | null = null;

export function initMetrics(filePath?: string): void {
  metricsFile = filePath ?? join(homedir(), ".critters", "metrics.jsonl");
  const dir = dirname(metricsFile);
  mkdirSync(dir, { recursive: true });
}

export function recordMetric(event: MetricEvent): void {
  if (!metricsFile) return;
  if (!event.timestamp) {
    event.timestamp = new Date().toISOString();
  }
  try {
    appendFileSync(metricsFile, JSON.stringify(event) + "\n");
  } catch (err) {
    logError(`Failed to write metric: ${err}`);
  }
}

export function getRecentMetrics(n: number): MetricEvent[] {
  if (!metricsFile) return [];
  try {
    const content = readFileSync(metricsFile, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    return lines.slice(-n).flatMap((line) => {
      try {
        return [JSON.parse(line) as MetricEvent];
      } catch {
        logError(`Skipping corrupted metric line: ${line.slice(0, 100)}`);
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function pruneMetrics(retentionDays: number): void {
  if (!metricsFile) return;
  if (!existsSync(metricsFile)) return;

  let content: string;
  try {
    content = readFileSync(metricsFile, "utf-8");
  } catch {
    return;
  }

  const lines = content.split("\n").filter(Boolean);
  if (lines.length === 0) return;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let pruned = 0;

  const surviving = lines.filter((line) => {
    try {
      const entry = JSON.parse(line) as MetricEvent;
      if (new Date(entry.timestamp).getTime() < cutoff) {
        pruned++;
        return false;
      }
      return true;
    } catch {
      // Keep unparseable lines
      return true;
    }
  });

  if (pruned === 0) return;

  const tmpFile = `${metricsFile}.tmp`;
  try {
    writeFileSync(tmpFile, surviving.length > 0 ? surviving.join("\n") + "\n" : "");
    renameSync(tmpFile, metricsFile);
    log(`Pruned ${pruned} metrics older than ${retentionDays} days (${surviving.length} remaining)`);
  } catch (err) {
    logError(`Failed to prune metrics: ${err}`);
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore cleanup failure
    }
  }
}
