import { statSync } from "node:fs";
import { checkAuth } from "./auth.js";
import { getCliAdapter } from "./cli/registry.js";
import type { CritterTypeConfig } from "./critter-type.js";
import { renderDashboard } from "./dashboard/index.js";
import { phaseFileTag, readLogTail, renderReadableLines, resolveCliAdapterForLog, resolveLogFile, resolveWorkDirForIdentifier } from "./log-resolver.js";
import { formatError, log, logError } from "./logger.js";
import { getRecentMetrics } from "./metrics.js";
import { getPrStatuses } from "./pr-status.js";
import type { IssueTracker, TrackerTeam } from "./tracker/types.js";
import type { ActiveCritterDetail, QueuedCritterDetail } from "./types.js";
import type { KillResult } from "./unified-spawner.js";
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
  queuedCritterDetails: QueuedCritterDetail[];
  pollIntervalSeconds: number;
  concurrencyMax: number;
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
    triggerStop?: () => void;
    triggerPollForIssue?: (identifier: string) => Promise<number>;
    triggerKill?: (identifiers: string[]) => KillResult[];
  },
  workDir?: string,
  dashboardToken?: string,
  context?: {
    trackers?: Map<string, IssueTracker>;
    critterTypes?: CritterTypeConfig[];
    defaultProvider?: string;
    repos?: Record<string, { url: string; extraAllowedTools?: string[] }>;
    teamRepos?: Record<string, string>;
    hooks?: Record<string, string>;
    getTunnelUrl?: () => string | null;
  },
  webhookConfig?: {
    linearWebhookSecret?: string;
    jiraWebhookSecret?: string;
    critterTypes: CritterTypeConfig[];
  },
): { port: number; stop: () => void } {
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
        // Serve the SPA shell for every sub-path — the React client parses
        // the pathname and routes to a page or, if the segment is not a
        // known page, treats it as an issue identifier for the log view.
        const segment = decodeURIComponent(url.pathname.slice("/dashboard/".length));
        const status = getStatus();
        const uptime = Date.now() - startTime;
        const typeFilter = url.searchParams.get("type") || undefined;
        const html = renderDashboard(metricsPath ?? "", status, uptime, typeFilter, dashboardToken, segment);
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

      if (url.pathname === "/api/v1/dashboard") {
        const { handleDashboardApi } = await import("./dashboard/api.js");
        const status = getStatus();
        const uptime = Date.now() - startTime;
        return handleDashboardApi(url, status, uptime);
      }

      if (url.pathname.startsWith("/api/v1/issue/") && url.pathname.length > "/api/v1/issue/".length) {
        const identifier = decodeURIComponent(url.pathname.slice("/api/v1/issue/".length));
        const { buildIssueData } = await import("./dashboard/issue-data.js");
        const status = getStatus();
        const issueMetrics = getRecentMetrics(10000).filter(m => m.identifier === identifier);
        const prUrl = status.activeCritterDetails.find(d => d.identifier === identifier)?.prUrl
          ?? issueMetrics.find(m => m.prUrl)?.prUrl;
        const prStatuses = prUrl ? await getPrStatuses([prUrl]) : new Map();
        const data = await buildIssueData(identifier, status, workDir ?? "/tmp/critters-work", prStatuses, context?.trackers);
        return Response.json(data);
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

      if (url.pathname === "/stop") {
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        const authResp = checkAuth(req, dashboardToken);
        if (authResp) return authResp;
        if (!triggers?.triggerStop) {
          return Response.json({ error: "Stop not available" }, { status: 503 });
        }

        setTimeout(() => {
          triggers.triggerStop!();
        }, 250);

        return Response.json({ ok: true, message: "Stopping..." });
      }

      if (url.pathname === "/kill") {
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        const authResp = checkAuth(req, dashboardToken);
        if (authResp) return authResp;
        if (!triggers?.triggerKill) {
          return Response.json({ error: "Kill trigger not available" }, { status: 503 });
        }

        let body: { identifiers?: string[] };
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        if (!Array.isArray(body.identifiers) || body.identifiers.length === 0) {
          return Response.json({ error: "identifiers must be a non-empty array" }, { status: 400 });
        }

        const results = triggers.triggerKill(body.identifiers);
        return Response.json(results);
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

        const logFile = targetDir ? resolveLogFile(targetDir, phase) : null;

        if (logFile && isStream) {
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
                      const adapter = resolveCliAdapterForLog(logFile);
                      for (const rendered of renderReadableLines(lines, adapter)) {
                        send(rendered);
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
        if (logFile) {
          const content = readLogTail(logFile, tailCount);
          return new Response(content, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }

        // Fallback: fetch from tracker when local logs unavailable
        if (!context?.trackers || context.trackers.size === 0) {
          return Response.json({ error: "No log file found" }, { status: 404 });
        }

        // Search all trackers for the issue
        let foundTracker: IssueTracker | null = null;
        let issueId: string | null = null;
        try {
          for (const [, tracker] of context.trackers) {
            const found = await tracker.findIssueByIdentifier(identifier);
            if (found) {
              foundTracker = tracker;
              issueId = found.id;
              break;
            }
          }
        } catch {
          return Response.json({ error: "Failed to search trackers" }, { status: 502 });
        }

        if (!foundTracker || !issueId) {
          return Response.json({ error: "No log file found" }, { status: 404 });
        }

        let attachments: Array<{ name: string; url: string }>;
        try {
          attachments = await foundTracker.getAttachments(issueId);
        } catch {
          return Response.json({ error: "Failed to fetch attachments from tracker" }, { status: 502 });
        }

        // Determine which attachment to serve using the same naming convention as buildLogFileList()
        let attachmentUrl: string | null = null;
        if (phase) {
          const tag = phaseFileTag(phase);
          const expectedName = `${identifier}-${tag}-output.txt`;
          const match = attachments.find((a) => a.name === expectedName);
          attachmentUrl = match?.url ?? null;
        } else {
          // Auto-detect: review > execution > planning (same order as resolveLogFile)
          for (const p of ["review", "execution", "planning"]) {
            const tag = phaseFileTag(p);
            const expectedName = `${identifier}-${tag}-output.txt`;
            const match = attachments.find((a) => a.name === expectedName);
            if (match?.url) {
              attachmentUrl = match.url;
              break;
            }
          }
          // Also try any custom phase attachments
          if (!attachmentUrl) {
            const outputAttachment = attachments.find(
              (a) => a.name.startsWith(`${identifier}-`) && a.name.endsWith("-output.txt"),
            );
            attachmentUrl = outputAttachment?.url ?? null;
          }
        }

        if (!attachmentUrl) {
          return Response.json({ error: "No log attachments found in tracker" }, { status: 404 });
        }

        // Fetch attachment content via tracker (handles auth)
        let remoteContent: string | null;
        try {
          remoteContent = await foundTracker.fetchAttachmentContent(attachmentUrl);
        } catch {
          return Response.json({ error: "Failed to fetch log content from tracker" }, { status: 502 });
        }

        if (!remoteContent) {
          return Response.json({ error: "Failed to fetch log from tracker" }, { status: 502 });
        }

        // Render JSON stream lines into human-readable output via the CLI adapter.
        // Tracker attachments don't carry meta sidecars, so fall back to the claude adapter.
        const remoteAdapter = getCliAdapter("claude");
        const remoteJsonLines = remoteContent.split("\n").filter((l) => l.trim());
        const remoteReadable = renderReadableLines(remoteJsonLines, remoteAdapter);
        const remoteTailLines = remoteReadable.slice(-tailCount);

        if (isStream) {
          // For stream requests on remote logs, send all content as SSE then close
          // (no live tailing possible for remote logs)
          const encoder = new TextEncoder();
          const remoteStream = new ReadableStream({
            start(controller) {
              for (const line of remoteTailLines) {
                controller.enqueue(encoder.encode(`data: ${line}\n\n`));
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: "done" })}\n\n`));
              controller.close();
            },
          });

          return new Response(remoteStream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
            },
          });
        }

        // Non-stream: return tail of content as plain text
        return new Response(remoteTailLines.join("\n"), {
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

      if (url.pathname === "/api/v1/types") {
        const { buildTypesResponse } = await import("./dashboard/config-api.js");
        return Response.json(buildTypesResponse(context?.critterTypes));
      }

      if (url.pathname === "/api/v1/repos") {
        const { buildReposResponse } = await import("./dashboard/config-api.js");
        return Response.json(buildReposResponse(context?.repos, context?.teamRepos));
      }

      if (url.pathname === "/api/v1/models") {
        const { buildModelsResponse } = await import("./dashboard/config-api.js");
        return Response.json(buildModelsResponse(context?.critterTypes));
      }

      if (url.pathname === "/api/v1/hooks") {
        const { buildHooksResponse } = await import("./dashboard/config-api.js");
        const tunnelDomain = context?.getTunnelUrl?.() ?? undefined;
        return Response.json(buildHooksResponse(webhookConfig, context?.hooks, tunnelDomain ?? undefined));
      }

      if (url.pathname === "/api/v1/env-status") {
        const { buildEnvStatusResponse } = await import("./dashboard/config-api.js");
        return Response.json(buildEnvStatusResponse());
      }

      if (url.pathname === "/api/v1/releases") {
        const { buildReleasesResponse } = await import("./dashboard/config-api.js");
        return Response.json(buildReleasesResponse());
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
          const message = formatError(err);
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
    port: server.port!,
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
