import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { CodexAdapter } from "../cli/codex.js";
import { readLogTail } from "../log-resolver.js";
import { createTempDir } from "./helpers.js";

describe("CodexAdapter", () => {
  test("uses workspace-write by default and allows sandbox override", () => {
    const adapter = new CodexAdapter();

    const defaultScript = adapter.buildCommand({
      prompt: "Review the PR",
      promptFile: "/tmp/prompt.txt",
      lastMessageFile: "/tmp/last.txt",
      allowedTools: [],
      workDir: "/tmp/work",
      maxTurns: 10,
      model: "gpt-5.4",
    }).script;
    expect(defaultScript).toContain("--sandbox 'workspace-write'");
    expect(defaultScript).toContain("--skip-git-repo-check");

    const overrideScript = adapter.buildCommand({
      prompt: "Review the PR",
      promptFile: "/tmp/prompt.txt",
      lastMessageFile: "/tmp/last.txt",
      allowedTools: [],
      workDir: "/tmp/work",
      maxTurns: 10,
      model: "gpt-5.4",
      sandbox: "danger-full-access",
    }).script;
    expect(overrideScript).toContain("--sandbox 'danger-full-access'");
  });

  test("parses turns and usage metrics from JSONL", () => {
    const tmp = createTempDir();
    try {
      const adapter = new CodexAdapter();
      const logFile = `${tmp.path}/output.json`;
      writeFileSync(logFile, [
        JSON.stringify({ type: "thread.started" }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "response.updated",
          token_usage: {
            input_tokens: 40,
            output_tokens: 15,
            cached_input_tokens: 4,
          },
        }),
        JSON.stringify({
          type: "response.completed",
          token_usage: {
            input_tokens: 100,
            output_tokens: 30,
            cached_input_tokens: 9,
          },
          total_token_usage: {
            input_tokens: 120,
            output_tokens: 45,
            cached_input_tokens: 12,
          },
          total_cost_usd: 0.42,
        }),
      ].join("\n"));

      expect(adapter.parseOutputLog(logFile, "ACK-1")).toEqual({
        numTurns: 2,
        inputTokens: 120,
        outputTokens: 45,
        cacheReadTokens: 12,
        costUsd: 0.42,
      });
    } finally {
      tmp.cleanup();
    }
  });

  test("leaves cost empty when Codex emits usage without an explicit cost field", () => {
    const tmp = createTempDir();
    try {
      const adapter = new CodexAdapter();
      const logFile = `${tmp.path}/output.json`;
      writeFileSync(logFile, JSON.stringify({
        type: "response.completed",
        total_token_usage: {
          input_tokens: 25,
          output_tokens: 10,
          cached_input_tokens: 3,
        },
      }));

      expect(adapter.parseOutputLog(logFile, "ACK-2")).toEqual({
        inputTokens: 25,
        outputTokens: 10,
        cacheReadTokens: 3,
        costUsd: undefined,
      });
    } finally {
      tmp.cleanup();
    }
  });

  test("parses current Codex turn.completed usage shape", () => {
    const tmp = createTempDir();
    try {
      const adapter = new CodexAdapter();
      const logFile = `${tmp.path}/output.json`;
      writeFileSync(logFile, [
        JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Done" } }),
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 17370,
            cached_input_tokens: 4480,
            output_tokens: 22,
            reasoning_output_tokens: 8,
          },
        }),
      ].join("\n"));

      expect(adapter.parseOutputLog(logFile, "ACK-3")).toEqual({
        numTurns: 1,
        inputTokens: 17370,
        outputTokens: 22,
        cacheReadTokens: 4480,
        costUsd: undefined,
      });
    } finally {
      tmp.cleanup();
    }
  });

  test("prefers output-last-message for final response and review decision", () => {
    const tmp = createTempDir();
    try {
      const adapter = new CodexAdapter();
      const logFile = `${tmp.path}/output.json`;
      const lastMessageFile = `${tmp.path}/last.txt`;

      writeFileSync(logFile, JSON.stringify({ type: "turn.started" }));
      writeFileSync(lastMessageFile, "Looks good.\nREVIEW_RESULT:MERGED\n");

      expect(adapter.extractFinalResponse(logFile, lastMessageFile)).toContain("REVIEW_RESULT:MERGED");
      expect(adapter.extractReviewDecision(logFile, lastMessageFile)).toEqual({ decision: "merged" });
    } finally {
      tmp.cleanup();
    }
  });

  test("renders error and command lines", () => {
    const adapter = new CodexAdapter();

    expect(adapter.renderOutputLine(JSON.stringify({
      type: "error",
      message: "Reconnecting...",
    }))).toEqual(["✗ Reconnecting..."]);

    expect(adapter.renderOutputLine(JSON.stringify({
      type: "exec.command.started",
      command: "git status",
    }))).toEqual(["→ Bash $ git status"]);
  });
});

describe("readLogTail with codex metadata", () => {
  test("uses the codex adapter for human-readable output", () => {
    const tmp = createTempDir();
    try {
      const logFile = `${tmp.path}/.critter-output-review.json`;
      const metaFile = `${tmp.path}/.critter-meta-review.json`;

      writeFileSync(metaFile, JSON.stringify({ cli: "codex" }));
      writeFileSync(logFile, [
        JSON.stringify({ type: "error", message: "Retrying network call" }),
        JSON.stringify({ type: "exec.command.started", command: "gh pr diff 42" }),
      ].join("\n"));

      const output = readLogTail(logFile, 10);
      expect(output).toContain("✗ Retrying network call");
      expect(output).toContain("→ Bash $ gh pr diff 42");
    } finally {
      tmp.cleanup();
    }
  });
});
