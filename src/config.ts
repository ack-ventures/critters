import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { assertValidCliAdapterName } from "./cli/adapter-names.js";
import { type CritterTypeConfig, parseCritterTypes as parseCritterTypesFromYaml, synthesizeDefaultTypes } from "./critter-type.js";
import { log } from "./logger.js";
import type { AutoRetryConfig, AutoUpdateConfig, CircuitBreakerConfig, Config, RepoConfig, TunnelConfig } from "./types.js";

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
  // parseYaml returns null for an empty/comment-only file; coalesce to {} so the
  // field reads below produce sensible defaults instead of a cryptic TypeError.
  const yaml = (parseYaml(raw) ?? {}) as Record<string, unknown>;

  const linearApiKey = process.env.LINEAR_API_KEY || undefined;
  const jiraHost = process.env.JIRA_HOST || undefined;
  const jiraEmail = process.env.JIRA_EMAIL || undefined;
  const jiraApiToken = process.env.JIRA_API_TOKEN || undefined;
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL || undefined;
  const slackBotToken = process.env.SLACK_BOT_TOKEN || undefined;
  const slackChannel = process.env.SLACK_CHANNEL || undefined;
  const dashboardToken = (yaml.dashboardToken as string) ?? process.env.DASHBOARD_TOKEN ?? undefined;
  const linearWebhookSecret = (yaml.linearWebhookSecret as string) ?? process.env.LINEAR_WEBHOOK_SECRET ?? undefined;
  const jiraWebhookSecret = (yaml.jiraWebhookSecret as string) ?? process.env.JIRA_WEBHOOK_SECRET ?? undefined;

  const repos: Record<string, RepoConfig> = {};
  if (yaml.repos && typeof yaml.repos === "object") {
    for (const [key, val] of Object.entries(yaml.repos as Record<string, unknown>)) {
      const v = val as Record<string, unknown>;
      repos[key] = {
        url: v.url as string,
        extraAllowedTools: (v.extraAllowedTools as string[] | undefined) ?? [],
        localPath: v.localPath as string | undefined,
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

  const autoRetryRaw = yaml.autoRetry as Record<string, unknown> | undefined;
  const autoRetry: AutoRetryConfig | undefined = autoRetryRaw
    ? {
        maxRetries: (autoRetryRaw.maxRetries as number) ?? 1,
        baseDelaySeconds: (autoRetryRaw.baseDelaySeconds as number) ?? 60,
        maxDelaySeconds: (autoRetryRaw.maxDelaySeconds as number) ?? 300,
      }
    : undefined;

  const workDir = (yaml.workDir as string) ?? "/tmp/critters-work";
  validateWorkDir(workDir);

  // Ensure the directory exists and resolve symlinks (e.g. /tmp → /private/tmp on macOS)
  mkdirSync(workDir, { recursive: true });
  const resolvedWorkDir = realpathSync(workDir);

  const autoUpdateRaw = yaml.autoUpdate as Record<string, unknown> | undefined;
  const autoUpdate: AutoUpdateConfig | undefined = autoUpdateRaw
    ? {
        enabled: (autoUpdateRaw.enabled as boolean) ?? true,
        intervalMinutes: (autoUpdateRaw.intervalMinutes as number) ?? 1440,
      }
    : undefined;

  const tunnel = yaml.tunnel as TunnelConfig | undefined;

  const circuitBreakerRaw = yaml.circuitBreaker as Record<string, unknown> | undefined;
  const circuitBreaker: CircuitBreakerConfig | undefined = circuitBreakerRaw
    ? {
        failureThreshold: (circuitBreakerRaw.failureThreshold as number) ?? undefined,
        maxBackoffMinutes: (circuitBreakerRaw.maxBackoffMinutes as number) ?? undefined,
      }
    : undefined;

  const provider = ((yaml.provider as string) ?? "linear") as "linear" | "jira";

  const pollIntervalSeconds = (yaml.pollIntervalSeconds as number) ?? 30;
  const triggerLabel = (yaml.triggerLabel as string) ?? "Critter";
  const maxPlanningTurns = (yaml.maxPlanningTurns as number) ?? 50;
  const maxExecutionTurns = (yaml.maxExecutionTurns as number) ?? 75;
  const defaultAllowedTools = (yaml.defaultAllowedTools as string[]) ?? [];
  const tmuxSession = (yaml.tmuxSession as string) ?? "critters";
  const branchPrefix = (yaml.branchPrefix as string) ?? "critter";
  const jsonLogs = (yaml.jsonLogs as boolean) ?? undefined;
  const planningModel = (yaml.planningModel as string) ?? "opus";
  const executionModel = (yaml.executionModel as string) ?? "opus";
  const reviewTriggerLabel = (yaml.reviewTriggerLabel as string) ?? "Critter Review";
  const reviewModel = (yaml.reviewModel as string) ?? "opus";
  const reviewConcurrency = (yaml.reviewConcurrency as number) ?? 2;
  const reviewTimeoutMinutes = (yaml.reviewTimeoutMinutes as number) ?? 15;
  const maxReviewTurns = (yaml.maxReviewTurns as number) ?? 30;
  const maxLogSizeMb = (yaml.maxLogSizeMb as number) ?? 10;
  const minDiskSpaceMb = typeof yaml.minDiskSpaceMb === "number" ? yaml.minDiskSpaceMb : 1024;
  const healthPort = (yaml.healthPort as number) ?? 3847;
  const metricsRetentionDays = (yaml.metricsRetentionDays as number) ?? 90;
  const cleanupIntervalMinutes = (yaml.cleanupIntervalMinutes as number) ?? undefined;
  const cleanupStaleMinutes = (yaml.cleanupStaleMinutes as number) ?? undefined;
  const costAlertThreshold = (yaml.costAlertThreshold as number) ?? undefined;
  const costBudget = (yaml.costBudget as number) ?? undefined;
  const jiraStatusMap = (yaml.jiraStatusMap as Record<string, string>) ?? undefined;

  const config: Config = {
    // Grouped properties
    polling: {
      intervalSeconds: pollIntervalSeconds,
      circuitBreaker,
    },
    slack: {
      webhookUrl: slackWebhookUrl,
      botToken: slackBotToken,
      channel: slackChannel,
    },
    jira: {
      host: jiraHost,
      email: jiraEmail,
      apiToken: jiraApiToken,
      statusMap: jiraStatusMap,
      webhookSecret: jiraWebhookSecret,
    },
    linear: {
      apiKey: linearApiKey,
      webhookSecret: linearWebhookSecret,
    },
    daemon: {
      workDir: resolvedWorkDir,
      tmuxSession,
      noTmux: false,
      healthPort,
      dashboardToken,
      jsonLogs,
      branchPrefix,
    },
    limits: {
      maxLogSizeMb,
      minDiskSpaceMb,
      metricsRetentionDays,
      costAlertThreshold,
      costBudget,
      cleanupIntervalMinutes,
      cleanupStaleMinutes,
    },
    defaults: {
      triggerLabel,
      maxPlanningTurns,
      maxExecutionTurns,
      defaultAllowedTools,
      planningModel,
      executionModel,
      reviewTriggerLabel,
      reviewModel,
      reviewConcurrency,
      reviewTimeoutMinutes,
      maxReviewTurns,
    },

    // Flat fields (backward compat)
    pollIntervalSeconds,
    concurrency: (yaml.concurrency as number) ?? 2,
    timeoutMinutes: (yaml.timeoutMinutes as number) ?? 30,
    workDir: resolvedWorkDir,
    cleanupIntervalMinutes,
    cleanupStaleMinutes,
    triggerLabel,
    maxPlanningTurns,
    maxExecutionTurns,
    defaultAllowedTools,
    tmuxSession,
    branchPrefix,
    noTmux: false,
    jsonLogs,
    planningModel,
    executionModel,
    reviewTriggerLabel,
    reviewModel,
    reviewConcurrency,
    reviewTimeoutMinutes,
    maxReviewTurns,
    maxLogSizeMb,
    minDiskSpaceMb,
    healthPort,
    dashboardToken,
    metricsRetentionDays,
    repos,
    teamRepos,
    defaultRepo: (yaml.defaultRepo as string) ?? undefined,
    linearApiKey,
    jiraHost,
    jiraEmail,
    jiraApiToken,
    jiraStatusMap,
    slackWebhookUrl,
    slackBotToken,
    slackChannel,
    costAlertThreshold,
    costBudget,
    hooks,
    autoRetry,
    autoUpdate,
    tunnel,
    circuitBreaker,
    mcpConfig: (yaml.mcpConfig as string | string[]) ?? undefined,
    strictMcpConfig: (yaml.strictMcpConfig as boolean) ?? undefined,
    linearWebhookSecret,
    jiraWebhookSecret,
    provider,
    critterTypes: [], // populated below
    cli: (yaml.cli as string) ?? "claude",
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
  const yaml = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const workDir = (yaml.workDir as string) ?? "/tmp/critters-work";
  validateWorkDir(workDir);

  // Resolve symlinks if the directory exists (e.g. /tmp → /private/tmp on macOS)
  if (existsSync(workDir)) {
    return realpathSync(workDir);
  }
  return workDir;
}

export function loadCleanConfig(configPath?: string): { workDir: string; cleanupStaleMinutes?: number; healthPort: number; tmuxSession: string } {
  let resolved: string | undefined;
  try {
    resolved = resolveConfigPath(configPath);
  } catch {
    return { workDir: "/tmp/critters-work", healthPort: 3847, tmuxSession: "critters" };
  }
  const raw = readFileSync(resolved, "utf-8");
  const yaml = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const workDir = (yaml.workDir as string) ?? "/tmp/critters-work";
  validateWorkDir(workDir);
  const tmuxSession = (yaml.tmuxSession as string) ?? "critters";
  if (existsSync(workDir)) {
    return {
      workDir: realpathSync(workDir),
      cleanupStaleMinutes: (yaml.cleanupStaleMinutes as number) ?? undefined,
      healthPort: (yaml.healthPort as number) ?? 3847,
      tmuxSession,
    };
  }
  return {
    workDir,
    cleanupStaleMinutes: (yaml.cleanupStaleMinutes as number) ?? undefined,
    healthPort: (yaml.healthPort as number) ?? 3847,
    tmuxSession,
  };
}

function parseCritterTypes(yaml: Record<string, unknown>, config: Config): CritterTypeConfig[] {
  const rawTypes = yaml.critterTypes as Record<string, Record<string, unknown>> | undefined;

  if (!rawTypes || typeof rawTypes !== "object") {
    // No critterTypes in YAML — synthesize from flat config fields
    return synthesizeDefaultTypes(config);
  }

  const types: CritterTypeConfig[] = [];
  for (const [name, raw] of Object.entries(rawTypes)) {
    // parseCritterTypesFromYaml → parseCritterType already validates each type,
    // so no separate validateCritterType pass is needed here.
    const expanded = parseCritterTypesFromYaml(name, raw);
    types.push(...expanded);
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
  if (config.polling.intervalSeconds < 5) {
    throw new Error(`Invalid config: pollIntervalSeconds must be >= 5, got ${config.polling.intervalSeconds}`);
  }
  if (config.defaults.maxPlanningTurns <= 0) {
    throw new Error(`Invalid config: maxPlanningTurns must be > 0, got ${config.defaults.maxPlanningTurns}`);
  }
  if (config.defaults.maxExecutionTurns <= 0) {
    throw new Error(`Invalid config: maxExecutionTurns must be > 0, got ${config.defaults.maxExecutionTurns}`);
  }
  if (config.defaults.reviewConcurrency < 1) {
    throw new Error(`Invalid config: reviewConcurrency must be >= 1, got ${config.defaults.reviewConcurrency}`);
  }
  if (config.defaults.reviewTimeoutMinutes <= 0) {
    throw new Error(`Invalid config: reviewTimeoutMinutes must be > 0, got ${config.defaults.reviewTimeoutMinutes}`);
  }
  if (config.defaults.maxReviewTurns <= 0) {
    throw new Error(`Invalid config: maxReviewTurns must be > 0, got ${config.defaults.maxReviewTurns}`);
  }
  if (config.limits.maxLogSizeMb <= 0) {
    throw new Error(`Invalid config: maxLogSizeMb must be > 0, got ${config.limits.maxLogSizeMb}`);
  }
  if (config.limits.minDiskSpaceMb <= 0) {
    throw new Error(`Invalid config: minDiskSpaceMb must be > 0, got ${config.limits.minDiskSpaceMb}`);
  }
  if (config.limits.metricsRetentionDays < 1) {
    throw new Error(`Invalid config: metricsRetentionDays must be >= 1, got ${config.limits.metricsRetentionDays}`);
  }
  if (config.daemon.healthPort !== 0 && (config.daemon.healthPort < 1024 || config.daemon.healthPort > 65535)) {
    throw new Error(`Invalid config: healthPort must be 0 (disabled) or 1024-65535, got ${config.daemon.healthPort}`);
  }
  if (!Array.isArray(config.defaults.defaultAllowedTools) || config.defaults.defaultAllowedTools.length === 0) {
    throw new Error("Invalid config: defaultAllowedTools must be a non-empty array of tool patterns");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(config.daemon.branchPrefix)) {
    throw new Error(`Invalid config: branchPrefix must match /^[a-zA-Z0-9._-]+$/, got "${config.daemon.branchPrefix}"`);
  }
  if (config.limits.cleanupIntervalMinutes != null && config.limits.cleanupIntervalMinutes <= 0) {
    throw new Error(`Invalid config: cleanupIntervalMinutes must be > 0, got ${config.limits.cleanupIntervalMinutes}`);
  }
  if (config.limits.cleanupStaleMinutes != null && config.limits.cleanupStaleMinutes <= 0) {
    throw new Error(`Invalid config: cleanupStaleMinutes must be > 0, got ${config.limits.cleanupStaleMinutes}`);
  }
  if (config.limits.costAlertThreshold != null && config.limits.costAlertThreshold <= 0) {
    throw new Error(`Invalid config: costAlertThreshold must be > 0, got ${config.limits.costAlertThreshold}`);
  }
  if (config.limits.costBudget != null && config.limits.costBudget <= 0) {
    throw new Error(`Invalid config: costBudget must be > 0, got ${config.limits.costBudget}`);
  }
  if (config.autoUpdate) {
    if (config.autoUpdate.intervalMinutes < 1) {
      throw new Error(`Invalid config: autoUpdate.intervalMinutes must be >= 1, got ${config.autoUpdate.intervalMinutes}`);
    }
  }
  if (config.autoRetry) {
    if (config.autoRetry.maxRetries < 1) {
      throw new Error(`Invalid config: autoRetry.maxRetries must be >= 1, got ${config.autoRetry.maxRetries}`);
    }
    if (config.autoRetry.baseDelaySeconds <= 0) {
      throw new Error(`Invalid config: autoRetry.baseDelaySeconds must be > 0, got ${config.autoRetry.baseDelaySeconds}`);
    }
    if (config.autoRetry.maxDelaySeconds < config.autoRetry.baseDelaySeconds) {
      throw new Error(`Invalid config: autoRetry.maxDelaySeconds must be >= baseDelaySeconds, got ${config.autoRetry.maxDelaySeconds}`);
    }
  }
  if (config.polling.circuitBreaker) {
    if (config.polling.circuitBreaker.failureThreshold != null && config.polling.circuitBreaker.failureThreshold < 1) {
      throw new Error(`Invalid config: circuitBreaker.failureThreshold must be >= 1, got ${config.polling.circuitBreaker.failureThreshold}`);
    }
    if (config.polling.circuitBreaker.maxBackoffMinutes != null && config.polling.circuitBreaker.maxBackoffMinutes <= 0) {
      throw new Error(`Invalid config: circuitBreaker.maxBackoffMinutes must be > 0, got ${config.polling.circuitBreaker.maxBackoffMinutes}`);
    }
  }
  if (config.slack.botToken && !config.slack.channel) {
    throw new Error("SLACK_CHANNEL must be set when SLACK_BOT_TOKEN is configured");
  }
  if (config.tunnel?.enabled && config.tunnel?.auth) {
    if (!/^[^:]+:.+$/.test(config.tunnel.auth)) {
      throw new Error(`Invalid config: tunnel.auth must be in "user:password" format, got "${config.tunnel.auth}"`);
    }
  }
  if (config.tunnel?.enabled && config.daemon.healthPort === 0) {
    log("Warning: tunnel.enabled is true but healthPort is 0 — no tunnel will be started");
  }
  if (config.defaultRepo && !GIT_URL_RE.test(config.defaultRepo)) {
    throw new Error(`Invalid git URL for defaultRepo: ${config.defaultRepo}`);
  }
  assertValidCliAdapterName(config.cli, "Invalid config");
  validateRepoUrls(config.repos, config.teamRepos);
  const credErrors = checkProviderCredentials(config.critterTypes, config.provider, {
    linearApiKey: config.linear.apiKey,
    jiraHost: config.jira.host,
    jiraEmail: config.jira.email,
    jiraApiToken: config.jira.apiToken,
  });
  if (credErrors.length > 0) {
    throw new Error(credErrors[0]);
  }
}
