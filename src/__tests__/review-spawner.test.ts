import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { parseReviewOutcome } from "../review-spawner.js";
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

describe("parseReviewOutcome", () => {
  test("parses REVIEW_RESULT:MERGED from stream-json log", () => {
    const logFile = `${tempDir}/output.json`;
    writeFileSync(logFile, [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Looking good!" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "REVIEW_RESULT:MERGED" }] } }),
    ].join("\n"));

    const outcome = parseReviewOutcome(logFile);
    expect(outcome.decision).toBe("merged");
  });

  test("parses REVIEW_RESULT:NEEDS_CHANGES with reason", () => {
    const logFile = `${tempDir}/output.json`;
    writeFileSync(logFile, [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "REVIEW_RESULT:NEEDS_CHANGES:Missing error handling in API call" }] } }),
    ].join("\n"));

    const outcome = parseReviewOutcome(logFile);
    expect(outcome.decision).toBe("needs_changes");
    expect(outcome.reason).toBe("Missing error handling in API call");
  });

  test("returns unknown when no sentinel found", () => {
    const logFile = `${tempDir}/output.json`;
    writeFileSync(logFile, [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Some review text" }] } }),
    ].join("\n"));

    const outcome = parseReviewOutcome(logFile);
    expect(outcome.decision).toBe("unknown");
  });

  test("returns unknown when log file does not exist", () => {
    const outcome = parseReviewOutcome(`${tempDir}/nonexistent.json`);
    expect(outcome.decision).toBe("unknown");
  });

  test("handles malformed JSON lines gracefully", () => {
    const logFile = `${tempDir}/output.json`;
    writeFileSync(logFile, [
      "not valid json",
      "{ broken",
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "REVIEW_RESULT:MERGED" }] } }),
    ].join("\n"));

    const outcome = parseReviewOutcome(logFile);
    expect(outcome.decision).toBe("merged");
  });

  test("parses sentinel from result type message", () => {
    const logFile = `${tempDir}/output.json`;
    writeFileSync(logFile, [
      JSON.stringify({ type: "result", result: "Done. REVIEW_RESULT:NEEDS_CHANGES:CI checks failed" }),
    ].join("\n"));

    const outcome = parseReviewOutcome(logFile);
    expect(outcome.decision).toBe("needs_changes");
    expect(outcome.reason).toBe("CI checks failed");
  });

  test("parses sentinel from string content", () => {
    const logFile = `${tempDir}/output.json`;
    writeFileSync(logFile, [
      JSON.stringify({ type: "assistant", message: { content: "All good. REVIEW_RESULT:MERGED" } }),
    ].join("\n"));

    const outcome = parseReviewOutcome(logFile);
    expect(outcome.decision).toBe("merged");
  });
});
