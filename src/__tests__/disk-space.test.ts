import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as git from "../git.js";

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
    expect(() => git.checkDiskSpace(tempDir, 1)).not.toThrow();
  });

  test("throws when space is insufficient", () => {
    spyOn(git, "getAvailableSpaceMb").mockReturnValue(0);
    expect(() => git.checkDiskSpace(tempDir, 1024)).toThrow(
      /Insufficient disk space: 0MB available, 1024MB required/
    );
  });

  test("error message includes path", () => {
    spyOn(git, "getAvailableSpaceMb").mockReturnValue(500);
    try {
      git.checkDiskSpace(tempDir, 1024);
      throw new Error("Should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("500MB available");
      expect(msg).toContain("1024MB required");
      expect(msg).toContain(tempDir);
    }
  });

  test("shallowClone throws before cloning when space is low", async () => {
    spyOn(git, "getAvailableSpaceMb").mockReturnValue(0);

    await expect(
      git.shallowClone("git@github.com:org/repo.git", "/tmp/test-target", "TEST-1", tempDir, 1, undefined, 1024)
    ).rejects.toThrow(/Insufficient disk space/);
  });
});
