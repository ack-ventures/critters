import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Capture log output
const logCalls: string[] = [];
const logErrorCalls: string[] = [];

mock.module("../logger.js", () => ({
  log: (...args: unknown[]) => logCalls.push(args.join(" ")),
  logError: (...args: unknown[]) => logErrorCalls.push(args.join(" ")),
}));

// Re-import after mocking
const { checkForUpdate } = await import("../updater.js");

let tempDir: string;
let fakeBinaryPath: string;
let originalExecPath: string;
const originalFetch = globalThis.fetch;

const ORIGINAL_CONTENT = "original-binary-content";
const UPDATED_CONTENT = "updated-binary-content";

function makeRelease(version: string) {
  return {
    tag_name: `v${version}`,
    assets: [
      {
        name: `critters-${process.platform}-${process.arch}`,
        browser_download_url: "https://example.com/download",
      },
    ],
  };
}

function mockFetchSuccess(releaseVersion: string) {
  globalThis.fetch = mock((url: string) => {
    if (url.includes("api.github.com")) {
      return Promise.resolve(new Response(JSON.stringify(makeRelease(releaseVersion)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }
    // Download URL
    return Promise.resolve(new Response(UPDATED_CONTENT, { status: 200 }));
  }) as unknown as typeof fetch;
}

function mockFetchDownloadFails(releaseVersion: string) {
  globalThis.fetch = mock((url: string) => {
    if (url.includes("api.github.com")) {
      return Promise.resolve(new Response(JSON.stringify(makeRelease(releaseVersion)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }
    // Download fails
    return Promise.reject(new Error("Download failed"));
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "updater-test-"));
  fakeBinaryPath = join(tempDir, "critters");
  writeFileSync(fakeBinaryPath, ORIGINAL_CONTENT);
  originalExecPath = process.execPath;
  Object.defineProperty(process, "execPath", {
    value: fakeBinaryPath,
    writable: true,
    configurable: true,
  });
  logCalls.length = 0;
  logErrorCalls.length = 0;
});

afterEach(() => {
  Object.defineProperty(process, "execPath", {
    value: originalExecPath,
    writable: true,
    configurable: true,
  });
  globalThis.fetch = originalFetch;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("checkForUpdate backup", () => {
  test("creates backup before applying update", async () => {
    mockFetchSuccess("2.0.0");
    await checkForUpdate("1.0.0");

    const backupPath = join(tempDir, "critters-v1.0.0.bak");
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, "utf-8")).toBe(ORIGINAL_CONTENT);

    // The main binary should have the new content
    expect(readFileSync(fakeBinaryPath, "utf-8")).toBe(UPDATED_CONTENT);
  });

  test("overwrites existing backup from prior update", async () => {
    // Pre-existing backup with old content
    const backupPath = join(tempDir, "critters-v1.0.0.bak");
    writeFileSync(backupPath, "old-backup-content");

    mockFetchSuccess("2.0.0");
    await checkForUpdate("1.0.0");

    // Backup should now contain the current binary content, not old backup
    expect(readFileSync(backupPath, "utf-8")).toBe(ORIGINAL_CONTENT);
  });

  test("restores backup on update failure", async () => {
    // Pre-create a backup to simulate a prior successful update.
    // Then trigger a failure that lands in the catch block where restore runs.
    const backupPath = join(tempDir, "critters-v1.0.0.bak");
    writeFileSync(backupPath, ORIGINAL_CONTENT);

    // Corrupt the binary to simulate a partial update gone wrong
    writeFileSync(fakeBinaryPath, "corrupted-content");

    // Mock fetch: version check succeeds but download rejects (throws into catch block).
    // The catch block will find the v1.0.0.bak and restore it.
    mockFetchDownloadFails("2.0.0");
    await checkForUpdate("1.0.0");

    // The restore logic should have copied the backup back over the binary
    expect(readFileSync(fakeBinaryPath, "utf-8")).toBe(ORIGINAL_CONTENT);
    expect(logErrorCalls.some((l) => l.includes("Restored previous binary"))).toBe(true);
  });

  test("skips restore when no backup exists", async () => {
    // Download fails — error occurs before backup step
    mockFetchDownloadFails("2.0.0");
    await checkForUpdate("1.0.0");

    // Original binary should be unchanged (download failed before any FS operations)
    expect(readFileSync(fakeBinaryPath, "utf-8")).toBe(ORIGINAL_CONTENT);

    // No backup should exist
    const backupPath = join(tempDir, "critters-v1.0.0.bak");
    expect(existsSync(backupPath)).toBe(false);

    // Should have logged the error
    expect(logCalls.some((l) => l.includes("Update available"))).toBe(true);
    expect(logErrorCalls.some((l) => l.includes("Update failed"))).toBe(true);
  });

  test("logs backup path", async () => {
    mockFetchSuccess("2.0.0");
    await checkForUpdate("1.0.0");

    const backupPath = join(tempDir, "critters-v1.0.0.bak");
    expect(logCalls.some((l) => l.includes(`Backup saved to ${backupPath}`))).toBe(true);
  });
});
