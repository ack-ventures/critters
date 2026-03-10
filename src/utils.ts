import { spawn } from "node:child_process";
import type { CritterTypeConfig } from "./critter-type.js";
import type { IssueTracker } from "./tracker/types.js";
import type { Config, SpawnResult } from "./types.js";

export function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, options?.cwd ? { cwd: options.cwd } : undefined);
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d));
    proc.stderr?.on("data", (d) => (stderr += d));
    proc.on("error", (err) => {
      resolve({ code: 1, stdout, stderr: stderr ? `${stderr}\n${err.message}` : err.message });
    });
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function branchName(identifier: string, title: string, prefix: string = "critter"): string {
  return `${prefix}/${identifier}-${slugify(title)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function tailLines(text: string, n: number): string {
  const lines = text.split("\n");
  return lines.slice(-n).join("\n");
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return `${tokens}`;
}

export function formatPhaseStats(result: { numTurns?: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; costUsd?: number }): string {
  if (result.numTurns == null) return "";
  const parts: string[] = [];
  if (result.inputTokens != null) parts.push(`${formatTokenCount(result.inputTokens)} in`);
  if (result.outputTokens != null) parts.push(`${formatTokenCount(result.outputTokens)} out`);
  if (result.cacheReadTokens != null) parts.push(`${formatTokenCount(result.cacheReadTokens)} cached`);
  const tokens = parts.length > 0 ? `, ${parts.join(" / ")}` : "";
  const cost = result.costUsd != null ? `, $${result.costUsd.toFixed(2)}` : "";
  return ` (${result.numTurns} turns${tokens}${cost})`;
}

export function shortRepoName(repoUrl: string): string {
  // Strip trailing .git if present
  const cleaned = repoUrl.replace(/\.git$/, "");
  // SSH: git@github.com:org/repo → extract after ':'
  const colonIdx = cleaned.indexOf(":");
  if (colonIdx !== -1 && !cleaned.includes("://")) {
    const afterColon = cleaned.slice(colonIdx + 1);
    return afterColon;
  }
  // HTTPS: https://github.com/org/repo → extract last two path segments
  const parts = cleaned.split("/");
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return repoUrl; // fallback: return as-is
}

export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Extract "owner/repo" from a git remote URL.
 * Supports:
 *   git@github.com:owner/repo.git
 *   https://github.com/owner/repo.git
 *   git@bitbucket.org:owner/repo.git
 * Returns null if the URL doesn't match.
 */
export function extractOwnerRepo(repoUrl: string): string | null {
  // SSH: git@host:owner/repo.git
  const sshMatch = repoUrl.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  // HTTPS: https://host/owner/repo.git
  const httpsMatch = repoUrl.match(/^https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];

  return null;
}

export function aggregatePhaseResults(
  results: SpawnResult[],
): { totalTurns: number; totalInput: number; totalOutput: number; totalCache: number; totalCost: number } {
  let totalTurns = 0, totalInput = 0, totalOutput = 0, totalCache = 0, totalCost = 0;
  for (const r of results) {
    totalTurns += r.numTurns ?? 0;
    totalInput += r.inputTokens ?? 0;
    totalOutput += r.outputTokens ?? 0;
    totalCache += r.cacheReadTokens ?? 0;
    totalCost += r.costUsd ?? 0;
  }
  return { totalTurns, totalInput, totalOutput, totalCache, totalCost };
}

export function truncateComment(text: string, maxLength = 10000): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n\n*(truncated)*`;
}

export function getTracker(
  critterType: CritterTypeConfig,
  config: Config,
  trackers: Map<string, IssueTracker>,
): IssueTracker {
  const providerName = critterType.provider ?? config.provider;
  const tracker = trackers.get(providerName);
  if (!tracker) {
    throw new Error(`No tracker configured for provider "${providerName}" (critter type "${critterType.name}")`);
  }
  return tracker;
}
