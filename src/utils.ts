import { spawn } from "node:child_process";

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

export function branchName(identifier: string, title: string): string {
  return `critter/${identifier}-${slugify(title)}`;
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

export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
