import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Capture log output
const logCalls: string[] = [];

mock.module("../logger.js", () => ({
  log: (...args: unknown[]) => logCalls.push(args.join(" ")),
  logError: (...args: unknown[]) => logCalls.push(args.join(" ")),
}));

const { startAutoUpdater } = await import("../auto-updater.js");

let originalExecPath: string;

beforeEach(() => {
  logCalls.length = 0;
  originalExecPath = process.execPath;
});

afterEach(() => {
  Object.defineProperty(process, "execPath", { value: originalExecPath, writable: true });
});

function makeMockSpawner(activeCount = 0) {
  return { getActiveCount: () => activeCount } as { getActiveCount(): number };
}

function makeMockSlack(configured = true) {
  const notifications: string[] = [];
  return {
    isConfigured: configured,
    notify: async (_id: string, msg: string) => { notifications.push(msg); },
    notifications,
  };
}

// Use _version param to bypass the VERSION === "dev" guard in tests
const TEST_VERSION = "1.0.0";

describe("startAutoUpdater", () => {
  test("returns null when running via bun (not compiled binary)", () => {
    Object.defineProperty(process, "execPath", { value: "/usr/local/bin/bun", writable: true });
    const handle = startAutoUpdater(
      { autoUpdate: { enabled: true, intervalMinutes: 1 } } as any,
      makeMockSpawner() as any,
      makeMockSlack() as any,
      () => {},
      TEST_VERSION,
    );
    expect(handle).toBeNull();
    expect(logCalls.some((l) => l.includes("not running as compiled binary"))).toBe(true);
  });

  test("returns null for dev build", () => {
    Object.defineProperty(process, "execPath", { value: "/usr/local/bin/critters", writable: true });
    const handle = startAutoUpdater(
      { autoUpdate: { enabled: true, intervalMinutes: 1 } } as any,
      makeMockSpawner() as any,
      makeMockSlack() as any,
      () => {},
      "dev",
    );
    expect(handle).toBeNull();
    expect(logCalls.some((l) => l.includes("disabled (dev build)"))).toBe(true);
  });

  test("returns null when enabled is false", () => {
    Object.defineProperty(process, "execPath", { value: "/usr/local/bin/critters", writable: true });
    const handle = startAutoUpdater(
      { autoUpdate: { enabled: false, intervalMinutes: 1440 } } as any,
      makeMockSpawner() as any,
      makeMockSlack() as any,
      () => {},
      TEST_VERSION,
    );
    expect(handle).toBeNull();
    expect(logCalls.some((l) => l.includes("disabled by config"))).toBe(true);
  });

  test("starts interval when enabled with compiled binary", () => {
    Object.defineProperty(process, "execPath", { value: "/usr/local/bin/critters", writable: true });
    const handle = startAutoUpdater(
      { autoUpdate: { enabled: true, intervalMinutes: 60 } } as any,
      makeMockSpawner() as any,
      makeMockSlack() as any,
      () => {},
      TEST_VERSION,
    );
    expect(handle).not.toBeNull();
    expect(logCalls.some((l) => l.includes("checking every 60 minutes"))).toBe(true);
    handle?.stop();
  });

  test("uses defaults when autoUpdate config is omitted", () => {
    Object.defineProperty(process, "execPath", { value: "/usr/local/bin/critters", writable: true });
    const handle = startAutoUpdater(
      {} as any,
      makeMockSpawner() as any,
      makeMockSlack() as any,
      () => {},
      TEST_VERSION,
    );
    expect(handle).not.toBeNull();
    expect(logCalls.some((l) => l.includes("checking every 1440 minutes"))).toBe(true);
    handle?.stop();
  });

  test("updateConfig disables when enabled set to false", () => {
    Object.defineProperty(process, "execPath", { value: "/usr/local/bin/critters", writable: true });
    const handle = startAutoUpdater(
      { autoUpdate: { enabled: true, intervalMinutes: 60 } } as any,
      makeMockSpawner() as any,
      makeMockSlack() as any,
      () => {},
      TEST_VERSION,
    );
    expect(handle).not.toBeNull();
    handle?.updateConfig({ autoUpdate: { enabled: false, intervalMinutes: 60 } } as any);
    expect(logCalls.some((l) => l.includes("disabled by config reload"))).toBe(true);
    handle?.stop();
  });

  test("updateConfig changes interval", () => {
    Object.defineProperty(process, "execPath", { value: "/usr/local/bin/critters", writable: true });
    const handle = startAutoUpdater(
      { autoUpdate: { enabled: true, intervalMinutes: 60 } } as any,
      makeMockSpawner() as any,
      makeMockSlack() as any,
      () => {},
      TEST_VERSION,
    );
    expect(handle).not.toBeNull();
    handle?.updateConfig({ autoUpdate: { enabled: true, intervalMinutes: 120 } } as any);
    expect(logCalls.some((l) => l.includes("interval changed to 120 minutes"))).toBe(true);
    handle?.stop();
  });
});
