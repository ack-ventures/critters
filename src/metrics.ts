import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { logError } from "./logger.js";

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
