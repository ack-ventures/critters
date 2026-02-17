import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initFileLogging, resetFileLogging, rotateFileIfNeeded } from "../logger.js";
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

describe("rotateFileIfNeeded", () => {
  test("no rotation when file is under limit", () => {
    const filePath = join(tempDir, "test.log");
    writeFileSync(filePath, "small content");

    rotateFileIfNeeded(filePath, 1, 3);

    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(`${filePath}.1`)).toBe(false);
    expect(readFileSync(filePath, "utf-8")).toBe("small content");
  });

  test("rotates when file exceeds limit", () => {
    const filePath = join(tempDir, "test.log");
    const content = "x".repeat(1.5 * 1024 * 1024); // 1.5 MB
    writeFileSync(filePath, content);

    rotateFileIfNeeded(filePath, 1, 3);

    expect(existsSync(filePath)).toBe(false);
    expect(existsSync(`${filePath}.1`)).toBe(true);
    expect(readFileSync(`${filePath}.1`, "utf-8")).toBe(content);
  });

  test("cascading rotation", () => {
    const filePath = join(tempDir, "test.log");
    const mainContent = "x".repeat(1.5 * 1024 * 1024);
    const file1Content = "content-of-1";
    const file2Content = "content-of-2";

    writeFileSync(filePath, mainContent);
    writeFileSync(`${filePath}.1`, file1Content);
    writeFileSync(`${filePath}.2`, file2Content);

    rotateFileIfNeeded(filePath, 1, 3);

    expect(existsSync(filePath)).toBe(false);
    expect(readFileSync(`${filePath}.1`, "utf-8")).toBe(mainContent);
    expect(readFileSync(`${filePath}.2`, "utf-8")).toBe(file1Content);
    expect(readFileSync(`${filePath}.3`, "utf-8")).toBe(file2Content);
  });

  test("oldest file deleted when at max", () => {
    const filePath = join(tempDir, "test.log");
    const mainContent = "x".repeat(1.5 * 1024 * 1024);
    const file1Content = "content-of-1";
    const file2Content = "content-of-2";
    const file3Content = "content-of-3";

    writeFileSync(filePath, mainContent);
    writeFileSync(`${filePath}.1`, file1Content);
    writeFileSync(`${filePath}.2`, file2Content);
    writeFileSync(`${filePath}.3`, file3Content);

    rotateFileIfNeeded(filePath, 1, 3);

    expect(existsSync(filePath)).toBe(false);
    expect(readFileSync(`${filePath}.1`, "utf-8")).toBe(mainContent);
    expect(readFileSync(`${filePath}.2`, "utf-8")).toBe(file1Content);
    expect(readFileSync(`${filePath}.3`, "utf-8")).toBe(file2Content);
    // old .3 (file3Content) is gone
  });

  test("no crash on non-existent file path", () => {
    const filePath = join(tempDir, "nonexistent.log");
    // Should not throw
    rotateFileIfNeeded(filePath, 1, 3);
  });

  test("no rotation when file does not exist", () => {
    const filePath = join(tempDir, "nonexistent.log");
    rotateFileIfNeeded(filePath, 1, 3);
    expect(existsSync(`${filePath}.1`)).toBe(false);
  });
});

describe("initFileLogging", () => {
  afterEach(() => {
    resetFileLogging();
  });

  test("triggers rotation on oversized log file", () => {
    const logPath = join(tempDir, "critters.log");
    const content = "x".repeat(1.5 * 1024 * 1024);
    writeFileSync(logPath, content);

    initFileLogging(1, tempDir);

    expect(existsSync(`${logPath}.1`)).toBe(true);
    expect(readFileSync(`${logPath}.1`, "utf-8")).toBe(content);
  });
});
