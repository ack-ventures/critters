import type { CritterTypeConfig } from "../critter-type.js";
import type { Config } from "../types.js";

export interface ToolNameMap {
  read: string;
  write: string;
  edit: string;
  bash: string;
  glob: string;
  grep: string;
  task: string | null;
}

export interface SpawnOptions {
  prompt: string;
  promptFile: string;
  lastMessageFile: string;
  allowedTools: string[];
  workDir: string;
  maxTurns: number;
  model: string;
  sandbox?: string;
  mcpConfig?: string[];
  strictMcpConfig?: boolean;
}

export interface CliCommand {
  /** The shell script content to execute */
  script: string;
  /** Environment variable overrides (undefined = unset) */
  env?: Record<string, string | undefined>;
}

export interface ParsedOutput {
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
}

export interface ParsedOutputLine {
  type: "text" | "tool_use" | "tool_result" | "result" | "system" | "unknown";
  text?: string;
  toolName?: string;
  costUsd?: number;
  numTurns?: number;
}

export interface ReviewDecision {
  decision: "merged" | "needs_changes" | "unknown";
  reason?: string;
}

export interface CliAdapter {
  readonly name: string;
  readonly binary: string;

  // Lifecycle
  checkPrerequisite(): Promise<{ version: string }>;
  buildCommand(opts: SpawnOptions): CliCommand;

  // Output parsing
  parseOutputLog(logFile: string, identifier: string): ParsedOutput;
  readPartialCost(logFile: string): number;
  extractTextFromLog(logFile: string): string[];
  extractFinalResponse(logFile: string, lastMessageFile: string): string | null;
  extractReviewDecision(logFile: string, lastMessageFile: string): ReviewDecision;
  formatToolUse(block: { name: string; input?: Record<string, unknown> }): string;
  parseOutputLine(line: string): ParsedOutputLine | null;
  renderOutputLine(line: string): string[];

  // Configuration mapping
  getDisplayFilter(): string | null;
  resolveModel(model: string): string;
  resolveTools(tools: string[]): string[];

  // Capability declarations
  supportsToolRestrictions(): boolean;
  supportsCostTracking(): boolean;
  supportsMcp(): boolean;
  supportsMaxTurns(): boolean;
  supportsSubagents(): boolean;

  // Prompt integration
  toolNames(): ToolNameMap;
  promptGuidance(): string;

  // MCP config resolution
  resolveMcpConfig(
    critterType: CritterTypeConfig,
    config: Config,
  ): { mcpConfig: string[]; strictMcpConfig: boolean };
}
