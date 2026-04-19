import type { HealthStatus } from "../health.js";
import { extractPhaseResult, resolveAllPhases, resolvePhasesFromAttachments, resolveWorkDirForIdentifier } from "../log-resolver.js";
import { aggregateCostFromEvents, getRecentMetrics } from "../metrics.js";
import type { PrStatus } from "../pr-status.js";
import type { IssueTracker } from "../tracker/types.js";

export interface IssueData {
  identifier: string;
  title: string;
  critterType: string;
  repo: string;
  branch: string;
  prUrl: string | null;
  issueUrl: string | null;
  isActive: boolean;
  isCompleted: boolean;
  isFailed: boolean;
  startedAt: string | null;
  durationMs: number | null;
  currentPhase: string | null;
  phases: string[];
  cost: {
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  };
  phaseResults: Array<{
    phase: string;
    isRunning: boolean;
    isDone: boolean;
    costUsd: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    numTurns: number | null;
  }>;
  multipleRuns: boolean;
  prStatus: { ciStatus: string; reviewStatus: string } | null;
  noData: boolean;
}

export async function buildIssueData(
  identifier: string,
  status: HealthStatus,
  workDir: string,
  prStatuses?: Map<string, PrStatus>,
  trackers?: Map<string, IssueTracker>,
): Promise<IssueData> {
  const activeDetail = status.activeCritterDetails.find((d) => d.identifier === identifier);
  const isActive = !!activeDetail;

  // Find work directory
  let targetDir: string | null = null;
  if (activeDetail?.workDir) {
    targetDir = activeDetail.workDir;
  } else {
    targetDir = resolveWorkDirForIdentifier(workDir, identifier);
  }

  // Get available phases and their results
  let phases: Array<{ phase: string; logFile: string }> = targetDir ? resolveAllPhases(targetDir) : [];

  // Fallback: discover phases from tracker attachments when local logs are gone
  if (phases.length === 0 && trackers && trackers.size > 0) {
    try {
      for (const [, tracker] of trackers) {
        const issue = await tracker.findIssueByIdentifier(identifier);
        if (issue) {
          const attachments = await tracker.getAttachments(issue.id);
          const remotePhs = resolvePhasesFromAttachments(identifier, attachments);
          if (remotePhs.length > 0) {
            phases = remotePhs.map((p) => ({ phase: p.phase, logFile: "" }));
            break;
          }
        }
      }
    } catch {
      // Tracker unavailable — continue without phase tabs
    }
  }

  const phaseResultsRaw = phases.map((p) => ({
    phase: p.phase,
    logFile: p.logFile,
    result: extractPhaseResult(p.logFile),
  }));

  // Get metrics data for this identifier
  const allMetrics = getRecentMetrics(10000);
  const issueMetrics = allMetrics.filter((m) => m.identifier === identifier);
  const taskStarted = issueMetrics.filter((m) => m.event === "task_started").pop();
  const taskEnded = issueMetrics.filter((m) =>
    m.event === "task_completed" || m.event === "task_failed" ||
    m.event === "review_completed" || m.event === "review_failed",
  ).pop();
  const multipleRuns = issueMetrics.filter((m) => m.event === "task_started").length > 1;

  // Determine status
  const isCompleted = !!taskEnded && !isActive;
  const isFailed = taskEnded?.event === "task_failed" || taskEnded?.event === "review_failed";

  // Resolve metadata from active detail or metrics
  const title = activeDetail?.title ?? taskStarted?.identifier ?? "N/A";
  const critterType = activeDetail?.critterType ?? taskEnded?.critterType ?? taskStarted?.critterType ?? "\u2014";
  const repo = activeDetail?.repo ?? (() => {
    const url = taskStarted?.repoUrl ?? "";
    const match = url.match(/[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
    return match ? match[1] : url || "\u2014";
  })();
  const branch = activeDetail?.branch ?? "\u2014";
  const prUrl = activeDetail?.prUrl ?? taskEnded?.prUrl ?? null;
  const issueUrl = activeDetail?.issueUrl ?? taskStarted?.issueUrl ?? taskEnded?.issueUrl ?? null;

  // Cost/token aggregation from phase results (preferred) or metrics (fallback)
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let hasPhaseData = false;

  for (const pr of phaseResultsRaw) {
    if (pr.result) {
      hasPhaseData = true;
      totalCost += pr.result.costUsd ?? 0;
      totalInputTokens += pr.result.inputTokens ?? 0;
      totalOutputTokens += pr.result.outputTokens ?? 0;
      totalCacheReadTokens += pr.result.cacheReadTokens ?? 0;
    }
  }

  if (!hasPhaseData) {
    const agg = aggregateCostFromEvents(issueMetrics);
    totalCost = agg.costUsd;
    totalInputTokens = agg.inputTokens;
    totalOutputTokens = agg.outputTokens;
    totalCacheReadTokens = agg.cacheReadTokens;
  }

  // Duration
  let durationMs: number | null = null;
  if (isActive && activeDetail) {
    durationMs = Date.now() - activeDetail.startedAt;
  } else if (taskEnded?.duration != null) {
    durationMs = taskEnded.duration;
  }

  // Started at
  let startedAt: string | null = null;
  if (isActive && activeDetail) {
    startedAt = new Date(activeDetail.startedAt).toISOString();
  } else if (taskStarted) {
    startedAt = taskStarted.timestamp;
  }

  // Current phase
  const currentPhase = activeDetail?.phase ?? null;

  // Build per-phase cost lookup from metrics (for when pr.result is missing)
  const scopedMetrics = (() => {
    let lastStartIdx = -1;
    for (let i = issueMetrics.length - 1; i >= 0; i--) {
      if (issueMetrics[i].event === "task_started") { lastStartIdx = i; break; }
    }
    return lastStartIdx >= 0 ? issueMetrics.slice(lastStartIdx) : issueMetrics;
  })();
  const reviewMetric = scopedMetrics.filter(
    (m) => m.event === "review_completed" || m.event === "review_failed"
  ).pop();
  const taskMetric = scopedMetrics.filter(
    (m) => m.event === "task_completed" || m.event === "task_failed"
  ).pop();
  const nonReviewPhases = phaseResultsRaw.filter((pr) => pr.phase !== "review");

  const phaseResults = phaseResultsRaw.map((pr) => {
    const isCurrentPhase = isActive && activeDetail &&
      (activeDetail.phase === pr.phase ||
       (activeDetail.phase === "plan" && pr.phase === "planning") ||
       (activeDetail.phase === "exec" && pr.phase === "execution"));
    const isRunning = !!isCurrentPhase && !pr.result;
    const isDone = !!pr.result;
    const fallbackMetric = !pr.result
      ? (pr.phase === "review"
        ? reviewMetric
        : (nonReviewPhases.length === 1 ? taskMetric : undefined))
      : undefined;
    return {
      phase: pr.phase,
      isRunning,
      isDone,
      costUsd: pr.result?.costUsd ?? fallbackMetric?.costUsd ?? null,
      inputTokens: pr.result?.inputTokens ?? fallbackMetric?.inputTokens ?? null,
      outputTokens: pr.result?.outputTokens ?? fallbackMetric?.outputTokens ?? null,
      cacheReadTokens: pr.result?.cacheReadTokens ?? fallbackMetric?.cacheReadTokens ?? null,
      numTurns: pr.result?.numTurns ?? fallbackMetric?.numTurns ?? null,
    };
  });

  // PR status
  const resolvedPrUrl = prUrl ?? issueMetrics.find(m => m.prUrl)?.prUrl;
  const prStatus = resolvedPrUrl && prStatuses ? (prStatuses.get(resolvedPrUrl) ?? null) : null;

  const noData = phases.length === 0 && !taskEnded && !isActive;

  return {
    identifier,
    title,
    critterType,
    repo,
    branch,
    prUrl,
    issueUrl,
    isActive,
    isCompleted,
    isFailed,
    startedAt,
    durationMs,
    currentPhase,
    phases: phases.map((p) => p.phase),
    cost: {
      totalCost,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheReadTokens: totalCacheReadTokens,
    },
    phaseResults,
    multipleRuns,
    prStatus,
    noData,
  };
}
