import { runCommand } from "./utils.js";

export interface PrStatus {
  ciStatus: "success" | "failure" | "pending" | "none";
  reviewStatus: "approved" | "changes_requested" | "pending" | "none";
}

interface CacheEntry {
  status: PrStatus;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000; // 60 seconds
const MAX_CONCURRENT_FETCHES = 10;

// statusCheckRollup is a union of CheckRun nodes (status/conclusion) and legacy
// StatusContext nodes (state). Normalize each entry to a single verdict so that
// commit-status entries — which have no conclusion and never report COMPLETED —
// aren't read as perpetually pending.
export function normalizeCheckVerdict(check: {
  status?: string;
  conclusion?: string;
  state?: string;
}): "success" | "failure" | "pending" {
  const raw = (check.conclusion ?? check.state ?? "").toUpperCase();
  if (raw === "FAILURE" || raw === "ERROR" || raw === "TIMED_OUT" || raw === "CANCELLED" || raw === "ACTION_REQUIRED") {
    return "failure";
  }
  if (raw === "SUCCESS") {
    return "success";
  }
  // No verdict yet: CheckRuns are pending until status === COMPLETED; StatusContext
  // entries with state PENDING (or any unrecognized value) are likewise pending.
  if (check.conclusion === undefined && check.state === undefined) {
    // CheckRun without a conclusion: trust its status field.
    return check.status === "COMPLETED" ? "success" : "pending";
  }
  return "pending";
}

async function fetchPrStatus(prUrl: string): Promise<PrStatus> {
  try {
    const { code, stdout } = await runCommand(
      "gh",
      ["pr", "view", prUrl, "--json", "statusCheckRollup,reviewDecision"],
      { timeoutMs: 10_000 },
    );
    if (code !== 0) {
      return { ciStatus: "none", reviewStatus: "none" };
    }

    const data = JSON.parse(stdout);

    // Parse CI status from statusCheckRollup
    let ciStatus: PrStatus["ciStatus"] = "none";
    const checks: Array<{ status?: string; conclusion?: string; state?: string }> = data.statusCheckRollup ?? [];
    if (checks.length > 0) {
      const verdicts = checks.map(normalizeCheckVerdict);
      if (verdicts.some((v) => v === "failure")) {
        ciStatus = "failure";
      } else if (verdicts.some((v) => v === "pending")) {
        ciStatus = "pending";
      } else {
        ciStatus = "success";
      }
    }

    // Parse review status from reviewDecision
    let reviewStatus: PrStatus["reviewStatus"] = "none";
    const decision: string = data.reviewDecision ?? "";
    if (decision === "APPROVED") {
      reviewStatus = "approved";
    } else if (decision === "CHANGES_REQUESTED") {
      reviewStatus = "changes_requested";
    } else if (decision === "" || decision === "REVIEW_REQUIRED") {
      reviewStatus = "pending";
    }

    return { ciStatus, reviewStatus };
  } catch {
    return { ciStatus: "none", reviewStatus: "none" };
  }
}

export async function getPrStatuses(prUrls: string[]): Promise<Map<string, PrStatus>> {
  const result = new Map<string, PrStatus>();
  const now = Date.now();

  // Deduplicate URLs
  const unique = [...new Set(prUrls)];

  // Separate cached vs needs-fetch
  const toFetch: string[] = [];
  for (const url of unique) {
    const cached = cache.get(url);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      result.set(url, cached.status);
    } else {
      toFetch.push(url);
    }
  }

  // Process all uncached URLs in sequential batches of MAX_CONCURRENT_FETCHES,
  // pacing the work instead of dropping anything beyond the first batch.
  for (let i = 0; i < toFetch.length; i += MAX_CONCURRENT_FETCHES) {
    const batch = toFetch.slice(i, i + MAX_CONCURRENT_FETCHES);
    await Promise.all(
      batch.map(async (url) => {
        const status = await fetchPrStatus(url);
        cache.set(url, { status, fetchedAt: Date.now() });
        result.set(url, status);
      }),
    );
  }

  return result;
}
