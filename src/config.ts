import { readFileSync } from "fs";
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

  return {
    pollIntervalSeconds: (yaml.pollIntervalSeconds as number) ?? 30,
    concurrency: (yaml.concurrency as number) ?? 2,
    timeoutMinutes: (yaml.timeoutMinutes as number) ?? 30,
    workDir: (yaml.workDir as string) ?? "/tmp/critters-work",
    triggerLabel: (yaml.triggerLabel as string) ?? "Critter",
    maxTurns: (yaml.maxTurns as number) ?? 50,
    defaultAllowedTools: (yaml.defaultAllowedTools as string[]) ?? [],
    repos,
    teamRepos,
    linearApiKey,
    slackWebhookUrl,
  };
}
