import { statSync } from "node:fs";
import { renderDashboard, renderLogPage } from "./dashboard.js";
import { formatToolUse, formatUserEvent, readLogTail, resolveLogFile, resolveWorkDirForIdentifier, stripAnsi } from "./log-resolver.js";
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
  workDir?: string,
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

      // API: GET /api/logs/<identifier> — returns processed log tail as plain text
      if (url.pathname.startsWith("/api/logs/")) {
        const parts = url.pathname.split("/").filter(Boolean); // ["api", "logs", identifier, ..."stream"]
        const identifier = parts[2];
        if (!identifier) {
          return new Response("Missing identifier", { status: 400 });
        }

        const isStream = parts[3] === "stream";
        const phase = url.searchParams.get("phase") ?? undefined;
        const tailCount = parseInt(url.searchParams.get("tail") ?? "50", 10);

        // Find work directory: check active critters first, then scan filesystem
        let targetDir: string | null = null;
        const status = getStatus();
        const activeDetail = status.activeCritterDetails.find((d) => d.identifier === identifier);
        if (activeDetail?.workDir) {
          targetDir = activeDetail.workDir;
        } else if (workDir) {
          targetDir = resolveWorkDirForIdentifier(workDir, identifier);
        }

        if (!targetDir) {
          return Response.json({ error: "No work directory found for identifier" }, { status: 404 });
        }

        const logFile = resolveLogFile(targetDir, phase);
        if (!logFile) {
          return Response.json({ error: "No log file found" }, { status: 404 });
        }

        if (isStream) {
          // SSE endpoint
          let closed = false;
          let fileOffset = 0;
          try {
            fileOffset = statSync(logFile).size;
          } catch {}

          const stream = new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              const send = (data: string) => {
                if (!closed) {
                  try {
                    controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                  } catch {}
                }
              };

              // Send existing content first
              const existing = readLogTail(logFile, tailCount);
              if (existing) {
                for (const line of existing.split("\n")) {
                  send(line);
                }
              }

              const pollTimer = setInterval(() => {
                if (closed) {
                  clearInterval(pollTimer);
                  return;
                }

                try {
                  const currentSize = statSync(logFile).size;
                  if (currentSize > fileOffset) {
                    const fd = Bun.file(logFile);
                    const slice = fd.slice(fileOffset, currentSize);
                    slice.text().then((newContent) => {
                      fileOffset = currentSize;
                      const lines = newContent.split("\n").filter((l) => l.trim());
                      for (const line of lines) {
                        try {
                          const obj = JSON.parse(line);
                          if (obj.type === "assistant" && obj.message?.content) {
                            for (const block of obj.message.content) {
                              if (block.type === "text" && block.text) {
                                send(stripAnsi(block.text));
                              } else if (block.type === "tool_use") {
                                send(formatToolUse(block));
                              }
                            }
                          } else if (obj.type === "result") {
                            send(`[Result: cost=$${(obj.cost_usd ?? 0).toFixed(2)}, turns=${obj.num_turns ?? "?"}]`);
                          } else if (obj.type === "user") {
                            const userLine = formatUserEvent(obj);
                            if (userLine) {
                              for (const ul of userLine.split("\n")) {
                                send(ul);
                              }
                            }
                          }
                        } catch {
                          send(stripAnsi(line));
                        }
                      }
                    }).catch(() => {});
                  }
                } catch {}

                // Check if critter is still active
                const currentStatus = getStatus();
                const stillActive = currentStatus.activeCritterDetails.some((d) => d.identifier === identifier);
                if (!stillActive) {
                  send(JSON.stringify({ event: "done" }));
                  clearInterval(pollTimer);
                  try { controller.close(); } catch {}
                }
              }, 500);

              // Heartbeat
              const heartbeatTimer = setInterval(() => {
                if (closed) {
                  clearInterval(heartbeatTimer);
                  return;
                }
                send(JSON.stringify({ event: "heartbeat" }));
              }, 15_000);

              // Cleanup ref
              (controller as unknown as Record<string, unknown>)._cleanup = () => {
                clearInterval(pollTimer);
                clearInterval(heartbeatTimer);
              };
            },
            cancel() {
              closed = true;
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
            },
          });
        }

        // Non-stream: return log tail as plain text
        const content = readLogTail(logFile, tailCount);
        return new Response(content, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      // GET /logs/<identifier> — dedicated log page
      if (url.pathname.startsWith("/logs/")) {
        const identifier = url.pathname.split("/").filter(Boolean)[1];
        if (!identifier) {
          return new Response("Missing identifier", { status: 400 });
        }
        const status = getStatus();
        const html = renderLogPage(identifier, status, workDir ?? "/tmp/critters-work");
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
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
