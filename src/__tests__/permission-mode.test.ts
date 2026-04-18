import { describe, expect, test } from "bun:test";
import { ClaudeCodeAdapter } from "../cli/claude.js";
import { CodexAdapter } from "../cli/codex.js";

describe("permissionMode in buildCommand", () => {
  test("Claude adapter includes --permission-mode when set", () => {
    const adapter = new ClaudeCodeAdapter();
    const cmd = adapter.buildCommand({
      prompt: "test",
      promptFile: "/tmp/prompt.txt",
      lastMessageFile: "/tmp/last.txt",
      allowedTools: ["Read"],
      workDir: "/tmp/work",
      maxTurns: 10,
      model: "opus",
      permissionMode: "auto",
    });
    expect(cmd.script).toContain("--permission-mode 'auto'");
  });

  test("Claude adapter omits --permission-mode when unset", () => {
    const adapter = new ClaudeCodeAdapter();
    const cmd = adapter.buildCommand({
      prompt: "test",
      promptFile: "/tmp/prompt.txt",
      lastMessageFile: "/tmp/last.txt",
      allowedTools: ["Read"],
      workDir: "/tmp/work",
      maxTurns: 10,
      model: "opus",
    });
    expect(cmd.script).not.toContain("--permission-mode");
  });

  test("Codex adapter ignores permissionMode", () => {
    const adapter = new CodexAdapter();
    const cmd = adapter.buildCommand({
      prompt: "test",
      promptFile: "/tmp/prompt.txt",
      lastMessageFile: "/tmp/last.txt",
      allowedTools: [],
      workDir: "/tmp/work",
      maxTurns: 10,
      model: "gpt-5.4",
      permissionMode: "auto",
    });
    expect(cmd.script).not.toContain("--permission-mode");
  });
});
