import { existsSync, readFileSync } from "node:fs";
import type { SpawnResult } from "../types.js";
import { tailLines } from "../utils.js";

const MAX_TAIL_LINES = 20;
const MAX_TAIL_BYTES = 2048;

/**
 * Validates a phase spawn result, throwing descriptive errors for
 * timeouts and non-zero exit codes.
 */
export function validatePhaseResult(result: SpawnResult, phaseName: string): void {
  if (result.timedOut) {
    throw new Error(`Timed out during ${phaseName} phase`);
  }
  if (result.exitCode !== 0) {
    const stderrTrimmed = result.stderr.trim();
    let excerpt = "";
    if (stderrTrimmed.length > 0) {
      excerpt = tailLines(result.stderr, MAX_TAIL_LINES);
    } else if (result.outputLogPath && existsSync(result.outputLogPath)) {
      excerpt = readOutputLogTail(result.outputLogPath);
    }
    const label = phaseName.charAt(0).toUpperCase() + phaseName.slice(1);
    const body = excerpt || "(no stderr or output log available)";
    throw new Error(`${label} failed (exit ${result.exitCode}):\n${body}`);
  }
}

function readOutputLogTail(path: string): string {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return "";
  }

  const allLines = raw.split("\n");
  while (allLines.length > 0 && allLines[allLines.length - 1] === "") {
    allLines.pop();
  }
  const tail = allLines.slice(-MAX_TAIL_LINES);

  const rendered: string[] = [];
  for (const line of tail) {
    const extracted = extractStreamJsonLine(line);
    if (extracted) rendered.push(extracted);
  }

  if (rendered.length > 0) {
    return clipBytes(rendered.join("\n"));
  }
  return clipBytes(tailLines(raw, MAX_TAIL_LINES));
}

function extractStreamJsonLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;

  if (rec.type === "assistant") {
    const message = rec.message as { content?: unknown } | undefined;
    const content = message?.content;
    if (typeof content === "string") {
      return content.trim() || null;
    }
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          const txt = b.text.trim();
          if (txt) parts.push(txt);
        } else if (b.type === "tool_use" && typeof b.name === "string") {
          parts.push(`\u2192 ${b.name}`);
        }
      }
      return parts.length > 0 ? parts.join("\n") : null;
    }
    return null;
  }

  if (rec.type === "user") {
    const message = rec.message as { content?: unknown } | undefined;
    const content = message?.content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type === "tool_result" && b.is_error === true) {
          const body = renderToolResultContent(b.content);
          if (body) parts.push(`\u2717 ${body}`);
        }
      }
      return parts.length > 0 ? parts.join("\n") : null;
    }
    return null;
  }

  if (rec.type === "result" && typeof rec.result === "string") {
    return rec.result.trim() || null;
  }

  return null;
}

function renderToolResultContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
      else if (typeof b.text === "string") parts.push(b.text);
    }
    return parts.join("\n").trim();
  }
  return "";
}

function clipBytes(s: string): string {
  const buf = Buffer.from(s, "utf-8");
  if (buf.byteLength <= MAX_TAIL_BYTES) return s;
  const clipped = buf.subarray(buf.byteLength - MAX_TAIL_BYTES).toString("utf-8");
  return `\u2026\n${clipped}`;
}
