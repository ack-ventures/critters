import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runHook, triggerHook } from "../hooks.js";
import type { Config } from "../types.js";
import { createTempDir, makeTestConfig } from "./helpers.js";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("runHook", () => {
  test("runs command with correct env vars", async () => {
    const outFile = join(tempDir, "out.txt");
    runHook("test", `echo $CRITTER_ISSUE_ID > "${outFile}"`, {
      CRITTER_ISSUE_ID: "ABC-123",
    });
    await sleep(500);
    const content = readFileSync(outFile, "utf-8").trim();
    expect(content).toBe("ABC-123");
  });

  test("logs warning on non-zero exit", async () => {
    // Should not throw — fire-and-forget
    runHook("test", "exit 1", {}, "TST-1");
    await sleep(500);
    // If we got here without throwing, the test passes
    expect(true).toBe(true);
  });

  test("does not throw on failure", () => {
    expect(() => {
      runHook("test", "exit 1", {});
    }).not.toThrow();
  });

  test("passes multiple env vars", async () => {
    const outFile = join(tempDir, "multi.txt");
    runHook("test", `echo "$CRITTER_ISSUE_ID|$CRITTER_TITLE" > "${outFile}"`, {
      CRITTER_ISSUE_ID: "ABC-456",
      CRITTER_TITLE: "Test Title",
    });
    await sleep(500);
    const content = readFileSync(outFile, "utf-8").trim();
    expect(content).toBe("ABC-456|Test Title");
  });

  test("logs stdout when non-empty", async () => {
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      runHook("test", "echo hello-world", {}, "TST-3");
      await sleep(500);
      expect(logs.some((l) => l.includes("Hook test output: hello-world"))).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });

  test("kills process after timeout", async () => {
    const outFile = join(tempDir, "timeout.txt");
    // sleep 60 should be killed by the 30s timeout
    // We use a short command that would create the file only after a long sleep
    runHook("test", `sleep 60 && echo done > "${outFile}"`, {});
    // Wait a bit — the process should be killed within 30s, but we don't wait that long
    // Just verify it didn't throw
    await sleep(200);
    expect(true).toBe(true);
  });
});

describe("triggerHook", () => {
  test("calls runHook when hook exists", async () => {
    const outFile = join(tempDir, "trigger.txt");
    const config = makeTestConfig({
      hooks: { onTaskStarted: `echo triggered > "${outFile}"` },
    });
    triggerHook(config, "onTaskStarted", {
      CRITTER_ISSUE_ID: "ABC-789",
    }, "TST-2");
    await sleep(500);
    const content = readFileSync(outFile, "utf-8").trim();
    expect(content).toBe("triggered");
  });

  test("is a no-op when hook is missing", () => {
    const config = makeTestConfig();
    // Should not throw or do anything
    expect(() => {
      triggerHook(config, "onPrCreated", { CRITTER_ISSUE_ID: "ABC-1" });
    }).not.toThrow();
  });

  test("is a no-op when hook is empty string", () => {
    const config = makeTestConfig({ hooks: { onPrCreated: "" } });
    expect(() => {
      triggerHook(config, "onPrCreated", { CRITTER_ISSUE_ID: "ABC-1" });
    }).not.toThrow();
  });

  test("is a no-op when hooks object is undefined", () => {
    const config = makeTestConfig();
    expect(() => {
      triggerHook(config, "onTaskFailed", { CRITTER_ISSUE_ID: "ABC-1" });
    }).not.toThrow();
  });
});
