import { describe, expect, test } from "bun:test";
import { ClaudeCodeAdapter } from "../cli/claude.js";
import { CodexAdapter } from "../cli/codex.js";
import { resolvePhaseMcpConfig } from "../cli/mcp.js";
import type { Config } from "../types.js";

describe("resolvePhaseMcpConfig", () => {
  test("preserves inherited MCP config for adapters that support it", () => {
    const result = resolvePhaseMcpConfig(
      new ClaudeCodeAdapter(),
      {
        name: "review",
        trigger: { label: "Critter Review", status: "In Review" },
        repo: { clone: true },
        phases: [{ name: "review", prompt: "builtin:review", model: "sonnet", maxTurns: 10, tools: "review" }],
        outcomes: { success: { status: "Done" } },
        concurrency: 1,
        timeoutMinutes: 15,
        mcpConfig: "~/.critters/review-mcp.json",
        strictMcpConfig: true,
      },
      {
        mcpConfig: "/tmp/global-mcp.json",
        strictMcpConfig: false,
      } as Config,
    );

    expect(result.mcpConfig).toEqual([`${process.env.HOME}/.critters/review-mcp.json`]);
    expect(result.strictMcpConfig).toBe(true);
  });

  test("ignores inherited MCP config for adapters that do not support it", () => {
    const result = resolvePhaseMcpConfig(
      new CodexAdapter(),
      {
        name: "review",
        trigger: { label: "Critter Review", status: "In Review" },
        repo: { clone: true },
        phases: [{ name: "review", prompt: "builtin:review", model: "gpt-5.4", maxTurns: 10, tools: "review" }],
        outcomes: { success: { status: "Done" } },
        concurrency: 1,
        timeoutMinutes: 15,
        mcpConfig: "~/.critters/review-mcp.json",
        strictMcpConfig: true,
      },
      {
        mcpConfig: "/tmp/global-mcp.json",
        strictMcpConfig: true,
      } as Config,
    );

    expect(result).toEqual({
      mcpConfig: [],
      strictMcpConfig: false,
    });
  });
});
