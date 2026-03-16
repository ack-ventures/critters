import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { MetricEvent } from "../metrics.js";

// 1. Set up mock BEFORE importing the module under test
const mockReadAllMetrics = mock<() => MetricEvent[]>(() => []);
mock.module("../metrics.js", () => ({
  readAllMetrics: mockReadAllMetrics,
}));

// 2. Dynamic import AFTER mock is registered
const { runHistory, parseArgs } = await import("../cli-history.js");

const mockMetrics: MetricEvent[] = [
  { timestamp: "2026-03-15T10:00:00Z", event: "task_completed", identifier: "ACK-100", critterType: "create", duration: 60000 },
  { timestamp: "2026-03-15T11:00:00Z", event: "task_failed", identifier: "ACK-101", critterType: "create", duration: 30000 },
  { timestamp: "2026-03-15T12:00:00Z", event: "review_completed", identifier: "ACK-102", critterType: "review", duration: 15000 },
  { timestamp: "2026-03-15T13:00:00Z", event: "review_failed", identifier: "ACK-103", critterType: "review", duration: 20000 },
  { timestamp: "2026-03-15T14:00:00Z", event: "task_started", identifier: "ACK-104", critterType: "create" }, // filtered out (not a completion event)
  { timestamp: "2026-03-15T15:00:00Z", event: "task_completed", identifier: "ACK-105", duration: 45000 }, // no critterType
];

const processExitSpy = spyOn(process, "exit").mockImplementation(() => {
  throw new Error("process.exit called");
});
const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});

beforeEach(() => {
  mockReadAllMetrics.mockReset();
  mockReadAllMetrics.mockReturnValue([]);
  processExitSpy.mockClear();
  consoleErrorSpy.mockClear();
  consoleLogSpy.mockClear();
});

describe("parseArgs", () => {
  test("default values", () => {
    expect(parseArgs([])).toEqual({ last: 20, failed: false, type: null, json: false });
  });

  test("--type review", () => {
    expect(parseArgs(["--type", "review"])).toEqual({ last: 20, failed: false, type: "review", json: false });
  });

  test("--type without a value exits with error", () => {
    expect(() => parseArgs(["--type"])).toThrow("process.exit called");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Missing value for --type"),
    );
  });

  test("combination --type create --failed --last 5 --json", () => {
    expect(parseArgs(["--type", "create", "--failed", "--last", "5", "--json"])).toEqual({
      last: 5,
      failed: true,
      type: "create",
      json: true,
    });
  });
});

describe("runHistory", () => {
  test("no --type shows all completion events", async () => {
    mockReadAllMetrics.mockReturnValue([...mockMetrics]);

    await runHistory([]);

    // Should show 5 completion events (excludes task_started ACK-104)
    // Check that log was called with table rows
    const calls = consoleLogSpy.mock.calls;
    // Header + 5 data rows
    expect(calls.length).toBe(6);
  });

  test("--type create shows only create events", async () => {
    mockReadAllMetrics.mockReturnValue([...mockMetrics]);

    await runHistory(["--type", "create"]);

    const calls = consoleLogSpy.mock.calls;
    // Header + 2 data rows (ACK-100 completed, ACK-101 failed)
    expect(calls.length).toBe(3);
    // Verify ACK-100 and ACK-101 appear
    const output = calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("ACK-100");
    expect(output).toContain("ACK-101");
    expect(output).not.toContain("ACK-102");
    expect(output).not.toContain("ACK-105");
  });

  test("--type review shows only review events", async () => {
    mockReadAllMetrics.mockReturnValue([...mockMetrics]);

    await runHistory(["--type", "review"]);

    const calls = consoleLogSpy.mock.calls;
    // Header + 2 data rows (ACK-102, ACK-103)
    expect(calls.length).toBe(3);
    const output = calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("ACK-102");
    expect(output).toContain("ACK-103");
  });

  test("--type nonexistent prints no matching runs", async () => {
    mockReadAllMetrics.mockReturnValue([...mockMetrics]);

    await runHistory(["--type", "nonexistent"]);

    expect(consoleLogSpy).toHaveBeenCalledWith("No matching runs found.");
  });

  test("--type create --failed shows only failed create events", async () => {
    mockReadAllMetrics.mockReturnValue([...mockMetrics]);

    await runHistory(["--type", "create", "--failed"]);

    const calls = consoleLogSpy.mock.calls;
    // Header + 1 data row (ACK-101 failed)
    expect(calls.length).toBe(2);
    const output = calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("ACK-101");
    expect(output).not.toContain("ACK-100");
  });

  test("--type create --json outputs only create events as JSON", async () => {
    mockReadAllMetrics.mockReturnValue([...mockMetrics]);

    await runHistory(["--type", "create", "--json"]);

    const calls = consoleLogSpy.mock.calls;
    expect(calls.length).toBe(1);
    const parsed = JSON.parse(calls[0][0]);
    expect(parsed).toHaveLength(2);
    for (const entry of parsed) {
      expect(entry.type).toBe("create");
    }
  });

  test("--type create filters out metrics with undefined critterType", async () => {
    mockReadAllMetrics.mockReturnValue([...mockMetrics]);

    await runHistory(["--type", "create"]);

    const calls = consoleLogSpy.mock.calls;
    const output = calls.map((c: unknown[]) => c[0]).join("\n");
    // ACK-105 has no critterType — should not appear in --type create results
    expect(output).not.toContain("ACK-105");
  });
});
