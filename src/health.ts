import { renderDashboard } from "./dashboard.js";
import { log } from "./logger.js";
import { getRecentMetrics } from "./metrics.js";
import { VERSION } from "./version.js";

export interface HealthStatus {
  activeCritters: number;
  queuedCritters: number;
  activeReviews: number;
  queuedReviews: number;
  lastPollAt: string | null;
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
        return Response.json({
          status: "ok",
          uptime: Math.floor((Date.now() - startTime) / 1000),
          version: VERSION,
          activeCritters: status.activeCritters,
          queuedCritters: status.queuedCritters,
          activeReviews: status.activeReviews,
          queuedReviews: status.queuedReviews,
          lastPollAt: status.lastPollAt,
          metrics: computeMetricsSummary(),
        });
      }

      if (url.pathname === "/metrics") {
        const entries = getRecentMetrics(100);
        return Response.json(entries);
      }

      if (url.pathname === "/" || url.pathname === "/dashboard") {
        const status = getStatus();
        const html = renderDashboard(metricsPath ?? "", status);
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

function computeMetricsSummary(): { totalTasks: number; succeeded: number; failed: number } {
  const all = getRecentMetrics(10000);
  let totalTasks = 0;
  let succeeded = 0;
  let failed = 0;
  for (const m of all) {
    if (m.event === "task_completed") {
      totalTasks++;
      succeeded++;
    } else if (m.event === "task_failed") {
      totalTasks++;
      failed++;
    }
  }
  return { totalTasks, succeeded, failed };
}
