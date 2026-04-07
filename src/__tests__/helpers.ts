import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CritterTypeConfig } from "../critter-type.js";
import type { Config } from "../types.js";

export function createTempDir(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), "critters-test-"));
  return {
    path,
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  };
}

export function createTestRepo(): { path: string; cleanup: () => void } {
  const { path, cleanup } = createTempDir();
  execSync("git init --bare", { cwd: path, stdio: "ignore" });
  return { path, cleanup };
}

export function makeTestConfig(overrides?: Partial<Config>): Config {
  return {
    pollIntervalSeconds: 120,
    concurrency: 2,
    timeoutMinutes: 30,
    workDir: "/tmp/critters-work",
    triggerLabel: "Critter",
    maxPlanningTurns: 50,
    maxExecutionTurns: 75,
    defaultAllowedTools: ["Read"],
    repos: {},
    teamRepos: {},
    tmuxSession: "critters",
    branchPrefix: "critter",
    noTmux: false,
    planningModel: "opus",
    executionModel: "opus",
    reviewTriggerLabel: "Critter Review",
    reviewModel: "opus",
    reviewConcurrency: 2,
    reviewTimeoutMinutes: 15,
    maxReviewTurns: 30,
    maxLogSizeMb: 10,
    minDiskSpaceMb: 1024,
    healthPort: 3847,
    metricsRetentionDays: 90,
    linearApiKey: "test-key",
    provider: "linear",
    critterTypes: [],
    cli: "claude",
    ...overrides,
  };
}

export function makeTestCritterType(overrides?: Partial<CritterTypeConfig>): CritterTypeConfig {
  return {
    name: "create",
    trigger: { label: "Critter", status: "Todo" },
    repo: { clone: true, branch: true },
    phases: [{ name: "planning", prompt: "builtin:planning", model: "opus", maxTurns: 50, tools: "readonly" }],
    outcomes: { success: { status: "In Review" }, failure: { status: "Critter Failed" } },
    concurrency: 2,
    timeoutMinutes: 30,
    ...overrides,
  };
}
