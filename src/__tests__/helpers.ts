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
  const base = {
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
    provider: "linear" as const,
    critterTypes: [],
    cli: "claude",
    ...overrides,
  };

  return {
    ...base,
    // Grouped properties
    polling: {
      intervalSeconds: base.pollIntervalSeconds,
      circuitBreaker: base.circuitBreaker,
    },
    slack: {
      webhookUrl: base.slackWebhookUrl,
      botToken: base.slackBotToken,
      channel: base.slackChannel,
    },
    jira: {
      host: base.jiraHost,
      email: base.jiraEmail,
      apiToken: base.jiraApiToken,
      statusMap: base.jiraStatusMap,
      webhookSecret: base.jiraWebhookSecret,
    },
    linear: {
      apiKey: base.linearApiKey,
      webhookSecret: base.linearWebhookSecret,
    },
    daemon: {
      workDir: base.workDir,
      tmuxSession: base.tmuxSession,
      noTmux: base.noTmux,
      healthPort: base.healthPort,
      dashboardToken: base.dashboardToken,
      jsonLogs: base.jsonLogs,
      branchPrefix: base.branchPrefix,
    },
    limits: {
      maxLogSizeMb: base.maxLogSizeMb,
      minDiskSpaceMb: base.minDiskSpaceMb,
      metricsRetentionDays: base.metricsRetentionDays,
      costAlertThreshold: base.costAlertThreshold,
      costBudget: base.costBudget,
      cleanupIntervalMinutes: base.cleanupIntervalMinutes,
      cleanupStaleMinutes: base.cleanupStaleMinutes,
    },
    defaults: {
      triggerLabel: base.triggerLabel,
      maxPlanningTurns: base.maxPlanningTurns,
      maxExecutionTurns: base.maxExecutionTurns,
      defaultAllowedTools: base.defaultAllowedTools,
      planningModel: base.planningModel,
      executionModel: base.executionModel,
      reviewTriggerLabel: base.reviewTriggerLabel,
      reviewModel: base.reviewModel,
      reviewConcurrency: base.reviewConcurrency,
      reviewTimeoutMinutes: base.reviewTimeoutMinutes,
      maxReviewTurns: base.maxReviewTurns,
    },
    // Allow grouped overrides to take precedence
    ...(overrides?.polling ? { polling: overrides.polling } : {}),
    ...(overrides?.slack ? { slack: overrides.slack } : {}),
    ...(overrides?.jira ? { jira: overrides.jira } : {}),
    ...(overrides?.linear ? { linear: overrides.linear } : {}),
    ...(overrides?.daemon ? { daemon: overrides.daemon } : {}),
    ...(overrides?.limits ? { limits: overrides.limits } : {}),
    ...(overrides?.defaults ? { defaults: overrides.defaults } : {}),
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
