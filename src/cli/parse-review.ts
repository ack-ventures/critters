import type { ReviewDecision } from "./types.js";

export function parseReviewDecisionFromText(text: string): ReviewDecision {
  const match = text.match(/REVIEW_RESULT:(MERGED|NEEDS_CHANGES)(?::(.+))?/);
  if (!match) {
    return { decision: "unknown" };
  }
  if (match[1] === "MERGED") {
    return { decision: "merged" };
  }
  return { decision: "needs_changes", reason: match[2] || "No reason provided" };
}
