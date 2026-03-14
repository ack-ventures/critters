import { statSync } from "node:fs";
import { checkAuth } from "./auth.js";
import type { CritterTypeConfig } from "./critter-type.js";
import { renderDashboard, renderIssuePage } from "./dashboard.js";
import { formatToolUse, formatUserEvent, readLogTail, resolveLogFile, resolveWorkDirForIdentifier, stripAnsi } from "./log-resolver.js";
import { log, logError } from "./logger.js";
import { getRecentMetrics } from "./metrics.js";
import type { IssueTracker, TrackerTeam } from "./tracker/types.js";
import type { ActiveCritterDetail } from "./types.js";
import { getDisplayVersion } from "./updater.js";
import { formatDuration } from "./utils.js";
import { VERSION } from "./version.js";
import type { JiraWebhookPayload, LinearWebhookPayload } from "./webhook.js";
import { extractJiraWebhookTrigger, extractLinearWebhookTrigger, verifyJiraSignature, verifyLinearSignature } from "./webhook.js";

export interface HealthStatus {
  activeCritters: number;
  queuedCritters: number;
  activeReviews: number;
  queuedReviews: number;
  perType: Record<string, { active: number; queued: number }>;
  lastPollAt: string | null;
  activeCritterDetails: ActiveCritterDetail[];
  circuitBreakers?: Record<string, {
    state: string;
    consecutiveFailures: number;
    lastFailureAt: string | null;
    nextRetryAt: string | null;
  }>;
}

let cachedSummary: { totalTasks: number; succeeded: number; failed: number; totalCost: number; avgCost: number } | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000;

export function resetMetricsSummaryCache(): void {
  cachedSummary = null;
  cachedAt = 0;
}

let cachedMetadata: { providers: Record<string, { teams: TrackerTeam[] }>; critterTypes: { name: string; triggerLabel: string; triggerStatus: string; provider: string }[]; repos: Array<{ url: string; label: string }> } | null = null;
let metadataCachedAt = 0;
const METADATA_CACHE_TTL_MS = 60_000;

export function resetMetadataCache(): void {
  cachedMetadata = null;
  metadataCachedAt = 0;
}

export function startHealthServer(
  port: number,
  getStatus: () => HealthStatus,
  metricsPath?: string,
  triggers?: {
    triggerPoll?: () => Promise<number>;
    triggerReviewPoll?: () => Promise<number>;
    triggerRestart?: () => void;
    triggerPollForIssue?: (identifier: string) => Promise<number>;
  },
  workDir?: string,
  dashboardToken?: string,
  context?: {
    trackers?: Map<string, IssueTracker>;
    critterTypes?: CritterTypeConfig[];
    defaultProvider?: string;
    repos?: Record<string, { url: string; extraAllowedTools?: string[] }>;
    teamRepos?: Record<string, string>;
  },
  webhookConfig?: {
    linearWebhookSecret?: string;
    jiraWebhookSecret?: string;
    critterTypes: CritterTypeConfig[];
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
          circuitBreakers: status.circuitBreakers ?? {},
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
            costUsd: d.costUsd ?? null,
            costBudget: d.costBudget ?? null,
          })),
        });
      }

      if (url.pathname === "/metrics") {
        const entries = getRecentMetrics(100);
        return Response.json(entries);
      }

      if (url.pathname.startsWith("/dashboard/") && url.pathname.length > "/dashboard/".length) {
        const identifier = decodeURIComponent(url.pathname.slice("/dashboard/".length));
        const status = getStatus();
        const html = renderIssuePage(identifier, status, workDir ?? "/tmp/critters-work");
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/" || url.pathname === "/dashboard") {
        const status = getStatus();
        const uptime = Date.now() - startTime;
        const typeFilter = url.searchParams.get("type") || undefined;
        const html = renderDashboard(metricsPath ?? "", status, uptime, typeFilter, dashboardToken);
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/poll") {
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        const authResp = checkAuth(req, dashboardToken);
        if (authResp) return authResp;
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
        const authResp = checkAuth(req, dashboardToken);
        if (authResp) return authResp;
        if (!triggers?.triggerReviewPoll) {
          return Response.json({ error: "Review poll trigger not available" }, { status: 503 });
        }
        const issuesFound = await triggers.triggerReviewPoll();
        return Response.json({ triggered: true, issuesFound });
      }

      if (url.pathname === "/restart") {
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        const authResp = checkAuth(req, dashboardToken);
        if (authResp) return authResp;
        if (!triggers?.triggerRestart) {
          return Response.json({ error: "Restart not available" }, { status: 503 });
        }

        // Use setTimeout to let the HTTP response flush before process replacement
        setTimeout(() => {
          triggers.triggerRestart!();
        }, 250);

        return Response.json({ ok: true, message: "Restarting..." });
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

      // GET /logs/<identifier> — redirect to /dashboard/<identifier>
      if (url.pathname.startsWith("/logs/")) {
        const identifier = url.pathname.split("/").filter(Boolean)[1];
        if (!identifier) {
          return new Response("Missing identifier", { status: 400 });
        }
        return new Response(null, {
          status: 302,
          headers: { Location: `/dashboard/${encodeURIComponent(identifier)}` },
        });
      }

      if (url.pathname === "/api/v1/auth-check") {
        return Response.json({ required: !!dashboardToken });
      }

      if (url.pathname === "/api/v1/metadata") {
        const now = Date.now();
        if (cachedMetadata && now - metadataCachedAt < METADATA_CACHE_TTL_MS) {
          return Response.json(cachedMetadata);
        }

        const providers: Record<string, { teams: TrackerTeam[] }> = {};
        if (context?.trackers) {
          for (const [name, tracker] of context.trackers) {
            try {
              providers[name] = { teams: await tracker.listTeams() };
            } catch {
              providers[name] = { teams: [] };
            }
          }
        }
        const defaultProvider = context?.defaultProvider ?? "linear";
        const critterTypes = (context?.critterTypes ?? []).map((ct) => ({
          name: ct.name,
          triggerLabel: ct.trigger.label,
          triggerStatus: ct.trigger.status,
          provider: ct.provider ?? defaultProvider,
        }));

        // Build deduplicated repos list
        const repoUrls = new Set<string>();
        const reposList: Array<{ url: string; label: string }> = [];

        function extractLabel(url: string): string {
          const match = url.match(/[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
          return match ? match[1] : url;
        }

        if (context?.repos) {
          for (const repo of Object.values(context.repos)) {
            if (!repoUrls.has(repo.url)) {
              repoUrls.add(repo.url);
              reposList.push({ url: repo.url, label: extractLabel(repo.url) });
            }
          }
        }
        if (context?.teamRepos) {
          for (const url of Object.values(context.teamRepos)) {
            if (!repoUrls.has(url)) {
              repoUrls.add(url);
              reposList.push({ url, label: extractLabel(url) });
            }
          }
        }

        cachedMetadata = { providers, critterTypes, repos: reposList };
        metadataCachedAt = now;
        return Response.json(cachedMetadata);
      }

      if (url.pathname === "/api/v1/issues") {
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        const authResp = checkAuth(req, dashboardToken);
        if (authResp) return authResp;

        if (!context?.trackers) {
          return Response.json({ error: "Trackers not available" }, { status: 503 });
        }

        let body: {
          provider?: string;
          teamId?: string;
          title?: string;
          description?: string;
          critterType?: string;
        };
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        if (!body.title?.trim()) {
          return Response.json({ error: "Title is required" }, { status: 400 });
        }
        if (!body.teamId?.trim()) {
          return Response.json({ error: "Team is required" }, { status: 400 });
        }

        const providerName = body.provider ?? context.defaultProvider ?? "linear";
        const tracker = context.trackers.get(providerName);
        if (!tracker) {
          return Response.json(
            { error: `No tracker configured for provider "${providerName}"` },
            { status: 400 },
          );
        }

        const critterType = context.critterTypes?.find(
          (ct) => ct.name === body.critterType,
        );
        const triggerLabel = critterType?.trigger.label ?? "Critter";

        const description = body.description?.trim() ?? "";

        try {
          const created = await tracker.createIssue({
            teamId: body.teamId,
            title: body.title.trim(),
            description,
            labelNames: [triggerLabel],
          });
          return Response.json({
            success: true,
            identifier: created.identifier,
            url: created.url,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ success: false, error: message }, { status: 500 });
        }
      }

      // ── Webhook endpoints ──────────────────────────────────────────────

      if (url.pathname === "/webhook/linear") {
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        if (!webhookConfig?.linearWebhookSecret) {
          return Response.json({ error: "Linear webhooks not configured" }, { status: 404 });
        }

        const rawBody = await req.text();
        const signature = req.headers.get("Linear-Signature") ?? "";

        if (!verifyLinearSignature(rawBody, signature, webhookConfig.linearWebhookSecret)) {
          log("Webhook: Linear signature verification failed");
          return Response.json({ error: "Invalid signature" }, { status: 401 });
        }

        let payload: LinearWebhookPayload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        log(`Webhook: Linear event received — ${payload.type}/${payload.action}`);

        const identifier = extractLinearWebhookTrigger(payload, webhookConfig.critterTypes);
        if (identifier) {
          log(`Webhook: Triggering poll for ${identifier}`);
          triggers?.triggerPollForIssue?.(identifier).catch((err) => {
            logError(`Webhook poll failed for ${identifier}: ${err}`);
          });
          return Response.json({ ok: true, triggered: true, identifier });
        }

        return Response.json({ ok: true, triggered: false });
      }

      if (url.pathname === "/webhook/jira") {
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        if (!webhookConfig?.jiraWebhookSecret) {
          return Response.json({ error: "Jira webhooks not configured" }, { status: 404 });
        }

        const rawBody = await req.text();
        const signatureHeader = req.headers.get("X-Hub-Signature") ?? "";

        if (!verifyJiraSignature(rawBody, signatureHeader, webhookConfig.jiraWebhookSecret)) {
          log("Webhook: Jira signature verification failed");
          return Response.json({ error: "Invalid signature" }, { status: 401 });
        }

        let payload: JiraWebhookPayload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        log(`Webhook: Jira event received — ${payload.webhookEvent}`);

        const identifier = extractJiraWebhookTrigger(payload, webhookConfig.critterTypes);
        if (identifier) {
          log(`Webhook: Triggering poll for ${identifier}`);
          triggers?.triggerPollForIssue?.(identifier).catch((err) => {
            logError(`Webhook poll failed for ${identifier}: ${err}`);
          });
          return Response.json({ ok: true, triggered: true, identifier });
        }

        return Response.json({ ok: true, triggered: false });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  log(`Health server listening on port ${server.port}`);

  return {
    stop: () => server.stop(true),
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
