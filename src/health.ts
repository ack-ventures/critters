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
): { stop: () => void } {
  const startTime = Date.now();

  const server = Bun.serve({
    port,
    fetch(req) {
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
