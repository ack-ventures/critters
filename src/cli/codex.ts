import { existsSync, readFileSync } from "node:fs";
import type { CritterTypeConfig } from "../critter-type.js";
import { logTaskWarn } from "../logger.js";
import type { Config } from "../types.js";
import { runCommand, shellEscape } from "../utils.js";
import { resolveMcpConfigShared } from "./mcp.js";
import { parseReviewDecisionFromText } from "./parse-review.js";
import type {
  CliAdapter,
  CliCapabilities,
  CliCommand,
  ParsedOutput,
  ParsedOutputLine,
  ReviewDecision,
  SpawnOptions,
  ToolNameMap,
} from "./types.js";

export class CodexAdapter implements CliAdapter {
  readonly name = "Codex CLI";
  readonly binary = "codex";

  async checkPrerequisite(): Promise<{ version: string }> {
    const result = await runCommand("codex", ["--version"]);
    if (result.code !== 0) {
      throw new Error(
        `codex CLI not found or not working: ${result.stderr.trim() || result.stdout.trim() || "unknown error"}`,
      );
    }

    return { version: result.stdout.trim() };
  }

  buildCommand(opts: SpawnOptions): CliCommand {
    const sandbox = opts.sandbox?.trim() || "workspace-write";
    const permissionMode = opts.permissionMode?.trim();
    const automationArgs = codexAutomationArgs(permissionMode, sandbox);
    const args = [
      "codex",
      ...automationArgs,
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--output-last-message", shellEscape(opts.lastMessageFile),
      "-m", shellEscape(opts.model),
      "-C", shellEscape(opts.workDir),
      "-",
    ];

    return {
      script: [
        `export PATH="$HOME/.bun/bin:$HOME/.local/bin:${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}"`,
        `cd ${shellEscape(opts.workDir)}`,
        `exec ${args.join(" ")} < ${shellEscape(opts.promptFile)}`,
      ].join("\n"),
    };
  }

  parseOutputLog(logFile: string, identifier: string): ParsedOutput {
    if (!existsSync(logFile)) return {};

    try {
      const lines = readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean);
      let numTurns = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let costUsd: number | undefined;
      let sawTotalUsage = false;

      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          if (obj.type === "turn.started") {
            numTurns++;
          }

          const cost = readNumber(obj, ["total_cost_usd", "cost_usd", "costUsd"]);
          if (cost != null) {
            costUsd = cost;
          }

          const totalUsage = readObject(obj, ["total_token_usage", "totalTokenUsage"]);
          if (totalUsage) {
            sawTotalUsage = true;
            inputTokens = readNumber(totalUsage, ["input_tokens", "inputTokens", "input_tokens_total"]) ?? 0;
            outputTokens = readNumber(totalUsage, ["output_tokens", "outputTokens", "output_tokens_total"]) ?? 0;
            cacheReadTokens = readNumber(totalUsage, [
              "cached_input_tokens",
              "cachedInputTokens",
              "cache_read_input_tokens",
              "cacheReadInputTokens",
              "cache_read_tokens",
            ]) ?? 0;
            continue;
          }

          if (!sawTotalUsage) {
            const usage = readObject(obj, ["token_usage", "tokenUsage", "usage"]);
            if (usage) {
              inputTokens += readNumber(usage, ["input_tokens", "inputTokens", "input_tokens_total"]) ?? 0;
              outputTokens += readNumber(usage, ["output_tokens", "outputTokens", "output_tokens_total"]) ?? 0;
              cacheReadTokens += readNumber(usage, [
                "cached_input_tokens",
                "cachedInputTokens",
                "cache_read_input_tokens",
                "cacheReadInputTokens",
                "cache_read_tokens",
              ]) ?? 0;
              continue;
            }
          }

          if (!sawTotalUsage) {
            inputTokens += readNumber(obj, ["input_tokens", "inputTokens", "input_tokens_total"]) ?? 0;
            outputTokens += readNumber(obj, ["output_tokens", "outputTokens", "output_tokens_total"]) ?? 0;
            cacheReadTokens += readNumber(obj, [
              "cached_input_tokens",
              "cachedInputTokens",
              "cache_read_input_tokens",
              "cacheReadInputTokens",
              "cache_read_tokens",
            ]) ?? 0;
          }
        } catch {}
      }

      return {
        numTurns: numTurns || undefined,
        inputTokens: inputTokens || undefined,
        outputTokens: outputTokens || undefined,
        cacheReadTokens: cacheReadTokens || undefined,
        costUsd,
      };
    } catch (err) {
      logTaskWarn(identifier, `Failed to read Codex output log: ${err}`);
      return {};
    }
  }

  readPartialCost(logFile: string): number {
    return this.parseOutputLog(logFile, "codex").costUsd ?? 0;
  }

  extractTextFromLog(logFile: string): string[] {
    if (!existsSync(logFile)) return [];

    const texts: string[] = [];
    try {
      const lines = readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          texts.push(...extractTextCandidates(obj));
        } catch {}
      }
    } catch {
      return [];
    }
    return texts.filter((text) => text.trim().length > 0);
  }

  extractFinalResponse(logFile: string, lastMessageFile: string): string | null {
    if (existsSync(lastMessageFile)) {
      const text = readFileSync(lastMessageFile, "utf-8").trim();
      if (text) return text;
    }

    const texts = this.extractTextFromLog(logFile);
    for (let i = texts.length - 1; i >= 0; i--) {
      if (texts[i].trim()) {
        return texts[i];
      }
    }
    return null;
  }

  extractReviewDecision(logFile: string, lastMessageFile: string): ReviewDecision {
    const response = this.extractFinalResponse(logFile, lastMessageFile);
    if (!response) return { decision: "unknown" };
    return parseReviewDecisionFromText(response);
  }

  formatToolUse(block: { name: string; input?: Record<string, unknown> }): string {
    const name = block.name;
    const input = block.input ?? {};
    if (name === "exec_command") {
      return `→ Bash $ ${input.cmd ?? input.command ?? ""}`;
    }
    if (name === "view" || name === "read") {
      return `→ Read ${input.path ?? input.file_path ?? ""}`;
    }
    if (name === "apply_patch" || name === "write") {
      return `→ Write ${input.path ?? input.file_path ?? ""}`;
    }
    if (name === "find") {
      return `→ Grep /${input.pattern ?? ""}/ ${input.path ?? ""}`.trim();
    }
    return `→ ${name}`;
  }

  parseOutputLine(line: string): ParsedOutputLine | null {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "error" && typeof obj.message === "string") {
        return { type: "text", text: obj.message };
      }
      if (obj.type === "turn.started" || obj.type === "thread.started") {
        return { type: "system" };
      }
      if (extractTextCandidates(obj).length > 0) {
        return { type: "text" };
      }
      return { type: "unknown" };
    } catch {
      return null;
    }
  }

  renderOutputLine(line: string): string[] {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const type = typeof obj.type === "string" ? obj.type : "";
      if (type === "thread.started" || type === "turn.started" || type === "turn.completed") {
        return [];
      }
      if (type === "error" && typeof obj.message === "string") {
        return [`✗ ${obj.message}`];
      }

      const toolLine = renderCodexToolUse(obj);
      if (toolLine) {
        return [toolLine];
      }

      const texts = extractTextCandidates(obj);
      if (texts.length > 0) {
        return texts;
      }
    } catch {
      return [line];
    }
    return [];
  }

  getDisplayFilter(): string | null {
    return null;
  }

  resolveModel(model: string): string {
    return model;
  }

  resolveTools(tools: string[]): string[] {
    return tools;
  }

  readonly capabilities: CliCapabilities = {
    toolRestrictions: false,
    costTracking: true,
    mcp: false,
    maxTurns: false,
    subagents: false,
  };

  toolNames(): ToolNameMap {
    return {
      read: "view",
      write: "apply_patch",
      edit: "apply_patch",
      bash: "exec_command",
      glob: "find",
      grep: "find",
      task: null,
    };
  }

  promptGuidance(): string {
    return `## Reading Large Files
Use targeted file reads and searches instead of dumping large files all at once.

## Editing Files
- Read a file before editing it.
- Keep edits focused and prefer small patches.
- If a command appears blocked by sandboxing, do not retry it repeatedly.`;
  }

  resolveMcpConfig(
    critterType: CritterTypeConfig,
    config: Config,
  ): { mcpConfig: string[]; strictMcpConfig: boolean } {
    return resolveMcpConfigShared(critterType, config);
  }
}

function codexAutomationArgs(permissionMode: string | undefined, sandbox: string): string[] {
  if (permissionMode === "auto") {
    return ["--full-auto", "--sandbox", shellEscape(sandbox)];
  }
  if (permissionMode === "bypassPermissions") {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }
  return ["-a", "never", "--sandbox", shellEscape(sandbox)];
}

function readNumber(obj: unknown, candidateKeys: string[]): number | undefined {
  if (obj == null || typeof obj !== "object") return undefined;
  const queue: unknown[] = [obj];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const key of candidateKeys) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
    queue.push(...Object.values(record));
  }

  return undefined;
}

function readObject(obj: unknown, candidateKeys: string[]): Record<string, unknown> | undefined {
  if (obj == null || typeof obj !== "object") return undefined;
  const queue: unknown[] = [obj];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const key of candidateKeys) {
      const value = record[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    }
    queue.push(...Object.values(record));
  }

  return undefined;
}

function extractTextCandidates(obj: Record<string, unknown>): string[] {
  const texts: string[] = [];

  const message = obj.message;
  if (typeof message === "string" && shouldKeepText(obj.type, message)) {
    texts.push(message);
  }

  const text = obj.text;
  if (typeof text === "string" && shouldKeepText(obj.type, text)) {
    texts.push(text);
  }

  const delta = obj.delta;
  if (typeof delta === "string" && shouldKeepText(obj.type, delta)) {
    texts.push(delta);
  }

  const content = obj.content;
  if (typeof content === "string" && shouldKeepText(obj.type, content)) {
    texts.push(content);
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === "string") {
        if (shouldKeepText(obj.type, item)) texts.push(item);
      } else if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        if (typeof record.text === "string" && shouldKeepText(obj.type, record.text)) {
          texts.push(record.text);
        }
      }
    }
  }

  const result = obj.result;
  if (typeof result === "string" && shouldKeepText(obj.type, result)) {
    texts.push(result);
  }

  const item = obj.item;
  if (item && typeof item === "object") {
    texts.push(...extractTextCandidates(item as Record<string, unknown>));
  }

  return texts;
}

function shouldKeepText(type: unknown, text: string): boolean {
  if (!text.trim()) return false;
  if (typeof type !== "string") return true;
  return !["thread.started", "turn.started", "turn.completed"].includes(type);
}

function renderCodexToolUse(obj: Record<string, unknown>): string | null {
  const type = typeof obj.type === "string" ? obj.type : "";

  const command = readString(obj, ["command", "cmd"]);
  if (command && /command|shell|exec/i.test(type)) {
    return `→ Bash $ ${command}`;
  }

  const path = readString(obj, ["path", "file_path", "filePath"]);
  if (path && /read|view/i.test(type)) {
    return `→ Read ${path}`;
  }
  if (path && /write|edit|patch/i.test(type)) {
    return `→ Write ${path}`;
  }

  const toolName = readString(obj, ["tool_name", "toolName", "name"]);
  if (toolName && command) {
    return `→ ${toolName} ${command}`;
  }
  if (toolName && path) {
    return `→ ${toolName} ${path}`;
  }

  return null;
}

function readString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}
