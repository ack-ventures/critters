import { type MetricEvent, readAllMetrics } from "./metrics.js";
import { formatDuration } from "./utils.js";

const COMPLETION_EVENTS = new Set([
  "task_completed",
  "task_failed",
  "review_completed",
  "review_failed",
]);

const FAILED_EVENTS = new Set(["task_failed", "review_failed"]);

function statusFromEvent(event: MetricEvent["event"]): string {
  if (event === "task_completed" || event === "review_completed") return "completed";
  if (event === "task_failed" || event === "review_failed") return "failed";
  return event;
}

function formatDate(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "-";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function parseArgs(args: string[]): { last: number; failed: boolean; type: string | null; json: boolean } {
  let last = 20;
  let failed = false;
  let type: string | null = null;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--last") {
      const val = args[++i];
      const n = Number(val);
      if (!val || Number.isNaN(n) || n < 1 || !Number.isInteger(n)) {
        console.error(`Invalid --last value: ${val ?? "(missing)"}\nUsage: critters history [--last N] [--failed] [--type NAME] [--json]`);
        process.exit(1);
      }
      last = n;
    } else if (arg === "--failed") {
      failed = true;
    } else if (arg === "--type") {
      type = args[++i] ?? null;
      if (!type) {
        console.error("Missing value for --type\nUsage: critters history [--last N] [--failed] [--type NAME] [--json]");
        process.exit(1);
      }
    } else if (arg === "--json") {
      json = true;
    }
  }

  return { last, failed, type, json };
}

export async function runHistory(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  const allMetrics = readAllMetrics();
  if (allMetrics.length === 0) {
    console.log("No history found.");
    return;
  }

  // Filter to completion/failure events
  let results = allMetrics.filter((m) => COMPLETION_EVENTS.has(m.event));

  // Apply --failed filter
  if (opts.failed) {
    results = results.filter((m) => FAILED_EVENTS.has(m.event));
  }

  // Apply --type filter
  if (opts.type) {
    results = results.filter((m) => m.critterType === opts.type);
  }

  if (results.length === 0) {
    console.log("No matching runs found.");
    return;
  }

  // Sort by timestamp descending
  results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Slice to --last N
  results = results.slice(0, opts.last);

  if (opts.json) {
    const jsonOutput = results.map((m) => ({
      identifier: m.identifier ?? null,
      type: m.critterType ?? null,
      status: statusFromEvent(m.event),
      duration: m.duration != null ? formatDuration(m.duration) : null,
      durationMs: m.duration ?? null,
      cost: m.costUsd ?? null,
      date: m.timestamp,
    }));
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }

  // Table output
  const headers = ["Identifier", "Type", "Status", "Duration", "Cost", "Date"];
  const rows = results.map((m) => [
    m.identifier ?? "-",
    m.critterType ?? "-",
    statusFromEvent(m.event),
    m.duration != null ? formatDuration(m.duration) : "-",
    m.costUsd != null ? `$${m.costUsd.toFixed(2)}` : "-",
    formatDate(m.timestamp),
  ]);

  // Calculate column widths
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );

  // Print header
  console.log(headers.map((h, i) => h.padEnd(widths[i])).join("  "));

  // Print rows
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(widths[i])).join("  "));
  }
}
