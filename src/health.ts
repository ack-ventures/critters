import { renderDashboard } from "./dashboard.js";
import { log } from "./logger.js";
import { getRecentMetrics } from "./metrics.js";
import type { ActiveCritterDetail } from "./types.js";
import { getDisplayVersion } from "./updater.js";
import { formatDuration } from "./utils.js";
import { VERSION } from "./version.js";

export interface HealthStatus {
  activeCritters: number;
  queuedCritters: number;
  activeReviews: number;
  queuedReviews: number;
  perType: Record<string, { active: number; queued: number }>;
  lastPollAt: string | null;
  activeCritterDetails: ActiveCritterDetail[];
}

let cachedSummary: { totalTasks: number; succeeded: number; failed: number; totalCost: number; avgCost: number } | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000;

export function resetMetricsSummaryCache(): void {
  cachedSummary = null;
  cachedAt = 0;
}

export function startHealthServer(
  port: number,
  getStatus: () => HealthStatus,
  metricsPath?: string,
  triggers?: {
    triggerPoll?: () => Promise<number>;
    triggerReviewPoll?: () => Promise<number>;
  },
): { stop: () => void } {
  const startTime = Date.now();

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/healthz") {
        const status = getStatus();
        const now = Date.now();
        return Response.json({
          status: "ok",
          uptime: Math.floor((now - startTime) / 1000),
          version: VERSION,
          displayVersion: getDisplayVersion(),
          activeCritters: status.activeCritters,
          queuedCritters: status.queuedCritters,
          activeReviews: status.activeReviews,
          queuedReviews: status.queuedReviews,
          perType: status.perType,
          lastPollAt: status.lastPollAt,
          metrics: computeMetricsSummary(),
          activeCritterDetails: status.activeCritterDetails.map((d) => ({
            identifier: d.identifier,
            title: d.title,
            phase: d.phase,
            repo: d.repo,
            branch: d.branch,
            elapsed: formatDuration(now - d.startedAt),
            prUrl: d.prUrl ?? null,
            timeoutMinutes: d.timeoutMinutes ?? null,
            critterType: d.critterType ?? null,
            workDir: d.workDir ?? null,
          })),
        });
      }

      if (url.pathname === "/metrics") {
        const entries = getRecentMetrics(100);
        return Response.json(entries);
      }

      if (url.pathname === "/" || url.pathname === "/dashboard") {
        const status = getStatus();
        const uptime = Date.now() - startTime;
        const typeFilter = url.searchParams.get("type") || undefined;
        const html = renderDashboard(metricsPath ?? "", status, uptime, typeFilter);
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/poll") {
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        if (!triggers?.triggerPoll) {
          return Response.json({ error: "Poll trigger not available" }, { status: 503 });
        }
        const issuesFound = await triggers.triggerPoll();
        return Response.json({ triggered: true, issuesFound });
      }

      if (url.pathname === "/review-poll") {
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        if (!triggers?.triggerReviewPoll) {
          return Response.json({ error: "Review poll trigger not available" }, { status: 503 });
        }
        const issuesFound = await triggers.triggerReviewPoll();
        return Response.json({ triggered: true, issuesFound });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  log(`Health server listening on port ${server.port}`);

  return {
    stop: () => server.stop(),
  };
}

function computeMetricsSummary(): { totalTasks: number; succeeded: number; failed: number; totalCost: number; avgCost: number } {
  const now = Date.now();
  if (cachedSummary && now - cachedAt < CACHE_TTL_MS) {
    return cachedSummary;
  }

  const all = getRecentMetrics(10000);
  let totalTasks = 0;
  let succeeded = 0;
  let failed = 0;
  let totalCost = 0;
  for (const m of all) {
    if (m.event === "task_completed") {
      totalTasks++;
      succeeded++;
      totalCost += m.costUsd ?? 0;
    } else if (m.event === "task_failed") {
      totalTasks++;
      failed++;
      totalCost += m.costUsd ?? 0;
    } else if (m.event === "review_completed" || m.event === "review_failed") {
      totalTasks++;
      if (m.event === "review_completed") succeeded++;
      else failed++;
      totalCost += m.costUsd ?? 0;
    }
  }

  const avgCost = totalTasks > 0 ? totalCost / totalTasks : 0;

  cachedSummary = { totalTasks, succeeded, failed, totalCost, avgCost };
  cachedAt = now;
  return cachedSummary;
}
