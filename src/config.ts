import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { Config, RepoConfig } from "./types.js";

function validateWorkDir(workDir: string): void {
  const resolved = workDir.startsWith("/") ? workDir : `${process.cwd()}/${workDir}`;
  // Normalize: remove trailing slashes, collapse double slashes
  const normalized = resolved.replace(/\/+/g, "/").replace(/\/$/, "");

  // Block root
  if (normalized === "" || normalized === "/") {
    throw new Error(`Unsafe workDir "${workDir}": must not be the root directory`);
  }

  // Block home directories
  if (/^\/(Users|home)(\/[^/]+)?$/.test(normalized)) {
    throw new Error(`Unsafe workDir "${workDir}": must not be a home directory`);
  }

  // Block system directories
  const systemPrefixes = [
    "/etc",
    "/var",
    "/usr",
    "/bin",
    "/sbin",
    "/lib",
    "/opt",
    "/System",
    "/Library",
    "/Applications",
  ];
  for (const prefix of systemPrefixes) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      throw new Error(
        `Unsafe workDir "${workDir}": must not be inside system directory ${prefix}`,
      );
    }
  }

  // Must be under /tmp/ or contain "critters" in the path
  const isUnderTmp =
    normalized.startsWith("/tmp/") || normalized.startsWith("/private/tmp/");
  const containsCritters = normalized.toLowerCase().includes("critters");
  if (!isUnderTmp && !containsCritters) {
    throw new Error(
      `Unsafe workDir "${workDir}": must be under /tmp/ or contain "critters" in the path`,
    );
  }
}

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

  const workDir = (yaml.workDir as string) ?? "/tmp/critters-work";
  validateWorkDir(workDir);

  const config: Config = {
    pollIntervalSeconds: (yaml.pollIntervalSeconds as number) ?? 30,
    concurrency: (yaml.concurrency as number) ?? 2,
    timeoutMinutes: (yaml.timeoutMinutes as number) ?? 30,
    workDir,
    triggerLabel: (yaml.triggerLabel as string) ?? "Critter",
    maxPlanningTurns: (yaml.maxPlanningTurns as number) ?? 50,
    maxExecutionTurns: (yaml.maxExecutionTurns as number) ?? 75,
    defaultAllowedTools: (yaml.defaultAllowedTools as string[]) ?? [],
    tmuxSession: (yaml.tmuxSession as string) ?? "critters",
    noTmux: false,
    repos,
    teamRepos,
    linearApiKey,
    slackWebhookUrl,
  };

  validateConfig(config);
  return config;
}

const GIT_URL_RE = /^(git@[\w.-]+:[\w./-]+\.git|https?:\/\/[\w.-]+\/[\w./-]+\.git)$/;

function validateRepoUrls(config: Config): void {
  for (const [key, repo] of Object.entries(config.repos)) {
    if (!GIT_URL_RE.test(repo.url)) {
      throw new Error(`Invalid git URL for repo '${key}': ${repo.url}`);
    }
  }
  for (const [key, url] of Object.entries(config.teamRepos)) {
    if (!GIT_URL_RE.test(url)) {
      throw new Error(`Invalid git URL for teamRepo '${key}': ${url}`);
    }
  }
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
  if (!Array.isArray(config.defaultAllowedTools) || config.defaultAllowedTools.length === 0) {
    throw new Error("Invalid config: defaultAllowedTools must be a non-empty array of tool patterns");
  }
  validateRepoUrls(config);
}
