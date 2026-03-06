import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { loadConfig } from "../config.js";
import { UnifiedSpawner } from "../unified-spawner.js";
import { validateConfigFile } from "../validate.js";
import { createTempDir } from "./helpers.js";

// --- Config parsing tests ---

let tempDir: string;
let cleanup: () => void;
let savedLinearApiKey: string | undefined;

beforeEach(() => {
  const tmp = createTempDir();
  tempDir = tmp.path;
  cleanup = tmp.cleanup;
  savedLinearApiKey = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = "test-key";
});

afterEach(() => {
  cleanup();
  if (savedLinearApiKey !== undefined) {
    process.env.LINEAR_API_KEY = savedLinearApiKey;
  } else {
    delete process.env.LINEAR_API_KEY;
  }
});

function writeYaml(content: string): string {
  const path = `${tempDir}/config.yaml`;
  writeFileSync(path, content, "utf-8");
  return path;
}

const baseYaml = `
defaultAllowedTools:
  - "Read"
  - "Write"
`;

describe("autoRetry config parsing", () => {
  test("autoRetry is undefined when not specified", () => {
    const path = writeYaml(baseYaml);
    const config = loadConfig(path);
    expect(config.autoRetry).toBeUndefined();
  });

  test("autoRetry uses defaults when section is present but empty", () => {
    const path = writeYaml(`${baseYaml}\nautoRetry: {}`);
    const config = loadConfig(path);
    expect(config.autoRetry).toEqual({
      maxRetries: 1,
      baseDelaySeconds: 60,
      maxDelaySeconds: 300,
    });
  });

  test("autoRetry parses custom values", () => {
    const path = writeYaml(`${baseYaml}\nautoRetry:\n  maxRetries: 3\n  baseDelaySeconds: 30\n  maxDelaySeconds: 600`);
    const config = loadConfig(path);
    expect(config.autoRetry).toEqual({
      maxRetries: 3,
      baseDelaySeconds: 30,
      maxDelaySeconds: 600,
    });
  });

  test("validates maxRetries >= 1", () => {
    const path = writeYaml(`${baseYaml}\nautoRetry:\n  maxRetries: 0`);
    expect(() => loadConfig(path)).toThrow("autoRetry.maxRetries must be >= 1");
  });

  test("validates baseDelaySeconds > 0", () => {
    const path = writeYaml(`${baseYaml}\nautoRetry:\n  baseDelaySeconds: 0`);
    expect(() => loadConfig(path)).toThrow("autoRetry.baseDelaySeconds must be > 0");
  });

  test("validates maxDelaySeconds >= baseDelaySeconds", () => {
    const path = writeYaml(`${baseYaml}\nautoRetry:\n  baseDelaySeconds: 120\n  maxDelaySeconds: 30`);
    expect(() => loadConfig(path)).toThrow("autoRetry.maxDelaySeconds must be >= baseDelaySeconds");
  });
});

describe("autoRetry validate.ts", () => {
  test("valid autoRetry passes validation", () => {
    const path = writeYaml(`${baseYaml}\nautoRetry:\n  maxRetries: 2\n  baseDelaySeconds: 30\n  maxDelaySeconds: 300`);
    const result = validateConfigFile(path);
    expect(result.errors).toHaveLength(0);
  });

  test("invalid maxRetries is reported", () => {
    const path = writeYaml(`${baseYaml}\nautoRetry:\n  maxRetries: 0`);
    const result = validateConfigFile(path);
    expect(result.errors.some(e => e.includes("autoRetry.maxRetries"))).toBe(true);
  });

  test("invalid baseDelaySeconds is reported", () => {
    const path = writeYaml(`${baseYaml}\nautoRetry:\n  baseDelaySeconds: -1`);
    const result = validateConfigFile(path);
    expect(result.errors.some(e => e.includes("autoRetry.baseDelaySeconds"))).toBe(true);
  });

  test("invalid maxDelaySeconds is reported", () => {
    const path = writeYaml(`${baseYaml}\nautoRetry:\n  baseDelaySeconds: 120\n  maxDelaySeconds: 30`);
    const result = validateConfigFile(path);
    expect(result.errors.some(e => e.includes("autoRetry.maxDelaySeconds"))).toBe(true);
  });
});

// --- isTransientError tests ---

describe("isTransientError", () => {
  // Access via a minimal spawner instance
  function makeSpawner(): UnifiedSpawner {
    const config = {
      workDir: "/tmp/critters-test",
      critterTypes: [],
      provider: "linear" as const,
    };
    return new UnifiedSpawner(config as any, new Map());
  }

  const transientErrors = [
    "fatal: unable to access 'https://github.com/org/repo.git/'",
    "fatal: Could not read from remote repository",
    "Could not resolve host: github.com",
    "Connection refused",
    "Connection timed out",
    "Connection reset by peer",
    "SSL_ERROR_SYSCALL",
    "TLS handshake timeout",
    "rate limit exceeded",
    "HTTP 429 Too Many Requests",
    "500 Internal Server Error",
    "502 Bad Gateway",
    "503 Service Unavailable",
    "504 Gateway Timeout",
    "connect ETIMEDOUT 140.82.121.4:443",
    "connect ECONNREFUSED 127.0.0.1:443",
    "getaddrinfo ENOTFOUND github.com",
    "read ECONNRESET",
    "shallow file has changed since we read it",
  ];

  const nonTransientErrors = [
    "TypeScript compilation error: TS2304",
    "Test suite failed: 3 tests failed",
    "Permission denied (publickey)",
    "Could not determine review outcome",
    "Execution completed but no PR was detected",
    "bun install failed with exit code 1",
    "SyntaxError: Unexpected token",
  ];

  for (const error of transientErrors) {
    test(`transient: "${error.slice(0, 50)}..."`, () => {
      expect(makeSpawner().isTransientError(error)).toBe(true);
    });
  }

  for (const error of nonTransientErrors) {
    test(`non-transient: "${error.slice(0, 50)}..."`, () => {
      expect(makeSpawner().isTransientError(error)).toBe(false);
    });
  }
});
