import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { type CritterTypeConfig, parseCritterTypes as parseCritterTypesFromYaml, synthesizeDefaultTypes, validateCritterType } from "./critter-type.js";
import type { Config, RepoConfig } from "./types.js";

export function validateWorkDir(workDir: string): void {
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

export function resolveConfigPath(configPath?: string): string {
  if (configPath) return configPath;

  const candidates = [
    "./critters.config.yaml",
    `${homedir()}/.critters/config.yaml`,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `Config file not found. Searched:\n` +
    candidates.map((c) => `  - ${c}`).join("\n") +
    `\n\nCreate critters.config.yaml in the current directory, or ~/.critters/config.yaml for installed binary usage.` +
    `\nYou can also pass --config <path> to specify a config file.`,
  );
}

export function loadConfig(configPath?: string): Config {
  const resolved = resolveConfigPath(configPath);
  const raw = readFileSync(resolved, "utf-8");
  const yaml = parseYaml(raw) as Record<string, unknown>;

  const linearApiKey = process.env.LINEAR_API_KEY || undefined;
  const jiraHost = process.env.JIRA_HOST || undefined;
  const jiraEmail = process.env.JIRA_EMAIL || undefined;
  const jiraApiToken = process.env.JIRA_API_TOKEN || undefined;
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL || undefined;
  const slackBotToken = process.env.SLACK_BOT_TOKEN || undefined;
  const slackChannel = process.env.SLACK_CHANNEL || undefined;

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

  const hooks = yaml.hooks as Config["hooks"] | undefined;

  const workDir = (yaml.workDir as string) ?? "/tmp/critters-work";
  validateWorkDir(workDir);

  // Ensure the directory exists and resolve symlinks (e.g. /tmp → /private/tmp on macOS)
  mkdirSync(workDir, { recursive: true });
  const resolvedWorkDir = realpathSync(workDir);

  const provider = ((yaml.provider as string) ?? "linear") as "linear" | "jira";

  const config: Config = {
    pollIntervalSeconds: (yaml.pollIntervalSeconds as number) ?? 30,
    concurrency: (yaml.concurrency as number) ?? 2,
    timeoutMinutes: (yaml.timeoutMinutes as number) ?? 30,
    workDir: resolvedWorkDir,
    triggerLabel: (yaml.triggerLabel as string) ?? "Critter",
    maxPlanningTurns: (yaml.maxPlanningTurns as number) ?? 50,
    maxExecutionTurns: (yaml.maxExecutionTurns as number) ?? 75,
    defaultAllowedTools: (yaml.defaultAllowedTools as string[]) ?? [],
    tmuxSession: (yaml.tmuxSession as string) ?? "critters",
    branchPrefix: (yaml.branchPrefix as string) ?? "critter",
    noTmux: false,
    planningModel: (yaml.planningModel as string) ?? "opus",
    executionModel: (yaml.executionModel as string) ?? "opus",
    reviewTriggerLabel: (yaml.reviewTriggerLabel as string) ?? "Critter Review",
    reviewModel: (yaml.reviewModel as string) ?? "opus",
    reviewConcurrency: (yaml.reviewConcurrency as number) ?? 2,
    reviewTimeoutMinutes: (yaml.reviewTimeoutMinutes as number) ?? 15,
    maxReviewTurns: (yaml.maxReviewTurns as number) ?? 30,
    maxLogSizeMb: (yaml.maxLogSizeMb as number) ?? 10,
    healthPort: (yaml.healthPort as number) ?? 3847,
    repos,
    teamRepos,
    linearApiKey,
    jiraHost,
    jiraEmail,
    jiraApiToken,
    jiraStatusMap: (yaml.jiraStatusMap as Record<string, string>) ?? undefined,
    slackWebhookUrl,
    slackBotToken,
    slackChannel,
    hooks,
    provider,
    critterTypes: [], // populated below
  };

  // Parse critterTypes from YAML, or synthesize from flat config
  config.critterTypes = parseCritterTypes(yaml, config);

  validateConfig(config);
  return config;
}

export function loadWorkDir(configPath?: string): string {
  let resolved: string | undefined;
  try {
    resolved = resolveConfigPath(configPath);
  } catch {
    // No config file found — use default
    return "/tmp/critters-work";
  }

  const raw = readFileSync(resolved, "utf-8");
  const yaml = parseYaml(raw) as Record<string, unknown>;
  const workDir = (yaml.workDir as string) ?? "/tmp/critters-work";
  validateWorkDir(workDir);

  // Resolve symlinks if the directory exists (e.g. /tmp → /private/tmp on macOS)
  if (existsSync(workDir)) {
    return realpathSync(workDir);
  }
  return workDir;
}

function parseCritterTypes(yaml: Record<string, unknown>, config: Config): CritterTypeConfig[] {
  const rawTypes = yaml.critterTypes as Record<string, Record<string, unknown>> | undefined;

  if (!rawTypes || typeof rawTypes !== "object") {
    // No critterTypes in YAML — synthesize from flat config fields
    return synthesizeDefaultTypes(config);
  }

  const types: CritterTypeConfig[] = [];
  for (const [name, raw] of Object.entries(rawTypes)) {
    const expanded = parseCritterTypesFromYaml(name, raw);
    for (const ct of expanded) {
      validateCritterType(ct);
      types.push(ct);
    }
  }

  if (types.length === 0) {
    throw new Error("critterTypes is defined but empty — must have at least one type");
  }

  return types;
}

const GIT_URL_RE = /^(git@[\w.-]+:[\w./-]+\.git|https?:\/\/[\w.-]+\/[\w./-]+\.git)$/;

export function validateRepoUrls(repos: Record<string, { url: string }>, teamRepos: Record<string, string>): void {
  for (const [key, repo] of Object.entries(repos)) {
    if (!GIT_URL_RE.test(repo.url)) {
      throw new Error(`Invalid git URL for repo '${key}': ${repo.url}`);
    }
  }
  for (const [key, url] of Object.entries(teamRepos)) {
    if (!GIT_URL_RE.test(url)) {
      throw new Error(`Invalid git URL for teamRepo '${key}': ${url}`);
    }
  }
}

export function checkProviderCredentials(
  critterTypes: CritterTypeConfig[],
  defaultProvider: string,
  env: { linearApiKey?: string; jiraHost?: string; jiraEmail?: string; jiraApiToken?: string },
): string[] {
  const errors: string[] = [];
  const neededProviders = new Set<string>();
  for (const ct of critterTypes) {
    neededProviders.add(ct.provider ?? defaultProvider);
  }

  if (neededProviders.has("linear") && !env.linearApiKey) {
    errors.push("LINEAR_API_KEY not set in environment or .env (required by at least one critter type using the Linear provider)");
  }

  if (neededProviders.has("jira")) {
    const missing: string[] = [];
    if (!env.jiraHost) missing.push("JIRA_HOST");
    if (!env.jiraEmail) missing.push("JIRA_EMAIL");
    if (!env.jiraApiToken) missing.push("JIRA_API_TOKEN");
    if (missing.length > 0) {
      errors.push(`${missing.join(", ")} not set in environment or .env (required by at least one critter type using the Jira provider)`);
    }
  }

  return errors;
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
  if (config.reviewConcurrency < 1) {
    throw new Error(`Invalid config: reviewConcurrency must be >= 1, got ${config.reviewConcurrency}`);
  }
  if (config.reviewTimeoutMinutes <= 0) {
    throw new Error(`Invalid config: reviewTimeoutMinutes must be > 0, got ${config.reviewTimeoutMinutes}`);
  }
  if (config.maxReviewTurns <= 0) {
    throw new Error(`Invalid config: maxReviewTurns must be > 0, got ${config.maxReviewTurns}`);
  }
  if (config.maxLogSizeMb <= 0) {
    throw new Error(`Invalid config: maxLogSizeMb must be > 0, got ${config.maxLogSizeMb}`);
  }
  if (config.healthPort !== 0 && (config.healthPort < 1024 || config.healthPort > 65535)) {
    throw new Error(`Invalid config: healthPort must be 0 (disabled) or 1024-65535, got ${config.healthPort}`);
  }
  if (!Array.isArray(config.defaultAllowedTools) || config.defaultAllowedTools.length === 0) {
    throw new Error("Invalid config: defaultAllowedTools must be a non-empty array of tool patterns");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(config.branchPrefix)) {
    throw new Error(`Invalid config: branchPrefix must match /^[a-zA-Z0-9._-]+$/, got "${config.branchPrefix}"`);
  }
  if (config.slackBotToken && !config.slackChannel) {
    throw new Error("SLACK_CHANNEL must be set when SLACK_BOT_TOKEN is configured");
  }
  validateRepoUrls(config.repos, config.teamRepos);
  const credErrors = checkProviderCredentials(config.critterTypes, config.provider, {
    linearApiKey: config.linearApiKey,
    jiraHost: config.jiraHost,
    jiraEmail: config.jiraEmail,
    jiraApiToken: config.jiraApiToken,
  });
  if (credErrors.length > 0) {
    throw new Error(credErrors[0]);
  }
}
