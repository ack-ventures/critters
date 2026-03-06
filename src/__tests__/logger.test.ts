import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatJsonLogEntry, initFileLogging, resetFileLogging, rotateFileIfNeeded } from "../logger.js";
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

describe("formatJsonLogEntry", () => {
  test("info level with plain message", () => {
    const line = formatJsonLogEntry("", "hello world", []);
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("hello world");
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.identifier).toBeUndefined();
  });

  test("error level from ERROR prefix", () => {
    const line = formatJsonLogEntry("ERROR: ", "something failed", []);
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("error");
    expect(parsed.message).toBe("something failed");
  });

  test("task identifier extracted from level prefix", () => {
    const line = formatJsonLogEntry("[ACK-1] ", "doing work", []);
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("doing work");
    expect(parsed.identifier).toBe("ACK-1");
  });

  test("task warn level with identifier", () => {
    const line = formatJsonLogEntry("[ACK-2] WARN: ", "something odd", []);
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("warn");
    expect(parsed.message).toBe("something odd");
    expect(parsed.identifier).toBe("ACK-2");
  });

  test("task error level with identifier", () => {
    const line = formatJsonLogEntry("[ACK-3] ERROR: ", "task broke", []);
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("error");
    expect(parsed.message).toBe("task broke");
    expect(parsed.identifier).toBe("ACK-3");
  });

  test("extra args joined into message", () => {
    const line = formatJsonLogEntry("", "count:", [42, "items"]);
    const parsed = JSON.parse(line);
    expect(parsed.message).toBe("count: 42 items");
  });

  test("output ends with newline for JSONL compatibility", () => {
    const line = formatJsonLogEntry("", "test", []);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trim()).not.toBe("");
  });
});
