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

async function fetchPrStatus(prUrl: string): Promise<PrStatus> {
  try {
    const proc = Bun.spawn(
      ["gh", "pr", "view", prUrl, "--json", "statusCheckRollup,reviewDecision"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return { ciStatus: "none", reviewStatus: "none" };
    }

    const data = JSON.parse(output);

    // Parse CI status from statusCheckRollup
    let ciStatus: PrStatus["ciStatus"] = "none";
    const checks: Array<{ status?: string; conclusion?: string }> = data.statusCheckRollup ?? [];
    if (checks.length > 0) {
      const hasFailure = checks.some(
        (c) => c.conclusion === "FAILURE" || c.conclusion === "ERROR",
      );
      const hasPending = checks.some((c) => c.status !== "COMPLETED");
      if (hasFailure) {
        ciStatus = "failure";
      } else if (hasPending) {
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

  // Limit concurrent fetches
  const batch = toFetch.slice(0, MAX_CONCURRENT_FETCHES);
  const fetches = batch.map(async (url) => {
    const status = await fetchPrStatus(url);
    cache.set(url, { status, fetchedAt: Date.now() });
    result.set(url, status);
  });

  await Promise.all(fetches);

  // For URLs beyond the limit, return cached values if available, otherwise skip
  for (const url of toFetch.slice(MAX_CONCURRENT_FETCHES)) {
    const cached = cache.get(url);
    if (cached) {
      result.set(url, cached.status);
    }
  }

  return result;
}
