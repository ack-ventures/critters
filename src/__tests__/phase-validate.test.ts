import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { validatePhaseResult } from "../runner/validate.js";
import type { SpawnResult } from "../types.js";
import { createTempDir } from "./helpers.js";

let tempDir: string;
let cleanup: () => void;

beforeEach(() => {
  const tmp = createTempDir();
  tempDir = tmp.path;
  cleanup = tmp.cleanup;
});

afterEach(() => {
  cleanup();
});

function makeResult(overrides: Partial<SpawnResult> = {}): SpawnResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    ...overrides,
  };
}

function writeLog(name: string, content: string): string {
  const path = join(tempDir, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

describe("validatePhaseResult", () => {
  test("does not throw on success", () => {
    expect(() => validatePhaseResult(makeResult(), "planning")).not.toThrow();
  });

  test("throws timeout error when timedOut", () => {
    expect(() => validatePhaseResult(makeResult({ timedOut: true }), "execution")).toThrow(
      "Timed out during execution phase",
    );
  });

  test("uses stderr tail when stderr present and no output log", () => {
    const stderr = "line1\nline2\nError: boom\n";
    try {
      validatePhaseResult(makeResult({ exitCode: 1, stderr }), "planning");
      throw new Error("expected throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("Planning failed (exit 1)");
      expect(msg).toContain("Error: boom");
    }
  });

  test("prefers stderr even when outputLogPath is set (regression guard)", () => {
    const logPath = writeLog(
      ".critter-output-planning.json",
      `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "from-log" }] } })}\n`,
    );
    const stderr = "real stderr problem\n";
    try {
      validatePhaseResult(makeResult({ exitCode: 2, stderr, outputLogPath: logPath }), "planning");
      throw new Error("expected throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("real stderr problem");
      expect(msg).not.toContain("from-log");
    }
  });

  test("extracts assistant text from stream-json log when stderr is empty", () => {
    const logPath = writeLog(
      ".critter-output-planning.json",
      [
        JSON.stringify({ type: "system", session_id: "s1" }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "helpful diagnostic message" }] },
        }),
      ].join("\n") + "\n",
    );
    try {
      validatePhaseResult(makeResult({ exitCode: 1, outputLogPath: logPath }), "planning");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).message).toContain("helpful diagnostic message");
    }
  });

  test("extracts is_error tool_result from stream-json log with ✗ marker", () => {
    const logPath = writeLog(
      ".critter-output-planning.json",
      [
        JSON.stringify({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                is_error: true,
                content: "permission denied on /etc/passwd",
              },
            ],
          },
        }),
      ].join("\n") + "\n",
    );
    try {
      validatePhaseResult(makeResult({ exitCode: 1, outputLogPath: logPath }), "execution");
      throw new Error("expected throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("\u2717");
      expect(msg).toContain("permission denied on /etc/passwd");
    }
  });

  test("falls back to raw tail when log content is not stream-json", () => {
    const raw = Array.from({ length: 5 }, (_, i) => `plain line ${i + 1}`).join("\n");
    const logPath = writeLog(".critter-output-planning.json", `${raw}\n`);
    try {
      validatePhaseResult(makeResult({ exitCode: 1, outputLogPath: logPath }), "planning");
      throw new Error("expected throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("plain line 5");
      expect(msg).toContain("plain line 1");
    }
  });

  test("reports no-stderr-or-log when outputLogPath is missing", () => {
    try {
      validatePhaseResult(
        makeResult({ exitCode: 1, outputLogPath: join(tempDir, "does-not-exist.json") }),
        "planning",
      );
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).message).toContain("(no stderr or output log available)");
    }
  });

  test("clips large log tail to ~2KB with truncation marker", () => {
    const bigLine = "x".repeat(500);
    const many = Array.from({ length: 200 }, () => bigLine).join("\n");
    const logPath = writeLog(".critter-output-planning.json", `${many}\n`);
    try {
      validatePhaseResult(makeResult({ exitCode: 1, outputLogPath: logPath }), "planning");
      throw new Error("expected throw");
    } catch (err) {
      const msg = (err as Error).message;
      const [, ...rest] = msg.split("\n");
      const body = rest.join("\n");
      const bodyBytes = Buffer.byteLength(body, "utf-8");
      expect(bodyBytes).toBeLessThanOrEqual(2048 + 4);
      expect(body.startsWith("\u2026")).toBe(true);
    }
  });

  test("treats whitespace-only stderr as empty and uses log", () => {
    const logPath = writeLog(
      ".critter-output-planning.json",
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "diag-from-log" }] },
      })}\n`,
    );
    try {
      validatePhaseResult(
        makeResult({ exitCode: 1, stderr: "\n\n   \n", outputLogPath: logPath }),
        "planning",
      );
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).message).toContain("diag-from-log");
    }
  });
});
