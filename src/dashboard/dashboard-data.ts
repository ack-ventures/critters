import type { HealthStatus } from "../health.js";
import { getRecentMetrics, type MetricEvent } from "../metrics.js";
import type { PrStatus } from "../pr-status.js";
import type { ActiveCritterDetail, QueuedCritterDetail } from "../types.js";
import { getDisplayVersion } from "../updater.js";
import { computeDailyStats, type DayStat, inferType } from "./helpers.js";

export interface DashboardActivity {
  event: MetricEvent["event"];
  identifier: string;
  title: string | null;
  critterType: string;
  repo: string;
  timestamp: string;
  duration: number | null;
  costUsd: number | null;
  prUrl: string | null;
  prStatus: PrStatus | null;
  issueUrl: string | null;
}

export interface TypeAggregate {
  total: number;
  succeeded: number;
  failed: number;
  totalCost: number;
  avgDuration: number | null;
}

export interface DashboardData {
  version: string;
  uptimeMs: number;
  lastPollAt: string | null;
  pollIntervalSeconds: number;
  concurrency: { active: number; max: number };
  typeFilter: string | null;
  allTypes: string[];

  activeCritters: ActiveCritterDetail[];
  queuedCritters: QueuedCritterDetail[];

  totals: {
    totalTasks: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    totalCost: number;
    avgCost: number | null;
    avgDuration: number | null;
  };

  typeStats: Record<string, TypeAggregate>;
  daily: DayStat[];
  activity: DashboardActivity[];
}

export function buildDashboardData(
  status: HealthStatus,
  uptimeMs: number,
  typeFilter: string | undefined,
  prStatuses: Map<string, PrStatus> | undefined,
): DashboardData {
  const allMetrics = getRecentMetrics(10000);
  const allTypes = [...new Set(allMetrics.map(m => inferType(m)).filter(Boolean))].sort();

  const filtered = typeFilter ? allMetrics.filter(m => inferType(m) === typeFilter) : allMetrics;
  const tasks = filtered.filter(
    (m) => m.event === "task_completed" || m.event === "task_failed" ||
           m.event === "review_completed" || m.event === "review_failed",
  );

  const totalTasks = tasks.length;
  const succeeded = tasks.filter((m) => m.event === "task_completed" || m.event === "review_completed").length;
  const failed = totalTasks - succeeded;
  const successRate = totalTasks > 0 ? Math.round((succeeded / totalTasks) * 100) : null;
  const totalCost = tasks.reduce((s, m) => s + (m.costUsd ?? 0), 0);
  const avgCost = totalTasks > 0 ? totalCost / totalTasks : null;
  const durations = tasks.map(m => m.duration).filter((d): d is number => d != null && !Number.isNaN(d));
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  const typeStats: Record<string, TypeAggregate> = {};
  for (const m of tasks) {
    const t = inferType(m);
    let entry = typeStats[t];
    if (!entry) {
      entry = { total: 0, succeeded: 0, failed: 0, totalCost: 0, avgDuration: null };
      typeStats[t] = entry;
    }
    entry.total++;
    if (m.event === "task_completed" || m.event === "review_completed") entry.succeeded++;
    else entry.failed++;
    entry.totalCost += m.costUsd ?? 0;
  }
  // Second pass for avg duration
  for (const t of Object.keys(typeStats)) {
    const durs = tasks.filter(m => inferType(m) === t).map(m => m.duration).filter((d): d is number => d != null && !Number.isNaN(d));
    typeStats[t].avgDuration = durs.length > 0 ? durs.reduce((a, b) => a + b, 0) / durs.length : null;
  }

  const daily = computeDailyStats(filtered, 14);

  const activity: DashboardActivity[] = tasks.slice(-50).reverse().map((m) => {
    const repo = (m.repoUrl ?? "").split("/").pop()?.replace(/\.git$/, "") ?? "";
    return {
      event: m.event,
      identifier: m.identifier ?? m.issueId ?? "",
      title: null, // not stored in metrics
      critterType: inferType(m),
      repo,
      timestamp: m.timestamp,
      duration: m.duration ?? null,
      costUsd: m.costUsd ?? null,
      prUrl: m.prUrl ?? null,
      prStatus: m.prUrl && prStatuses ? (prStatuses.get(m.prUrl) ?? null) : null,
      issueUrl: m.issueUrl ?? null,
    };
  });

  const concurrencyActive = Object.values(status.perType).reduce((s, c) => s + c.active, 0);

  return {
    version: getDisplayVersion(),
    uptimeMs,
    lastPollAt: status.lastPollAt,
    pollIntervalSeconds: status.pollIntervalSeconds,
    concurrency: { active: concurrencyActive, max: status.concurrencyMax },
    typeFilter: typeFilter ?? null,
    allTypes,

    activeCritters: status.activeCritterDetails,
    queuedCritters: status.queuedCritterDetails,

    totals: {
      totalTasks,
      succeeded,
      failed,
      successRate,
      totalCost,
      avgCost,
      avgDuration,
    },
    typeStats,
    daily,
    activity,
  };
}
