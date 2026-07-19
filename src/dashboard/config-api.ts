import type { CritterTypeConfig } from "../critter-type.js";
import { getRecentMetrics, type MetricEvent } from "../metrics.js";
import { RELEASE_NOTES } from "../release-notes.js";
import type { RepoConfig } from "../types.js";
import { VERSION } from "../version.js";
import { inferType } from "./helpers.js";

interface TypeStats {
  total: number;
  succeeded: number;
  failed: number;
  totalCost: number;
  avgCost: number | null;
  avgDuration: number | null;
}

interface TypeEntry {
  name: string;
  builtin: boolean;
  enabled: boolean;
  provider: string[];
  trigger: { label: string; status: string };
  claimStatus: string | null;
  concurrency: number;
  timeoutMinutes: number;
  costBudget: number | null;
  phases: Array<{
    name: string;
    prompt: string;
    cli: string;
    model: string;
    maxTurns: number;
    tools: string;
    permissionMode: string | null;
    sandbox: string | null;
  }>;
  outcomes: Record<string, { status?: string; comment?: boolean; removeLabel?: boolean }>;
  stats: TypeStats;
}

const BUILTIN_TYPES = new Set(["create", "review"]);

function statsForMetrics(events: MetricEvent[], filter: (m: MetricEvent) => boolean): TypeStats {
  const rows = events.filter(filter);
  const total = rows.length;
  const succeeded = rows.filter(m => m.event === "task_completed" || m.event === "review_completed").length;
  const failed = total - succeeded;
  const totalCost = rows.reduce((s, m) => s + (m.costUsd ?? 0), 0);
  const durs = rows.map(m => m.duration).filter((d): d is number => d != null && !Number.isNaN(d));
  return {
    total,
    succeeded,
    failed,
    totalCost,
    avgCost: total > 0 ? totalCost / total : null,
    avgDuration: durs.length > 0 ? durs.reduce((a, b) => a + b, 0) / durs.length : null,
  };
}

function onlyTaskMetrics(m: MetricEvent): boolean {
  return m.event === "task_completed" || m.event === "task_failed"
      || m.event === "review_completed" || m.event === "review_failed";
}

export function buildTypesResponse(critterTypes: CritterTypeConfig[] | undefined): { types: TypeEntry[] } {
  const metrics = getRecentMetrics(10000).filter(onlyTaskMetrics);
  const types = (critterTypes ?? []).map<TypeEntry>((ct) => {
    const stats = statsForMetrics(metrics, (m) => inferType(m) === ct.name);
    return {
      name: ct.name,
      builtin: BUILTIN_TYPES.has(ct.name),
      enabled: true,
      provider: ct.provider ? [ct.provider] : [],
      trigger: { label: ct.trigger.label, status: ct.trigger.status },
      claimStatus: ct.claimStatus ?? null,
      concurrency: ct.concurrency,
      timeoutMinutes: ct.timeoutMinutes,
      costBudget: ct.costBudget ?? null,
      phases: ct.phases.map((p) => ({
        name: p.name,
        prompt: p.prompt,
        cli: p.cli ?? ct.cli ?? "claude",
        model: p.model,
        maxTurns: p.maxTurns,
        tools: Array.isArray(p.tools) ? p.tools.join(", ") : p.tools,
        permissionMode: p.permissionMode ?? null,
        sandbox: p.sandbox ?? null,
      })),
      outcomes: ct.outcomes,
      stats,
    };
  });
  return { types };
}

interface RepoEntry {
  url: string;
  short: string;
  projectId: string | null;
  extraTools: string[];
  runs14d: number;
  successRate: number | null;
  cost14d: number;
  topType: string | null;
}

function extractShort(url: string): string {
  const m = url.match(/[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (!m) return url;
  const slash = m[1].split("/");
  return slash[slash.length - 1] ?? m[1];
}

function normalizeRepoUrl(url: string): string {
  // Strip protocol and .git suffix so we can match against metric repoUrl values.
  return url.replace(/^(git@|https?:\/\/)/, "").replace(/:([^/])/, "/$1").replace(/\.git$/, "").toLowerCase();
}

export function buildReposResponse(
  repos: Record<string, RepoConfig> | undefined,
  teamRepos: Record<string, string> | undefined,
): { repos: RepoEntry[] } {
  const seen = new Map<string, { url: string; projectId: string | null; extraTools: string[] }>();
  if (repos) {
    for (const [projectId, r] of Object.entries(repos)) {
      const key = normalizeRepoUrl(r.url);
      if (!seen.has(key)) {
        seen.set(key, { url: r.url, projectId, extraTools: r.extraAllowedTools ?? [] });
      }
    }
  }
  if (teamRepos) {
    for (const url of Object.values(teamRepos)) {
      const key = normalizeRepoUrl(url);
      if (!seen.has(key)) {
        seen.set(key, { url, projectId: null, extraTools: [] });
      }
    }
  }

  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const metrics = getRecentMetrics(10000)
    .filter(onlyTaskMetrics)
    .filter(m => new Date(m.timestamp).getTime() >= cutoff);

  const entries: RepoEntry[] = [];
  for (const { url, projectId, extraTools } of seen.values()) {
    const key = normalizeRepoUrl(url);
    const rows = metrics.filter(m => m.repoUrl && normalizeRepoUrl(m.repoUrl) === key);
    const runs14d = rows.length;
    const succeeded = rows.filter(m => m.event === "task_completed" || m.event === "review_completed").length;
    const cost14d = rows.reduce((s, m) => s + (m.costUsd ?? 0), 0);
    const byType = new Map<string, number>();
    for (const r of rows) {
      const t = inferType(r);
      byType.set(t, (byType.get(t) ?? 0) + 1);
    }
    const topType = [...byType.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    entries.push({
      url,
      short: extractShort(url),
      projectId,
      extraTools,
      runs14d,
      successRate: runs14d > 0 ? Math.round((succeeded / runs14d) * 100) : null,
      cost14d,
      topType,
    });
  }
  entries.sort((a, b) => b.runs14d - a.runs14d);
  return { repos: entries };
}

interface ModelEntry {
  name: string;
  provider: string;
  runs: number;
  succeeded: number;
  totalCost: number;
  avgCost: number;
  avgDuration: number | null;
  usedBy: string[];
}

function providerFor(model: string): string {
  if (/^gpt|^codex|^o\d/i.test(model)) return "codex";
  return "anthropic";
}

export function buildModelsResponse(critterTypes: CritterTypeConfig[] | undefined): { models: ModelEntry[] } {
  // Aggregate from phase configs to find usedBy, and from metrics to find actual runs.
  const usage = new Map<string, Set<string>>();
  for (const ct of critterTypes ?? []) {
    for (const p of ct.phases) {
      const key = p.model;
      let set = usage.get(key);
      if (!set) {
        set = new Set();
        usage.set(key, set);
      }
      set.add(`${ct.name}.${p.name}`);
    }
  }

  // We don't have per-event model yet; infer from phase + critter-type by falling back to "opus" default.
  // Until MetricEvent has `model`, show per-type usage from config only with zeroed runs.
  const models: ModelEntry[] = [];
  for (const [name, usedBy] of usage) {
    models.push({
      name,
      provider: providerFor(name),
      runs: 0,
      succeeded: 0,
      totalCost: 0,
      avgCost: 0,
      avgDuration: null,
      usedBy: [...usedBy],
    });
  }
  models.sort((a, b) => a.name.localeCompare(b.name));
  return { models };
}

interface HooksResponse {
  hooks: Array<{ event: string; cmd: string; enabled: boolean }>;
  webhooks: Array<{ provider: string; endpoint: string; secretSet: boolean }>;
  tunnel: { domain: string | null } | null;
}

export function buildHooksResponse(
  webhookConfig: { linearWebhookSecret?: string; jiraWebhookSecret?: string; githubWebhookSecret?: string } | undefined,
  rawConfigHooks?: Record<string, string>,
  tunnelDomain?: string,
): HooksResponse {
  const known = [
    "onTaskStarted",
    "onPrCreated",
    "onMerged",
    "onTaskFailed",
    "onReviewStarted",
    "onNeedsChanges",
    "onPlanningCompleted",
    "onExecutionStarted",
  ];
  const hooks = known.map((event) => {
    const cmd = rawConfigHooks?.[event] ?? "";
    return { event, cmd, enabled: Boolean(cmd) };
  });
  const webhooks = [
    { provider: "linear", endpoint: "/webhook/linear", secretSet: Boolean(webhookConfig?.linearWebhookSecret) },
    { provider: "jira", endpoint: "/webhook/jira", secretSet: Boolean(webhookConfig?.jiraWebhookSecret) },
    { provider: "github", endpoint: "/webhook/github", secretSet: Boolean(webhookConfig?.githubWebhookSecret) },
  ];
  return {
    hooks,
    webhooks,
    tunnel: tunnelDomain ? { domain: tunnelDomain } : null,
  };
}

interface EnvVarEntry {
  key: string;
  set: boolean;
  category: string;
}

const KNOWN_ENV_VARS: Array<{ key: string; category: string }> = [
  { key: "LINEAR_API_KEY", category: "linear" },
  { key: "LINEAR_WEBHOOK_SECRET", category: "linear" },
  { key: "JIRA_HOST", category: "jira" },
  { key: "JIRA_EMAIL", category: "jira" },
  { key: "JIRA_API_TOKEN", category: "jira" },
  { key: "JIRA_WEBHOOK_SECRET", category: "jira" },
  { key: "CLAUDE_CODE_OAUTH_TOKEN", category: "claude" },
  { key: "ANTHROPIC_API_KEY", category: "claude" },
  { key: "GITHUB_TOKEN", category: "github" },
  { key: "GITHUB_WEBHOOK_SECRET", category: "github" },
  { key: "SLACK_BOT_TOKEN", category: "slack" },
  { key: "SLACK_CHANNEL", category: "slack" },
  { key: "SLACK_WEBHOOK_URL", category: "slack" },
  { key: "DASHBOARD_TOKEN", category: "dashboard" },
  { key: "NGROK_AUTHTOKEN", category: "tunnel" },
];

export function buildEnvStatusResponse(): { envVars: EnvVarEntry[] } {
  const envVars = KNOWN_ENV_VARS.map(({ key, category }) => ({
    key,
    set: Boolean(process.env[key]),
    category,
  }));
  return { envVars };
}

interface ReleaseEntry {
  version: string;
  date: string;
  current: boolean;
  body: string;
  name: string;
}

export function buildReleasesResponse(): { current: string; releases: ReleaseEntry[] } {
  const releases: ReleaseEntry[] = RELEASE_NOTES.map((r) => ({
    version: r.tag.replace(/^v/, ""),
    date: r.date,
    current: r.tag === `v${VERSION}`,
    name: r.name,
    body: r.body,
  }));
  return { current: VERSION, releases };
}
