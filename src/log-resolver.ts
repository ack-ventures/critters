import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCliAdapter, getCliAdapterByBinary } from "./cli/registry.js";
import type { CliAdapter } from "./cli/types.js";
import { sanitizeIdentifier } from "./utils.js";

const PHASE_FILE_MAP: Record<string, string> = {
  planning: "plan",
  execution: "exec",
  review: "review",
};

export function phaseFileTag(phase: string): string {
  return PHASE_FILE_MAP[phase] ?? phase;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes use control characters by definition
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export function extractTimestamp(dirName: string): number {
  const parts = dirName.split("-");
  return parseInt(parts[parts.length - 1], 10);
}

export function newestDir(dirs: string[]): string {
  return dirs.sort((a, b) => extractTimestamp(b) - extractTimestamp(a))[0];
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findWorkDirs(workDir: string, identifier: string): { critterDirs: string[]; reviewDirs: string[] } {
  if (!existsSync(workDir)) {
    return { critterDirs: [], reviewDirs: [] };
  }

  // Work dirs are created with the sanitized identifier (see unified-spawner),
  // so match on that form — no-op for Linear/Jira identifiers.
  const escaped = escapeRegExp(sanitizeIdentifier(identifier));
  const critterDirPattern = new RegExp(`^${escaped}-\\d+$`);
  const reviewDirPattern = new RegExp(`^review-${escaped}-\\d+$`);

  const entries = readdirSync(workDir);
  const critterDirs = entries.filter((e) => critterDirPattern.test(e));
  const reviewDirs = entries.filter((e) => reviewDirPattern.test(e));

  return { critterDirs, reviewDirs };
}

export function resolveWorkDirForIdentifier(workDir: string, identifier: string): string | null {
  const { critterDirs, reviewDirs } = findWorkDirs(workDir, identifier);
  const allDirs = [...critterDirs, ...reviewDirs];
  if (allDirs.length === 0) return null;
  return `${workDir}/${newestDir(allDirs)}`;
}

export function resolveLogFile(dir: string, phase?: string): string | null {
  if (phase) {
    const tag = phaseFileTag(phase);
    const logFile = `${dir}/.critter-output-${tag}.json`;
    if (existsSync(logFile) && statSync(logFile).size > 0) return logFile;
    return null;
  }

  // Auto-detect: review > execution > planning
  for (const p of ["review", "execution", "planning"]) {
    const tag = phaseFileTag(p);
    const logFile = `${dir}/.critter-output-${tag}.json`;
    if (existsSync(logFile) && statSync(logFile).size > 0) return logFile;
  }

  // Check for custom phase files
  try {
    const entries = readdirSync(dir);
    const logFiles = entries.filter((e) => e.startsWith(".critter-output-") && e.endsWith(".json"));
    if (logFiles.length > 0) {
      // Pick the most recently modified
      logFiles.sort((a, b) => {
        const sa = statSync(`${dir}/${a}`);
        const sb = statSync(`${dir}/${b}`);
        return sb.mtimeMs - sa.mtimeMs;
      });
      const logFile = `${dir}/${logFiles[0]}`;
      if (statSync(logFile).size > 0) return logFile;
    }
  } catch {}

  return null;
}

export function resolveAllPhases(dir: string): Array<{ phase: string; logFile: string }> {
  const results: Array<{ phase: string; logFile: string }> = [];

  try {
    const entries = readdirSync(dir);
    const logFiles = entries.filter((e) => e.startsWith(".critter-output-") && e.endsWith(".json"));

    // Reverse map: file tag -> display name
    const tagToPhase: Record<string, string> = {
      plan: "planning",
      exec: "execution",
      review: "review",
    };

    for (const f of logFiles) {
      const match = f.match(/^\.critter-output-(.+)\.json$/);
      if (!match) continue;
      const tag = match[1];
      const phaseName = tagToPhase[tag] ?? tag;
      const fullPath = `${dir}/${f}`;
      if (statSync(fullPath).size > 0) {
        results.push({ phase: phaseName, logFile: fullPath });
      }
    }
  } catch {}

  // Sort: planning first, then execution, then review, then custom
  const order: Record<string, number> = { planning: 0, execution: 1, review: 2 };
  results.sort((a, b) => (order[a.phase] ?? 99) - (order[b.phase] ?? 99));

  return results;
}

export function resolveCliAdapterForLog(logFile: string): CliAdapter {
  const match = logFile.match(/\.critter-output-(.+)\.json$/);
  if (!match) {
    return getCliAdapter("claude");
  }

  const metaFile = logFile.replace(`.critter-output-${match[1]}.json`, `.critter-meta-${match[1]}.json`);
  if (!existsSync(metaFile)) {
    return getCliAdapter("claude");
  }

  try {
    const meta = JSON.parse(readFileSync(metaFile, "utf-8")) as { cli?: string };
    if (meta.cli) {
      return getCliAdapterByBinary(meta.cli);
    }
  } catch {
    // Fall through to default
  }

  return getCliAdapter("claude");
}

export function inferCliAdapterForLogContent(content: string): CliAdapter {
  const lines = content.split("\n").filter((line) => line.trim()).slice(0, 100);

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const type = typeof obj.type === "string" ? obj.type : "";
      if (
        type === "thread.started" ||
        type === "turn.started" ||
        type === "turn.completed" ||
        type === "item.completed" ||
        type.startsWith("exec.") ||
        type.startsWith("response.")
      ) {
        return getCliAdapter("codex");
      }
      if (type === "result" || type === "assistant" || type === "user") {
        return getCliAdapter("claude");
      }
    } catch {
      // Ignore non-JSON lines; uploaded logs can contain truncated tails.
    }
  }

  return getCliAdapter("claude");
}

export function formatToolUse(block: { name: string; input?: Record<string, unknown> }): string {
  const name = block.name;
  const input = block.input ?? {};

  if (name === "Read" || name === "Write" || name === "Edit") {
    return `→ ${name} ${input.file_path ?? ""}`;
  }
  if (name === "Bash") {
    return `→ Bash $ ${input.command ?? ""}`;
  }
  if (name === "Glob") {
    const pattern = input.pattern ?? "";
    const path = input.path ? ` in ${input.path}` : "";
    return `→ Glob ${pattern}${path}`;
  }
  if (name === "Grep") {
    const pattern = input.pattern ?? "";
    const path = input.path ? ` in ${input.path}` : "";
    return `→ Grep /${pattern}/${path}`;
  }
  if (name === "Task") {
    return `→ Task (${input.description ?? ""})`;
  }
  return `→ ${name}`;
}

export function formatUserEvent(obj: Record<string, unknown>): string | null {
  const toolResult = obj.tool_use_result as Record<string, unknown> | undefined;

  if (toolResult && typeof toolResult === "object") {
    const lines: string[] = [];

    if (toolResult.stdout || toolResult.stderr) {
      // Bash output
      if (typeof toolResult.stdout === "string" && toolResult.stdout.length > 0) {
        const stdoutLines = toolResult.stdout.split("\n").filter((l: string) => l.length > 0);
        if (stdoutLines.length > 10) {
          lines.push(...stdoutLines.slice(0, 10), `  ... (${stdoutLines.length} lines total)`);
        } else {
          lines.push(...stdoutLines);
        }
      }
      if (typeof toolResult.stderr === "string" && toolResult.stderr.length > 0) {
        const stderrLines = toolResult.stderr.split("\n").filter((l: string) => l.length > 0);
        const truncated = stderrLines.length > 10
          ? [...stderrLines.slice(0, 10), `  ... (${stderrLines.length} lines total)`]
          : stderrLines;
        lines.push(...truncated.map((l: string) => `stderr: ${l}`));
      }
      return lines.length > 0 ? lines.join("\n") : null;
    }

    if (toolResult.type === "create") {
      return `✓ Created ${toolResult.filePath ?? ""}`;
    }

    if (toolResult.status === "completed") {
      return `✓ Subagent done (${toolResult.totalTokens ?? 0} tokens)`;
    }

    return null;
  }

  // Check for tool errors in message.content
  const message = obj.message as { content?: Array<Record<string, unknown>> } | undefined;
  if (message?.content) {
    const errors = message.content
      .filter((c) => c.type === "tool_result" && c.is_error === true)
      .map((c) => String(c.content ?? "error"));
    if (errors.length > 0) {
      return `✗ ${errors.join(", ").slice(0, 200)}`;
    }
  }

  return null;
}

export function extractPhaseResult(logFile: string): {
  costUsd?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
} | null {
  const adapter = resolveCliAdapterForLog(logFile);
  const parsed = adapter.parseOutputLog(logFile, "log-resolver");
  if (
    parsed.costUsd == null &&
    parsed.numTurns == null &&
    parsed.inputTokens == null &&
    parsed.outputTokens == null &&
    parsed.cacheReadTokens == null
  ) {
    return null;
  }
  return parsed;
}

export function extractPhaseResultFromContent(
  content: string,
  identifier: string,
): {
  costUsd?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
} | null {
  if (!content.trim()) return null;

  const dir = mkdtempSync(join(tmpdir(), "critters-log-"));
  const logFile = join(dir, "output.json");
  try {
    writeFileSync(logFile, content);
    const adapter = inferCliAdapterForLogContent(content);
    const parsed = adapter.parseOutputLog(logFile, identifier);
    if (
      parsed.costUsd == null &&
      parsed.numTurns == null &&
      parsed.inputTokens == null &&
      parsed.outputTokens == null &&
      parsed.cacheReadTokens == null
    ) {
      return null;
    }
    return parsed;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function readLogTail(logFile: string, lines: number): string {
  try {
    const content = readFileSync(logFile, "utf-8");
    const allLines = content.split("\n").filter((l) => l.trim());
    const tail = allLines.slice(-lines);
    return extractReadableContent(tail, resolveCliAdapterForLog(logFile));
  } catch {
    return "";
  }
}

export function renderReadableLines(jsonLines: string[], adapter: CliAdapter): string[] {
  const output: string[] = [];

  for (const line of jsonLines) {
    const rendered = adapter.renderOutputLine(line);
    if (rendered.length > 0) {
      output.push(...rendered.map((entry) => stripAnsi(entry)));
    } else if (!line.trim().startsWith("{")) {
      output.push(stripAnsi(line));
    }
  }

  return output;
}

function extractReadableContent(jsonLines: string[], adapter: CliAdapter): string {
  return renderReadableLines(jsonLines, adapter).join("\n");
}

export function resolvePhasesFromAttachments(
  identifier: string,
  attachments: Array<{ name: string; url: string }>,
): Array<{ phase: string; url: string }> {
  const TAG_TO_PHASE: Record<string, string> = {
    plan: "planning",
    exec: "execution",
    review: "review",
  };
  const ORDER: Record<string, number> = { planning: 0, execution: 1, review: 2 };

  // Attachment names are written with the sanitized identifier (buildLogFileList).
  const pattern = new RegExp(`^${escapeRegExp(sanitizeIdentifier(identifier))}-(.+)-output\\.txt$`);
  const seen = new Set<string>();
  const phases: Array<{ phase: string; url: string }> = [];

  for (const a of attachments) {
    const m = a.name.match(pattern);
    if (!m) continue;
    const tag = m[1];
    const phaseName = TAG_TO_PHASE[tag] ?? tag;
    if (seen.has(phaseName)) continue;
    seen.add(phaseName);
    phases.push({ phase: phaseName, url: a.url });
  }

  phases.sort((a, b) => (ORDER[a.phase] ?? 99) - (ORDER[b.phase] ?? 99));
  return phases;
}
