import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CritterTypeConfig } from "../critter-type.js";
import { STREAM_FILTER } from "../jq-filter.js";
import { logTaskWarn } from "../logger.js";
import type { Config } from "../types.js";
import { runCommand, shellEscape } from "../utils.js";
import type {
  CliAdapter,
  CliCommand,
  ParsedOutput,
  ParsedOutputLine,
  SpawnOptions,
  ToolNameMap,
} from "./types.js";

export class ClaudeCodeAdapter implements CliAdapter {
  readonly name = "Claude Code";
  readonly binary = "claude";

  async checkPrerequisite(): Promise<{ version: string }> {
    const result = await runCommand("claude", ["--version"]);
    if (result.code !== 0) {
      throw new Error(
        "claude CLI not found or not working. Install it: https://docs.anthropic.com/en/docs/claude-code",
      );
    }
    return { version: result.stdout.trim() };
  }

  buildCommand(opts: SpawnOptions): CliCommand {
    const currentPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
    const { mcpArgs, strictMcpArg } = buildMcpArgs(
      opts.mcpConfig,
      opts.strictMcpConfig,
      " ",
    );

    const script = [
      `export PATH="$HOME/.bun/bin:$HOME/.local/bin:${currentPath}"`,
      "unset CLAUDECODE",
      `cd ${shellEscape(opts.workDir)}`,
      `exec claude -p "$(cat ${shellEscape(opts.promptFile)})"` +
        ` --model ${shellEscape(opts.model)}` +
        ` --allowedTools ${shellEscape(opts.allowedTools.join(","))}` +
        ` --max-turns ${opts.maxTurns}` +
        ` --verbose` +
        ` --output-format stream-json` +
        mcpArgs +
        strictMcpArg,
    ].join("\n");

    return {
      script,
      env: { CLAUDECODE: undefined },
    };
  }

  parseOutputLog(logFile: string, identifier: string): ParsedOutput {
    if (!existsSync(logFile)) return {};
    try {
      const content = readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      let numTurns: number | undefined;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let costUsd: number | undefined;

      let skippedLines = 0;

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === "result") {
            if (typeof obj.num_turns === "number") {
              numTurns = obj.num_turns;
            }
            if (typeof obj.total_cost_usd === "number") {
              costUsd = obj.total_cost_usd;
            }
            if (obj.modelUsage && typeof obj.modelUsage === "object") {
              inputTokens = 0;
              outputTokens = 0;
              cacheReadTokens = 0;
              for (const model of Object.values(obj.modelUsage) as Record<
                string,
                number
              >[]) {
                inputTokens +=
                  (model.inputTokens ?? 0) +
                  (model.cacheCreationInputTokens ?? 0);
                outputTokens += model.outputTokens ?? 0;
                cacheReadTokens += model.cacheReadInputTokens ?? 0;
              }
            }
          }
        } catch {
          skippedLines++;
        }
      }

      if (skippedLines > 0) {
        logTaskWarn(
          identifier,
          `Skipped ${skippedLines} unparseable lines in Claude output`,
        );
      }

      if (numTurns === undefined || (inputTokens === 0 && outputTokens === 0)) {
        logTaskWarn(
          identifier,
          "Could not parse usage data from Claude output",
        );
      }

      return {
        numTurns,
        inputTokens: inputTokens || undefined,
        outputTokens: outputTokens || undefined,
        cacheReadTokens: cacheReadTokens || undefined,
        costUsd,
      };
    } catch (err) {
      logTaskWarn(identifier, `Failed to read Claude output log: ${err}`);
    }
    return {};
  }

  readPartialCost(logFile: string): number {
    if (!existsSync(logFile)) return 0;
    try {
      const content = readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      let cost = 0;
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (
            obj.type === "result" &&
            typeof obj.total_cost_usd === "number"
          ) {
            cost = obj.total_cost_usd;
          }
        } catch {
          // Truncated line — skip
        }
      }
      return cost;
    } catch {
      return 0;
    }
  }

  extractTextFromLog(logFile: string): string[] {
    if (!existsSync(logFile)) return [];

    try {
      const content = readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const texts: string[] = [];

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === "assistant" && typeof obj.message?.content === "string") {
            texts.push(obj.message.content);
          } else if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
            const text = obj.message.content
              .filter((b: { type: string }) => b.type === "text")
              .map((b: { text: string }) => b.text)
              .join("\n");
            if (text) texts.push(text);
          } else if (obj.type === "result" && typeof obj.result === "string") {
            texts.push(obj.result);
          }
        } catch {
          continue;
        }
      }

      return texts;
    } catch {
      return [];
    }
  }

  formatToolUse(block: {
    name: string;
    input?: Record<string, unknown>;
  }): string {
    const name = block.name;
    const input = block.input ?? {};

    if (name === "Read" || name === "Write" || name === "Edit") {
      return `\u2192 ${name} ${input.file_path ?? ""}`;
    }
    if (name === "Bash") {
      return `\u2192 Bash $ ${input.command ?? ""}`;
    }
    if (name === "Glob") {
      const pattern = input.pattern ?? "";
      const path = input.path ? ` in ${input.path}` : "";
      return `\u2192 Glob ${pattern}${path}`;
    }
    if (name === "Grep") {
      const pattern = input.pattern ?? "";
      const path = input.path ? ` in ${input.path}` : "";
      return `\u2192 Grep /${pattern}/${path}`;
    }
    if (name === "Task") {
      return `\u2192 Task (${input.description ?? ""})`;
    }
    return `\u2192 ${name}`;
  }

  parseOutputLine(line: string): ParsedOutputLine | null {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "assistant") {
        return { type: "text" };
      }
      if (obj.type === "result") {
        return {
          type: "result",
          costUsd: obj.total_cost_usd,
          numTurns: obj.num_turns,
        };
      }
      if (obj.type === "user") {
        return { type: "tool_result" };
      }
      if (obj.type === "system") {
        return { type: "system" };
      }
      return { type: "unknown" };
    } catch {
      return null;
    }
  }

  getDisplayFilter(): string | null {
    return STREAM_FILTER;
  }

  resolveModel(model: string): string {
    return model;
  }

  resolveTools(tools: string[]): string[] {
    return tools;
  }

  supportsToolRestrictions(): boolean {
    return true;
  }

  supportsCostTracking(): boolean {
    return true;
  }

  supportsMcp(): boolean {
    return true;
  }

  supportsMaxTurns(): boolean {
    return true;
  }

  supportsSubagents(): boolean {
    return true;
  }

  toolNames(): ToolNameMap {
    return {
      read: "Read",
      write: "Write",
      edit: "Edit",
      bash: "Bash",
      glob: "Glob",
      grep: "Grep",
      task: "Task",
    };
  }

  promptGuidance(): string {
    return `## Reading Large Files
The Read tool supports \`offset\` and \`limit\` parameters \u2014 use these to read large files in chunks rather than attempting to read the entire file at once.

## Editing Files
- Always read a file before editing it. Pay attention to whether it uses tabs or spaces for indentation \u2014 the Read tool's line numbers can make tabs look like spaces.
- Do not fire more than 3\u20114 Edit calls in parallel. If one fails, all sibling parallel edits are cancelled too.`;
  }

  resolveMcpConfig(
    critterType: CritterTypeConfig,
    config: Config,
  ): { mcpConfig: string[]; strictMcpConfig: boolean } {
    const raw = critterType.mcpConfig ?? config.mcpConfig;
    const strict =
      critterType.strictMcpConfig ?? config.strictMcpConfig ?? false;

    if (!raw) return { mcpConfig: [], strictMcpConfig: strict };

    const paths = Array.isArray(raw) ? raw : [raw];
    const resolved = paths.map((p) =>
      p.startsWith("~") ? join(homedir(), p.slice(1)) : p,
    );

    return { mcpConfig: resolved, strictMcpConfig: strict };
  }
}

function buildMcpArgs(
  mcpConfig: string[] | undefined,
  strictMcpConfig: boolean | undefined,
  separator: string,
): { mcpArgs: string; strictMcpArg: string } {
  const mcpArgs =
    mcpConfig && mcpConfig.length > 0
      ? mcpConfig.map((p) => `${separator}--mcp-config ${shellEscape(p)}`).join("")
      : "";
  const strictMcpArg = strictMcpConfig
    ? `${separator}--strict-mcp-config`
    : "";
  return { mcpArgs, strictMcpArg };
}
