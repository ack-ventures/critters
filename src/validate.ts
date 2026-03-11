import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { checkProviderCredentials, resolveConfigPath, validateRepoUrls, validateWorkDir } from "./config.js";
import { type CritterTypeConfig, parseCritterTypes, synthesizeDefaultTypes } from "./critter-type.js";
import { loadEnvFallback } from "./env.js";
import type { Config, RepoConfig } from "./types.js";

export function validateConfigFile(configPath?: string): { errors: string[]; warnings: string[]; summary?: string } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Load env fallback so env var checks are accurate
  loadEnvFallback();

  // Resolve config path (fatal if not found)
  const resolvedPath = resolveConfigPath(configPath);

  // Parse YAML (fatal if invalid syntax)
  const raw = readFileSync(resolvedPath, "utf-8");
  const yaml = (parseYaml(raw) ?? {}) as Record<string, unknown>;

  // Validate workDir safety
  const workDir = (yaml.workDir as string) ?? "/tmp/critters-work";
  try {
    validateWorkDir(workDir);
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Validate numeric ranges
  const concurrency = (yaml.concurrency as number) ?? 2;
  if (typeof yaml.concurrency === "number" && concurrency < 1) {
    errors.push(`Invalid config: concurrency must be >= 1, got ${concurrency}`);
  }
  if (concurrency > 5) {
    warnings.push(`High concurrency (${concurrency}) — ensure you have sufficient API quota`);
  }

  const timeoutMinutes = (yaml.timeoutMinutes as number) ?? 30;
  if (typeof yaml.timeoutMinutes === "number" && timeoutMinutes <= 0) {
    errors.push(`Invalid config: timeoutMinutes must be > 0, got ${timeoutMinutes}`);
  }
  if (timeoutMinutes > 60) {
    warnings.push(`Timeout over 60 minutes (${timeoutMinutes}) may indicate a misconfiguration`);
  }

  const pollIntervalSeconds = (yaml.pollIntervalSeconds as number) ?? 30;
  if (typeof yaml.pollIntervalSeconds === "number" && pollIntervalSeconds < 5) {
    errors.push(`Invalid config: pollIntervalSeconds must be >= 5, got ${pollIntervalSeconds}`);
  }
  if (pollIntervalSeconds < 30) {
    warnings.push(`Very short poll interval (${pollIntervalSeconds}s) may hit API rate limits`);
  }

  const maxPlanningTurns = (yaml.maxPlanningTurns as number) ?? 50;
  if (typeof yaml.maxPlanningTurns === "number" && maxPlanningTurns <= 0) {
    errors.push(`Invalid config: maxPlanningTurns must be > 0, got ${maxPlanningTurns}`);
  }
  if (maxPlanningTurns > 100) {
    warnings.push(`High turn count (${maxPlanningTurns}) for maxPlanningTurns may lead to expensive runs`);
  }

  const maxExecutionTurns = (yaml.maxExecutionTurns as number) ?? 75;
  if (typeof yaml.maxExecutionTurns === "number" && maxExecutionTurns <= 0) {
    errors.push(`Invalid config: maxExecutionTurns must be > 0, got ${maxExecutionTurns}`);
  }
  if (maxExecutionTurns > 100) {
    warnings.push(`High turn count (${maxExecutionTurns}) for maxExecutionTurns may lead to expensive runs`);
  }

  const reviewConcurrency = (yaml.reviewConcurrency as number) ?? 2;
  if (typeof yaml.reviewConcurrency === "number" && reviewConcurrency < 1) {
    errors.push(`Invalid config: reviewConcurrency must be >= 1, got ${reviewConcurrency}`);
  }
  if (reviewConcurrency > 5) {
    warnings.push(`High concurrency (${reviewConcurrency}) for reviewConcurrency — ensure you have sufficient API quota`);
  }

  const reviewTimeoutMinutes = (yaml.reviewTimeoutMinutes as number) ?? 15;
  if (typeof yaml.reviewTimeoutMinutes === "number" && reviewTimeoutMinutes <= 0) {
    errors.push(`Invalid config: reviewTimeoutMinutes must be > 0, got ${reviewTimeoutMinutes}`);
  }
  if (reviewTimeoutMinutes > 60) {
    warnings.push(`Timeout over 60 minutes (${reviewTimeoutMinutes}) for reviewTimeoutMinutes may indicate a misconfiguration`);
  }

  const maxReviewTurns = (yaml.maxReviewTurns as number) ?? 30;
  if (typeof yaml.maxReviewTurns === "number" && maxReviewTurns <= 0) {
    errors.push(`Invalid config: maxReviewTurns must be > 0, got ${maxReviewTurns}`);
  }

  const maxLogSizeMb = (yaml.maxLogSizeMb as number) ?? 10;
  if (typeof yaml.maxLogSizeMb === "number" && maxLogSizeMb <= 0) {
    errors.push(`Invalid config: maxLogSizeMb must be > 0, got ${maxLogSizeMb}`);
  }

  const minDiskSpaceMb = (yaml.minDiskSpaceMb as number) ?? 1024;
  if (typeof yaml.minDiskSpaceMb === "number" && minDiskSpaceMb <= 0) {
    errors.push(`Invalid config: minDiskSpaceMb must be > 0, got ${minDiskSpaceMb}`);
  }

  const healthPort = (yaml.healthPort as number) ?? 3847;
  if (typeof yaml.healthPort === "number" && healthPort !== 0 && (healthPort < 1024 || healthPort > 65535)) {
    errors.push(`Invalid config: healthPort must be 0 (disabled) or 1024-65535, got ${healthPort}`);
  }
  if (healthPort === 0) {
    warnings.push("Health server disabled — dashboard and kickoff will not work");
  }

  // Validate autoRetry
  const autoRetryRaw = yaml.autoRetry as Record<string, unknown> | undefined;
  if (autoRetryRaw) {
    const maxRetries = (autoRetryRaw.maxRetries as number) ?? 1;
    if (typeof autoRetryRaw.maxRetries === "number" && maxRetries < 1) {
      errors.push(`Invalid config: autoRetry.maxRetries must be >= 1, got ${maxRetries}`);
    }
    const baseDelaySeconds = (autoRetryRaw.baseDelaySeconds as number) ?? 60;
    if (typeof autoRetryRaw.baseDelaySeconds === "number" && baseDelaySeconds <= 0) {
      errors.push(`Invalid config: autoRetry.baseDelaySeconds must be > 0, got ${baseDelaySeconds}`);
    }
    const maxDelaySeconds = (autoRetryRaw.maxDelaySeconds as number) ?? 300;
    if (typeof autoRetryRaw.maxDelaySeconds === "number" && maxDelaySeconds < baseDelaySeconds) {
      errors.push(`Invalid config: autoRetry.maxDelaySeconds must be >= baseDelaySeconds, got ${maxDelaySeconds}`);
    }
  }

  // Validate defaultAllowedTools
  const defaultAllowedTools = yaml.defaultAllowedTools as string[] | undefined;
  if (!Array.isArray(defaultAllowedTools) || defaultAllowedTools.length === 0) {
    errors.push("Invalid config: defaultAllowedTools must be a non-empty array of tool patterns");
  }

  // Validate repo URLs
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
  try {
    validateRepoUrls(repos, teamRepos);
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Validate critter types
  let critterTypes: CritterTypeConfig[] = [];
  const rawTypes = yaml.critterTypes as Record<string, Record<string, unknown>> | undefined;

  if (rawTypes && typeof rawTypes === "object") {
    if (Object.keys(rawTypes).length === 0) {
      errors.push("critterTypes is defined but empty — must have at least one type");
    } else {
      for (const [name, rawType] of Object.entries(rawTypes)) {
        try {
          const expanded = parseCritterTypes(name, rawType);
          critterTypes.push(...expanded);
        } catch (e) {
          errors.push((e as Error).message);
        }
      }
    }
  } else {
    // Synthesize defaults from flat config to validate they would work
    try {
      const partialConfig = {
        triggerLabel: (yaml.triggerLabel as string) ?? "Critter",
        planningModel: (yaml.planningModel as string) ?? "opus",
        maxPlanningTurns,
        executionModel: (yaml.executionModel as string) ?? "opus",
        maxExecutionTurns,
        concurrency,
        timeoutMinutes,
        reviewTriggerLabel: (yaml.reviewTriggerLabel as string) ?? "Critter Review",
        reviewModel: (yaml.reviewModel as string) ?? "opus",
        maxReviewTurns,
        reviewConcurrency,
        reviewTimeoutMinutes,
      } as Config;
      critterTypes = synthesizeDefaultTypes(partialConfig);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  // Phase-level warnings
  for (const ct of critterTypes) {
    const typeName = ct.name;
    for (const phase of ct.phases) {
      if (phase.model === "haiku") {
        warnings.push(`Haiku model in phase '${phase.name}' (type '${typeName}') may produce unreliable results (see docs)`);
      }
      if (phase.maxTurns < 5) {
        warnings.push(`Low maxTurns (${phase.maxTurns}) in phase '${phase.name}' (type '${typeName}') may not give Claude enough room to work`);
      }
    }
  }

  // Validate skill file paths
  for (const ct of critterTypes) {
    for (const phase of ct.phases) {
      if (phase.skills) {
        for (const skillRef of phase.skills) {
          const filePath = skillRef.startsWith("~")
            ? join(homedir(), skillRef.slice(1))
            : skillRef;
          if (!existsSync(filePath)) {
            errors.push(`Skill file not found: ${filePath} (type "${ct.name}", phase "${phase.name}")`);
          }
        }
      }
    }
  }

  // Validate MCP config
  const globalMcp = yaml.mcpConfig;
  if (globalMcp !== undefined) {
    if (typeof globalMcp !== "string" && !Array.isArray(globalMcp)) {
      errors.push("mcpConfig must be a string or array of strings");
    }
  }
  if (yaml.strictMcpConfig !== undefined && typeof yaml.strictMcpConfig !== "boolean") {
    errors.push("strictMcpConfig must be a boolean");
  }

  const mcpPaths: string[] = [];
  if (typeof globalMcp === "string") mcpPaths.push(globalMcp);
  else if (Array.isArray(globalMcp)) mcpPaths.push(...globalMcp as string[]);

  for (const ct of critterTypes) {
    if (ct.mcpConfig) {
      const paths = Array.isArray(ct.mcpConfig) ? ct.mcpConfig : [ct.mcpConfig];
      mcpPaths.push(...paths);
    }
  }

  for (const mcpPath of mcpPaths) {
    const filePath = mcpPath.startsWith("~")
      ? join(homedir(), mcpPath.slice(1))
      : mcpPath;
    if (!existsSync(filePath)) {
      warnings.push(`MCP config file not found: ${filePath} (may exist at runtime)`);
    }
  }

  // Check provider credentials
  const provider = (yaml.provider as string) ?? "linear";
  const credErrors = checkProviderCredentials(critterTypes, provider, {
    linearApiKey: process.env.LINEAR_API_KEY || undefined,
    jiraHost: process.env.JIRA_HOST || undefined,
    jiraEmail: process.env.JIRA_EMAIL || undefined,
    jiraApiToken: process.env.JIRA_API_TOKEN || undefined,
  });
  errors.push(...credErrors);

  const summary = errors.length === 0
    ? `Config valid: ${critterTypes.length} critter type(s), provider: ${provider}${warnings.length > 0 ? ` (${warnings.length} warning(s))` : ""}`
    : undefined;

  return { errors, warnings, summary };
}

export async function runValidate(configPath?: string): Promise<void> {
  try {
    const result = validateConfigFile(configPath);

    if (result.warnings.length > 0) {
      console.log(`\n\x1b[33m${result.warnings.length} warning(s):\x1b[0m\n`);
      for (let i = 0; i < result.warnings.length; i++) {
        console.log(`  \x1b[33mWARN:\x1b[0m ${result.warnings[i]}`);
      }
    }

    if (result.errors.length > 0) {
      console.error(`\n\x1b[31m${result.errors.length} error(s):\x1b[0m\n`);
      for (let i = 0; i < result.errors.length; i++) {
        console.error(`  \x1b[31mERROR:\x1b[0m ${result.errors[i]}`);
      }
      process.exit(1);
    }

    if (result.summary) {
      console.log(result.summary);
    }
  } catch (e) {
    console.error(`\x1b[31mERROR:\x1b[0m ${(e as Error).message}`);
    process.exit(1);
  }
}
