import type { CritterTypeConfig } from "./critter-type.js";

export interface CritterTask {
  issueId: string;
  identifier: string;
  title: string;
  description: string;
  repoUrl: string;
  teamId: string;
  projectId?: string;
  blockedBy?: { identifier: string; status: string }[];
  issueUrl?: string;
}

export interface RepoConfig {
  url: string;
  extraAllowedTools?: string[];
  localPath?: string;
}

export interface AutoRetryConfig {
  maxRetries: number;
  baseDelaySeconds: number;
  maxDelaySeconds: number;
}

export interface CircuitBreakerConfig {
  failureThreshold?: number;     // default: 3
  maxBackoffMinutes?: number;    // default: 30
}

export interface AutoUpdateConfig {
  enabled: boolean;
  intervalMinutes: number;
}

export interface TunnelConfig {
  enabled?: boolean;
  auth?: string;       // "user:password" for basic auth
  domain?: string;     // static ngrok domain
}

export interface Config {
  pollIntervalSeconds: number;
  concurrency: number;
  timeoutMinutes: number;
  workDir: string;
  cleanupIntervalMinutes?: number;
  cleanupStaleMinutes?: number;
  triggerLabel: string;
  maxPlanningTurns: number;
  maxExecutionTurns: number;
  defaultAllowedTools: string[];
  repos: Record<string, RepoConfig>;
  teamRepos: Record<string, string>;
  defaultRepo?: string;
  tmuxSession: string;
  branchPrefix: string;
  noTmux: boolean;
  jsonLogs?: boolean;
  planningModel: string;
  executionModel: string;
  reviewTriggerLabel: string;
  reviewModel: string;
  reviewConcurrency: number;
  reviewTimeoutMinutes: number;
  maxReviewTurns: number;
  maxLogSizeMb: number;
  minDiskSpaceMb: number;
  healthPort: number;
  dashboardToken?: string;
  metricsRetentionDays: number;
  linearApiKey?: string;
  jiraHost?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  jiraStatusMap?: Record<string, string>;
  githubToken?: string;
  githubRepos?: string[];
  githubWebhookSecret?: string;
  slackWebhookUrl?: string;
  slackBotToken?: string;
  slackChannel?: string;
  costAlertThreshold?: number;
  costBudget?: number;
  hooks?: {
    onTaskStarted?: string;
    onPrCreated?: string;
    onTaskFailed?: string;
    onReviewStarted?: string;
    onMerged?: string;
    onNeedsChanges?: string;
    onPlanningCompleted?: string;
    onExecutionStarted?: string;
  };
  autoRetry?: AutoRetryConfig;
  autoUpdate?: AutoUpdateConfig;
  tunnel?: TunnelConfig;
  circuitBreaker?: CircuitBreakerConfig;
  mcpConfig?: string | string[];
  strictMcpConfig?: boolean;
  linearWebhookSecret?: string;
  jiraWebhookSecret?: string;
  provider: "linear" | "jira" | "github";
  critterTypes: CritterTypeConfig[];
  cli: string;
}

export interface TeamStatusMap {
  [statusName: string]: string; // name → id
}

export interface TeamStatuses {
  [teamId: string]: TeamStatusMap;
}

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
}

export interface CritterResult {
  success: boolean;
  prUrl?: string;
  error?: string;
}

export interface ActiveCritterDetail {
  identifier: string;
  title: string;
  phase: string;        // "plan" | "exec" | "review"
  repo: string;         // short repo name (org/repo)
  branch: string;
  startedAt: number;    // Date.now() timestamp
  prUrl?: string;
  issueUrl?: string;
  timeoutMinutes?: number;
  critterType?: string; // the critter type name (e.g., "create", "review", "code-audit")
  workDir?: string;     // the work directory path for this critter
  costUsd?: number;        // running cost in USD
  costBudget?: number;     // effective cost budget (if configured)
}

export interface ReviewTask extends CritterTask {
  prUrl: string;
  prNumber: number;
  prBranch: string;
}

export interface ReviewResult {
  success: boolean;
  merged?: boolean;
  error?: string;
}
