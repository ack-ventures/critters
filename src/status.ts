import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import type { MetricEvent } from "./metrics.js";
import { formatDuration } from "./utils.js";
import { VERSION } from "./version.js";

function getStatusConfig(): { healthPort: number; concurrency: number; reviewConcurrency: number } {
  const candidates = [
    "./critters.config.yaml",
    `${homedir()}/.critters/config.yaml`,
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, "utf-8");
        const yaml = parseYaml(raw) as Record<string, unknown>;
        return {
          healthPort: (yaml.healthPort as number) ?? 3847,
          concurrency: (yaml.concurrency as number) ?? 2,
          reviewConcurrency: (yaml.reviewConcurrency as number) ?? 2,
        };
      } catch {
        // Fall through to defaults if parsing fails
      }
    }
  }

  return { healthPort: 3847, concurrency: 2, reviewConcurrency: 2 };
}

function formatLastPoll(isoTimestamp: string | null): string {
  if (!isoTimestamp) return "never";
  const delta = Date.now() - new Date(isoTimestamp).getTime();
  return `${formatDuration(delta)} ago`;
}

function filterTodayMetrics(metrics: MetricEvent[]): MetricEvent[] {
  const today = new Date().toDateString();
  return metrics.filter((m) => new Date(m.timestamp).toDateString() === today);
}

function aggregateTodayStats(metrics: MetricEvent[]): { completed: number; failed: number; cost: number } {
  let completed = 0;
  let failed = 0;
  let cost = 0;
  for (const m of metrics) {
    if (m.event === "task_completed") {
      completed++;
      cost += m.costUsd ?? 0;
    } else if (m.event === "task_failed") {
      failed++;
      cost += m.costUsd ?? 0;
    }
  }
  return { completed, failed, cost };
}

export async function runStatus(): Promise<void> {
  const config = getStatusConfig();
  const baseUrl = `http://localhost:${config.healthPort}`;

  // Fetch health status
  let health: {
    uptime: number;
    version: string;
    displayVersion?: string;
    activeCritters: number;
    queuedCritters: number;
    activeReviews: number;
    queuedReviews: number;
    lastPollAt: string | null;
    activeCritterDetails?: Array<{
      identifier: string;
      title: string;
      phase: string;
      repo: string;
      branch: string;
      elapsed: string;
    }>;
  };

  try {
    const resp = await fetch(`${baseUrl}/healthz`);
    health = await resp.json();
  } catch {
    console.error("Critters daemon is not running (or health endpoint is disabled)");
    process.exit(1);
  }

  // Fetch metrics (non-fatal)
  let metricsLine: string;
  try {
    const resp = await fetch(`${baseUrl}/metrics`);
    const metrics: MetricEvent[] = await resp.json();
    const todayMetrics = filterTodayMetrics(metrics);
    const stats = aggregateTodayStats(todayMetrics);
    metricsLine = `Today: ${stats.completed} completed, ${stats.failed} failed, $${stats.cost.toFixed(2)} total cost`;
  } catch {
    metricsLine = "Today: (metrics unavailable)";
  }

  const uptimeStr = formatDuration(health.uptime * 1000);
  const lastPoll = formatLastPoll(health.lastPollAt);

  console.log(`Critters ${health.displayVersion ?? `v${health.version ?? VERSION}`} — running for ${uptimeStr}

Active critters: ${health.activeCritters}/${config.concurrency}
Active reviews:  ${health.activeReviews}/${config.reviewConcurrency}
Queued: ${health.queuedCritters} critters, ${health.queuedReviews} reviews

Last poll: ${lastPoll}
${metricsLine}`);

  if (health.activeCritterDetails && health.activeCritterDetails.length > 0) {
    console.log("");
    for (const d of health.activeCritterDetails) {
      const phaseLabel = d.phase === "plan" ? "planning" : d.phase === "exec" ? "execution" : "review";
      console.log(`  [${d.identifier}] ${phaseLabel} | ${d.repo} | ${d.branch} | ${d.elapsed}`);
    }
  }
}
