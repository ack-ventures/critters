import type { HealthStatus } from "../health.js";
import { getRecentMetrics } from "../metrics.js";
import { getPrStatuses } from "../pr-status.js";
import { buildDashboardData } from "./dashboard-data.js";

export async function handleDashboardApi(
  url: URL,
  status: HealthStatus,
  uptimeMs: number,
): Promise<Response> {
  const typeFilter = url.searchParams.get("type") || undefined;

  // Collect PR URLs from recent metrics and active critters for status enrichment
  const recentMetrics = getRecentMetrics(50);
  const prUrls: string[] = [];
  for (const m of recentMetrics) if (m.prUrl) prUrls.push(m.prUrl);
  for (const d of status.activeCritterDetails) if (d.prUrl) prUrls.push(d.prUrl);
  const prStatuses = await getPrStatuses(prUrls);

  const data = buildDashboardData(status, uptimeMs, typeFilter, prStatuses);
  return Response.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}
