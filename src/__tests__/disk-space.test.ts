import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("checkDiskSpace", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "critters-disk-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    mock.restore();
  });

  test("passes when space is sufficient", () => {
    // Real filesystem should have more than 1MB available
    const { checkDiskSpace } = require("../git.js");
    expect(() => checkDiskSpace(tempDir, 1)).not.toThrow();
  });

  test("throws when space is insufficient", async () => {
    // Mock statfsSync to return low values
    const originalFs = await import("node:fs");
    mock.module("node:fs", () => ({
      ...originalFs,
      statfsSync: () => ({ bsize: 4096, bavail: 128 }), // ~0.5MB
    }));

    // Re-import to get mocked version
    const { checkDiskSpace } = require("../git.js");
    expect(() => checkDiskSpace(tempDir, 1024)).toThrow(
      /Insufficient disk space: 0MB available, 1024MB required/
    );
  });

  test("error message includes path", async () => {
    const originalFs = await import("node:fs");
    mock.module("node:fs", () => ({
      ...originalFs,
      statfsSync: () => ({ bsize: 4096, bavail: 128000 }), // ~500MB
    }));

    const { checkDiskSpace } = require("../git.js");
    try {
      checkDiskSpace(tempDir, 1024);
      throw new Error("Should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("500MB available");
      expect(msg).toContain("1024MB required");
      expect(msg).toContain(tempDir);
    }
  });

  test("shallowClone throws before cloning when space is low", async () => {
    const originalFs = await import("node:fs");
    let runCommandCalled = false;

    mock.module("node:fs", () => ({
      ...originalFs,
      statfsSync: () => ({ bsize: 4096, bavail: 128 }), // ~0.5MB
    }));

    mock.module("../utils.js", () => ({
      runCommand: async () => {
        runCommandCalled = true;
        return { code: 0, stdout: "", stderr: "" };
      },
    }));

    const { shallowClone } = require("../git.js");
    await expect(
      shallowClone("git@github.com:org/repo.git", "/tmp/test-target", "TEST-1", tempDir, 1, undefined, 1024)
    ).rejects.toThrow(/Insufficient disk space/);

    expect(runCommandCalled).toBe(false);
  });
});
