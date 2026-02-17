export interface CritterTask {
  issueId: string;
  identifier: string;
  title: string;
  description: string;
  repoUrl: string;
  teamId: string;
  projectId?: string;
  blockedBy?: { identifier: string; status: string }[];
}

export interface RepoConfig {
  url: string;
  extraAllowedTools?: string[];
}

export interface Config {
  pollIntervalSeconds: number;
  concurrency: number;
  timeoutMinutes: number;
  workDir: string;
  triggerLabel: string;
  maxPlanningTurns: number;
  maxExecutionTurns: number;
  defaultAllowedTools: string[];
  repos: Record<string, RepoConfig>;
  teamRepos: Record<string, string>;
  tmuxSession: string;
  noTmux: boolean;
  planningModel: string;
  executionModel: string;
  reviewTriggerLabel: string;
  reviewModel: string;
  reviewConcurrency: number;
  reviewTimeoutMinutes: number;
  maxReviewTurns: number;
  healthPort: number;
  linearApiKey: string;
  slackWebhookUrl?: string;
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
