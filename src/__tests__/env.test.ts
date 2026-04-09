import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempDir } from "./helpers.js";

let tempDir: string;
let cleanup: () => void;
let homeDir: string;
let cwdDir: string;
let originalCwd: string;

// Mock node:os homedir() before importing env.ts
let fakeHome = "";
mock.module("node:os", () => ({
  homedir: () => fakeHome,
}));

// Must import after mock.module
const { loadEnvFallback } = await import("../env.js");

// Track env vars we touch so we can restore them
const envKeysToClean: string[] = [];

function cleanEnvKey(key: string): void {
  envKeysToClean.push(key);
  delete process.env[key];
}

beforeEach(() => {
  const tmp = createTempDir();
  tempDir = tmp.path;
  cleanup = tmp.cleanup;

  homeDir = join(tempDir, "home");
  cwdDir = join(tempDir, "cwd");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(cwdDir, { recursive: true });
  mkdirSync(join(homeDir, ".critters"), { recursive: true });

  fakeHome = homeDir;
  originalCwd = process.cwd();
  process.chdir(cwdDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const key of envKeysToClean) {
    delete process.env[key];
  }
  envKeysToClean.length = 0;
  cleanup();
});

describe("loadEnvFallback", () => {
  test("loads vars from ~/.critters/.env when CWD .env doesn't exist", () => {
    writeFileSync(join(homeDir, ".critters", ".env"), "FOO_TEST_VAR=bar\n");
    cleanEnvKey("FOO_TEST_VAR");

    loadEnvFallback();

    expect(process.env.FOO_TEST_VAR).toBe("bar");
  });

  test("does NOT load fallback when CWD .env exists", () => {
    writeFileSync(join(cwdDir, ".env"), "CWD_VAR=local\n");
    writeFileSync(join(homeDir, ".critters", ".env"), "CWD_VAR=fallback\n");
    cleanEnvKey("CWD_VAR");

    loadEnvFallback();

    expect(process.env.CWD_VAR).toBeUndefined();
  });

  test("skips blank lines and comments", () => {
    writeFileSync(
      join(homeDir, ".critters", ".env"),
      "# this is a comment\n\nVALID_KEY=value\n\n# another comment\n",
    );
    cleanEnvKey("VALID_KEY");

    loadEnvFallback();

    expect(process.env.VALID_KEY).toBe("value");
  });

  test("skips lines without =", () => {
    writeFileSync(
      join(homeDir, ".critters", ".env"),
      "GOOD_KEY=good_value\nBADLINE_NO_EQUALS\nANOTHER_GOOD=works\n",
    );
    cleanEnvKey("GOOD_KEY");
    cleanEnvKey("BADLINE_NO_EQUALS");
    cleanEnvKey("ANOTHER_GOOD");

    loadEnvFallback();

    expect(process.env.GOOD_KEY).toBe("good_value");
    expect(process.env.ANOTHER_GOOD).toBe("works");
    expect(process.env.BADLINE_NO_EQUALS).toBeUndefined();
  });

  test("does NOT overwrite vars already in process.env", () => {
    writeFileSync(
      join(homeDir, ".critters", ".env"),
      "EXISTING_VAR=from_fallback\n",
    );
    process.env.EXISTING_VAR = "original";
    envKeysToClean.push("EXISTING_VAR");

    loadEnvFallback();

    expect(process.env.EXISTING_VAR).toBe("original");
  });
});
