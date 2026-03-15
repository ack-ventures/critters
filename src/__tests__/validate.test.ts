import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { validateConfigFile } from "../validate.js";
import { createTempDir } from "./helpers.js";

let tempDir: string;
let cleanup: () => void;

// Save and restore env vars
const envKeys = ["LINEAR_API_KEY", "SLACK_WEBHOOK_URL", "JIRA_HOST", "JIRA_EMAIL", "JIRA_API_TOKEN"];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  const tmp = createTempDir();
  tempDir = tmp.path;
  cleanup = tmp.cleanup;

  savedEnv = {};
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
  }
  process.env.LINEAR_API_KEY = "test-key";
  delete process.env.SLACK_WEBHOOK_URL;
  delete process.env.JIRA_HOST;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
});

afterEach(() => {
  cleanup();
  for (const key of envKeys) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
});

function writeYaml(content: string): string {
  const path = `${tempDir}/config.yaml`;
  writeFileSync(path, content, "utf-8");
  return path;
}

const validYaml = `
defaultAllowedTools:
  - "Read"
  - "Write"
`;

describe("validateConfigFile", () => {
  test("valid config returns no errors, no warnings, and a summary", () => {
    const path = writeYaml(validYaml);
    const result = validateConfigFile(path);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.summary).toContain("Config valid");
    expect(result.summary).toContain("2 critter type(s)");
    expect(result.summary).toContain("provider: linear");
  });

  test("invalid YAML syntax throws fatal error", () => {
    const path = writeYaml("{ invalid yaml: [unclosed");
    expect(() => validateConfigFile(path)).toThrow();
  });

  test("missing defaultAllowedTools collects error", () => {
    const path = writeYaml("concurrency: 2\n");
    const result = validateConfigFile(path);
    expect(result.errors.some((e) => e.includes("defaultAllowedTools"))).toBe(true);
  });

  test("invalid critter type collects error", () => {
    const path = writeYaml(`
defaultAllowedTools:
  - "Read"
critterTypes:
  broken:
    trigger: {}
    phases:
      - name: test
        prompt: test.md
        model: opus
        maxTurns: 10
    outcomes:
      success: { status: "Done" }
`);
    const result = validateConfigFile(path);
    expect(result.errors.some((e) => e.includes("trigger must have label and status"))).toBe(true);
  });

  test("missing LINEAR_API_KEY collects error", () => {
    delete process.env.LINEAR_API_KEY;
    const path = writeYaml(validYaml);
    const result = validateConfigFile(path);
    expect(result.errors.some((e) => e.includes("LINEAR_API_KEY"))).toBe(true);
  });

  test("multiple errors are all reported", () => {
    delete process.env.LINEAR_API_KEY;
    const path = writeYaml(`
concurrency: 0
healthPort: 80
`);
    const result = validateConfigFile(path);
    // Should have at least: concurrency, healthPort, defaultAllowedTools, LINEAR_API_KEY
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
    expect(result.errors.some((e) => e.includes("concurrency"))).toBe(true);
    expect(result.errors.some((e) => e.includes("healthPort"))).toBe(true);
    expect(result.errors.some((e) => e.includes("defaultAllowedTools"))).toBe(true);
    expect(result.errors.some((e) => e.includes("LINEAR_API_KEY"))).toBe(true);
  });

  test("jira provider checks all three env vars", () => {
    delete process.env.LINEAR_API_KEY;
    const path = writeYaml(`
provider: jira
defaultAllowedTools:
  - "Read"
`);
    const result = validateConfigFile(path);
    expect(result.errors.some((e) => e.includes("JIRA_HOST"))).toBe(true);
    expect(result.errors.some((e) => e.includes("JIRA_EMAIL"))).toBe(true);
    expect(result.errors.some((e) => e.includes("JIRA_API_TOKEN"))).toBe(true);
    // Should NOT complain about LINEAR_API_KEY since provider is jira
    expect(result.errors.some((e) => e.includes("LINEAR_API_KEY"))).toBe(false);
  });

  test("invalid workDir collects error", () => {
    const path = writeYaml(`
workDir: /etc/bad
defaultAllowedTools:
  - "Read"
`);
    const result = validateConfigFile(path);
    expect(result.errors.some((e) => e.includes("Unsafe workDir"))).toBe(true);
  });

  test("invalid repo URL collects error", () => {
    const path = writeYaml(`
defaultAllowedTools:
  - "Read"
repos:
  "proj-1":
    url: "not-a-git-url"
`);
    const result = validateConfigFile(path);
    expect(result.errors.some((e) => e.includes("Invalid git URL"))).toBe(true);
  });

  test("custom --config path works", () => {
    const customPath = `${tempDir}/custom-config.yaml`;
    writeFileSync(customPath, validYaml, "utf-8");
    const result = validateConfigFile(customPath);
    expect(result.errors).toHaveLength(0);
    expect(result.summary).toContain("Config valid");
  });

  test("empty critterTypes object collects error", () => {
    const path = writeYaml(`
defaultAllowedTools:
  - "Read"
critterTypes: {}
`);
    const result = validateConfigFile(path);
    expect(result.errors.some((e) => e.includes("critterTypes is defined but empty"))).toBe(true);
  });

  test("high concurrency warns", () => {
    const path = writeYaml(`
concurrency: 8
defaultAllowedTools:
  - "Read"
`);
    const result = validateConfigFile(path);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("High concurrency (8)"))).toBe(true);
  });

  test("timeout over 60 warns", () => {
    const path = writeYaml(`
timeoutMinutes: 90
defaultAllowedTools:
  - "Read"
`);
    const result = validateConfigFile(path);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("Timeout over 60 minutes (90)"))).toBe(true);
  });

  test("short poll interval warns", () => {
    const path = writeYaml(`
pollIntervalSeconds: 10
defaultAllowedTools:
  - "Read"
`);
    const result = validateConfigFile(path);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("Very short poll interval (10s)"))).toBe(true);
  });

  test("high planning turns warns", () => {
    const path = writeYaml(`
maxPlanningTurns: 150
defaultAllowedTools:
  - "Read"
`);
    const result = validateConfigFile(path);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("High turn count (150) for maxPlanningTurns"))).toBe(true);
  });

  test("high execution turns warns", () => {
    const path = writeYaml(`
maxExecutionTurns: 200
defaultAllowedTools:
  - "Read"
`);
    const result = validateConfigFile(path);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("High turn count (200) for maxExecutionTurns"))).toBe(true);
  });

  test("health port 0 warns", () => {
    const path = writeYaml(`
healthPort: 0
defaultAllowedTools:
  - "Read"
`);
    const result = validateConfigFile(path);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("Health server disabled"))).toBe(true);
  });

  test("haiku model in phase warns", () => {
    const path = writeYaml(`
defaultAllowedTools:
  - "Read"
critterTypes:
  audit:
    trigger: { label: "Audit", status: "Todo" }
    phases:
      - name: scan
        prompt: scan.md
        model: haiku
        maxTurns: 10
    outcomes:
      success: { status: "Done" }
      failure: { status: "Failed" }
`);
    const result = validateConfigFile(path);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("Haiku model in phase 'scan'") && w.includes("type 'audit'"))).toBe(true);
  });

  test("low maxTurns in phase warns", () => {
    const path = writeYaml(`
defaultAllowedTools:
  - "Read"
critterTypes:
  quick:
    trigger: { label: "Quick", status: "Todo" }
    phases:
      - name: run
        prompt: run.md
        model: sonnet
        maxTurns: 3
    outcomes:
      success: { status: "Done" }
      failure: { status: "Failed" }
`);
    const result = validateConfigFile(path);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("Low maxTurns (3)") && w.includes("phase 'run'"))).toBe(true);
  });

  test("warnings don't cause errors and summary includes warning count", () => {
    const path = writeYaml(`
concurrency: 8
timeoutMinutes: 90
defaultAllowedTools:
  - "Read"
`);
    const result = validateConfigFile(path);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.summary).toContain("Config valid");
    expect(result.summary).toContain("warning(s)");
  });

  test("multiple warnings accumulate", () => {
    const path = writeYaml(`
concurrency: 8
timeoutMinutes: 90
pollIntervalSeconds: 10
healthPort: 0
maxPlanningTurns: 150
defaultAllowedTools:
  - "Read"
`);
    const result = validateConfigFile(path);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThanOrEqual(5);
  });

  test("minDiskSpaceMb <= 0 collects error", () => {
    const path = writeYaml(`
minDiskSpaceMb: -1
defaultAllowedTools:
  - "Read"
`);
    const result = validateConfigFile(path);
    expect(result.errors.some((e) => e.includes("minDiskSpaceMb must be > 0"))).toBe(true);
  });

  test("non-numeric minDiskSpaceMb is ignored (no error)", () => {
    const path = writeYaml(`
minDiskSpaceMb: "abc"
defaultAllowedTools:
  - "Read"
`);
    const result = validateConfigFile(path);
    expect(result.errors.some((e) => e.includes("minDiskSpaceMb"))).toBe(false);
  });

  test("autoUpdate.intervalMinutes < 1 collects error", () => {
    const path = writeYaml(`
autoUpdate:
  enabled: true
  intervalMinutes: 0
defaultAllowedTools:
  - "Read"
`);
    const result = validateConfigFile(path);
    expect(result.errors.some((e) => e.includes("autoUpdate.intervalMinutes must be >= 1"))).toBe(true);
  });

  test("valid autoUpdate config passes", () => {
    const path = writeYaml(`
autoUpdate:
  enabled: true
  intervalMinutes: 60
defaultAllowedTools:
  - "Read"
`);
    const result = validateConfigFile(path);
    expect(result.errors).toHaveLength(0);
  });

  test("reviewConcurrency and reviewTimeoutMinutes warn", () => {
    const path = writeYaml(`
reviewConcurrency: 8
reviewTimeoutMinutes: 90
defaultAllowedTools:
  - "Read"
`);
    const result = validateConfigFile(path);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("reviewConcurrency"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("reviewTimeoutMinutes"))).toBe(true);
  });
});
