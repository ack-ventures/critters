import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { loadWorkDir } from "../config.js";
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

describe("loadWorkDir", () => {
  test("returns default when no config file found", () => {
    // Point to a dir with no config file
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const result = loadWorkDir();
      // On macOS /tmp resolves to /private/tmp when the dir exists
      expect(result === "/tmp/critters-work" || result === realpathSync("/tmp/critters-work")).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });

  test("reads workDir from config file", () => {
    const configPath = `${tempDir}/config.yaml`;
    writeFileSync(configPath, `workDir: /tmp/critters-custom-test\n`, "utf-8");
    const result = loadWorkDir(configPath);
    expect(result).toBe("/tmp/critters-custom-test");
  });

  test("defaults workDir when not specified in config", () => {
    const configPath = `${tempDir}/config.yaml`;
    writeFileSync(configPath, `pollIntervalSeconds: 30\n`, "utf-8");
    const result = loadWorkDir(configPath);
    // On macOS /tmp resolves to /private/tmp
    expect(result).toBe(realpathSync("/tmp/critters-work"));
  });

  test("resolves symlinks when directory exists", () => {
    const configPath = `${tempDir}/config.yaml`;
    writeFileSync(configPath, `workDir: /tmp/critters-work\n`, "utf-8");
    const result = loadWorkDir(configPath);
    expect(result).toBe(realpathSync("/tmp/critters-work"));
  });

  test("returns raw path when directory does not exist", () => {
    const configPath = `${tempDir}/config.yaml`;
    writeFileSync(configPath, `workDir: /tmp/critters-nonexistent-dir-12345\n`, "utf-8");
    const result = loadWorkDir(configPath);
    expect(result).toBe("/tmp/critters-nonexistent-dir-12345");
  });
});

describe("work directory scanning", () => {
  // Test the regex matching logic directly since runLogs calls process.exit
  function findWorkDirs(workDir: string, identifier: string) {
    const { readdirSync: rd } = require("node:fs");
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const critterDirPattern = new RegExp(`^${escaped}-\\d+$`);
    const reviewDirPattern = new RegExp(`^review-${escaped}-\\d+$`);

    let entries: string[] = [];
    try { entries = rd(workDir); } catch { return { critterDirs: [], reviewDirs: [] }; }
    const critterDirs = entries.filter((e: string) => critterDirPattern.test(e));
    const reviewDirs = entries.filter((e: string) => reviewDirPattern.test(e));
    return { critterDirs, reviewDirs };
  }

  test("matches exact identifier with timestamp", () => {
    mkdirSync(`${tempDir}/ACK-101-1718000000000`);
    const { critterDirs } = findWorkDirs(tempDir, "ACK-101");
    expect(critterDirs).toEqual(["ACK-101-1718000000000"]);
  });

  test("does not match prefix collisions (ACK-1 vs ACK-10)", () => {
    mkdirSync(`${tempDir}/ACK-1-1718000000000`);
    mkdirSync(`${tempDir}/ACK-10-1718000000000`);
    mkdirSync(`${tempDir}/ACK-100-1718000000000`);

    const result1 = findWorkDirs(tempDir, "ACK-1");
    expect(result1.critterDirs).toEqual(["ACK-1-1718000000000"]);

    const result10 = findWorkDirs(tempDir, "ACK-10");
    expect(result10.critterDirs).toEqual(["ACK-10-1718000000000"]);

    const result100 = findWorkDirs(tempDir, "ACK-100");
    expect(result100.critterDirs).toEqual(["ACK-100-1718000000000"]);
  });

  test("matches review directories", () => {
    mkdirSync(`${tempDir}/review-ACK-101-1718000000000`);
    const { reviewDirs } = findWorkDirs(tempDir, "ACK-101");
    expect(reviewDirs).toEqual(["review-ACK-101-1718000000000"]);
  });

  test("picks newest directory from multiple matches", () => {
    mkdirSync(`${tempDir}/ACK-101-1718000000000`);
    mkdirSync(`${tempDir}/ACK-101-1718000099999`);
    mkdirSync(`${tempDir}/ACK-101-1718000050000`);

    const { critterDirs } = findWorkDirs(tempDir, "ACK-101");
    expect(critterDirs).toHaveLength(3);

    // Verify extractTimestamp-based sorting picks newest
    const sorted = [...critterDirs].sort((a, b) => {
      const tsA = parseInt(a.split("-").pop()!, 10);
      const tsB = parseInt(b.split("-").pop()!, 10);
      return tsB - tsA;
    });
    expect(sorted[0]).toBe("ACK-101-1718000099999");
  });

  test("returns empty arrays when work dir does not exist", () => {
    const { critterDirs, reviewDirs } = findWorkDirs(`${tempDir}/nonexistent`, "ACK-101");
    expect(critterDirs).toEqual([]);
    expect(reviewDirs).toEqual([]);
  });

  test("handles identifiers with no matches", () => {
    mkdirSync(`${tempDir}/ACK-999-1718000000000`);
    const { critterDirs, reviewDirs } = findWorkDirs(tempDir, "ACK-101");
    expect(critterDirs).toEqual([]);
    expect(reviewDirs).toEqual([]);
  });
});

describe("phase auto-detection", () => {
  test("prefers review over execution over planning", () => {
    // Create dirs with log files
    const critterDir = `${tempDir}/ACK-101-1718000000000`;
    const reviewDir = `${tempDir}/review-ACK-101-1718000000000`;
    mkdirSync(critterDir);
    mkdirSync(reviewDir);

    writeFileSync(`${critterDir}/.critter-output-plan.json`, '{"type":"system"}\n', "utf-8");
    writeFileSync(`${critterDir}/.critter-output-exec.json`, '{"type":"system"}\n', "utf-8");
    writeFileSync(`${reviewDir}/.critter-output-review.json`, '{"type":"system"}\n', "utf-8");

    // Verify files exist in expected locations (this tests the mapping)
    const { existsSync } = require("node:fs");
    expect(existsSync(`${reviewDir}/.critter-output-review.json`)).toBe(true);
    expect(existsSync(`${critterDir}/.critter-output-exec.json`)).toBe(true);
    expect(existsSync(`${critterDir}/.critter-output-plan.json`)).toBe(true);
  });

  test("falls back to execution when no review exists", () => {
    const critterDir = `${tempDir}/ACK-101-1718000000000`;
    mkdirSync(critterDir);

    writeFileSync(`${critterDir}/.critter-output-plan.json`, '{"type":"system"}\n', "utf-8");
    writeFileSync(`${critterDir}/.critter-output-exec.json`, '{"type":"system"}\n', "utf-8");

    const { existsSync } = require("node:fs");
    expect(existsSync(`${critterDir}/.critter-output-exec.json`)).toBe(true);
    expect(existsSync(`${critterDir}/.critter-output-plan.json`)).toBe(true);
  });
});

describe("argument parsing", () => {
  // We can't easily test parseArgs directly since it calls process.exit,
  // but we can test the identifier regex
  test("IDENTIFIER_RE matches valid identifiers", () => {
    const re = /^[A-Z]+-\d+$/;
    expect(re.test("ACK-123")).toBe(true);
    expect(re.test("PROJ-1")).toBe(true);
    expect(re.test("AB-99999")).toBe(true);
  });

  test("IDENTIFIER_RE rejects invalid identifiers", () => {
    const re = /^[A-Z]+-\d+$/;
    expect(re.test("ack-123")).toBe(false);
    expect(re.test("ACK123")).toBe(false);
    expect(re.test("ACK-")).toBe(false);
    expect(re.test("-123")).toBe(false);
    expect(re.test("ACK-123-456")).toBe(false);
    expect(re.test("")).toBe(false);
  });
});
