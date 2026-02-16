import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { Config, RepoConfig } from "./types.js";

export function loadConfig(configPath = "critters.config.yaml"): Config {
  const raw = readFileSync(configPath, "utf-8");
  const yaml = parseYaml(raw) as Record<string, unknown>;

  const linearApiKey = process.env.LINEAR_API_KEY;
  if (!linearApiKey) {
    throw new Error("LINEAR_API_KEY not set in environment or .env");
  }

  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL || undefined;

  const repos: Record<string, RepoConfig> = {};
  if (yaml.repos && typeof yaml.repos === "object") {
    for (const [key, val] of Object.entries(yaml.repos as Record<string, unknown>)) {
      const v = val as Record<string, unknown>;
      repos[key] = {
        url: v.url as string,
        extraAllowedTools: (v.extraAllowedTools as string[] | undefined) ?? [],
      };
    }
  }

  const teamRepos: Record<string, string> = {};
  if (yaml.teamRepos && typeof yaml.teamRepos === "object") {
    for (const [key, val] of Object.entries(yaml.teamRepos as Record<string, string>)) {
      teamRepos[key] = val;
    }
  }

  const config: Config = {
    pollIntervalSeconds: (yaml.pollIntervalSeconds as number) ?? 30,
    concurrency: (yaml.concurrency as number) ?? 2,
    timeoutMinutes: (yaml.timeoutMinutes as number) ?? 30,
    workDir: (yaml.workDir as string) ?? "/tmp/critters-work",
    triggerLabel: (yaml.triggerLabel as string) ?? "Critter",
    maxPlanningTurns: (yaml.maxPlanningTurns as number) ?? 50,
    maxExecutionTurns: (yaml.maxExecutionTurns as number) ?? 75,
    defaultAllowedTools: (yaml.defaultAllowedTools as string[]) ?? [],
    repos,
    teamRepos,
    linearApiKey,
    slackWebhookUrl,
  };

  validateConfig(config);
  return config;
}

function validateConfig(config: Config): void {
  if (config.concurrency < 1) {
    throw new Error(`Invalid config: concurrency must be >= 1, got ${config.concurrency}`);
  }
  if (config.timeoutMinutes <= 0) {
    throw new Error(`Invalid config: timeoutMinutes must be > 0, got ${config.timeoutMinutes}`);
  }
  if (config.pollIntervalSeconds < 5) {
    throw new Error(`Invalid config: pollIntervalSeconds must be >= 5, got ${config.pollIntervalSeconds}`);
  }
  if (config.maxPlanningTurns <= 0) {
    throw new Error(`Invalid config: maxPlanningTurns must be > 0, got ${config.maxPlanningTurns}`);
  }
  if (config.maxExecutionTurns <= 0) {
    throw new Error(`Invalid config: maxExecutionTurns must be > 0, got ${config.maxExecutionTurns}`);
  }
}
