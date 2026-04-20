import type { DashboardData } from "../../dashboard-data.js";

export function getAuthHeaders(): Record<string, string> {
  const token = window.__CRITTERS__?.token ?? localStorage.getItem("critters-token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchDashboard(typeFilter: string | null, signal?: AbortSignal): Promise<DashboardData> {
  const qs = typeFilter ? `?type=${encodeURIComponent(typeFilter)}` : "";
  const res = await fetch(`/api/v1/dashboard${qs}`, { headers: getAuthHeaders(), signal });
  if (!res.ok) throw new Error(`dashboard fetch failed: ${res.status}`);
  return res.json() as Promise<DashboardData>;
}

export async function fetchLogTail(identifier: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`/api/logs/${encodeURIComponent(identifier)}?tail=40`, { signal });
  if (!res.ok) throw new Error(`log fetch failed: ${res.status}`);
  return res.text();
}

export async function triggerPoll(): Promise<void> {
  await fetch("/poll", { method: "POST", headers: getAuthHeaders() });
}

export interface MetadataResponse {
  providers: Record<string, { teams: Array<{ id: string; name: string; key: string }> }>;
  critterTypes: Array<{ name: string; triggerLabel: string; triggerStatus: string; provider: string }>;
  repos: Array<{ url: string; label: string }>;
}

export async function fetchMetadata(): Promise<MetadataResponse> {
  const res = await fetch("/api/v1/metadata");
  if (!res.ok) throw new Error(`metadata fetch failed: ${res.status}`);
  return res.json() as Promise<MetadataResponse>;
}

export interface CreateIssueBody {
  provider: string;
  teamId: string;
  title: string;
  description: string;
  critterType: string;
}

export interface CreateIssueResponse {
  success: boolean;
  identifier?: string;
  url?: string;
  error?: string;
}

export async function createIssue(body: CreateIssueBody): Promise<CreateIssueResponse> {
  const res = await fetch("/api/v1/issues", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    localStorage.removeItem("critters-token");
    throw new Error("Unauthorized");
  }
  return res.json() as Promise<CreateIssueResponse>;
}

export async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch("/api/v1/auth-check");
    const data = await res.json() as { required: boolean };
    return data.required;
  } catch {
    return false;
  }
}

export interface IssueData {
  identifier: string;
  title: string;
  critterType: string;
  repo: string;
  branch: string;
  prUrl: string | null;
  issueUrl: string | null;
  isActive: boolean;
  isCompleted: boolean;
  isFailed: boolean;
  startedAt: string | null;
  durationMs: number | null;
  currentPhase: string | null;
  phases: string[];
  cost: {
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  };
  phaseResults: Array<{
    phase: string;
    isRunning: boolean;
    isDone: boolean;
    costUsd: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    numTurns: number | null;
  }>;
  multipleRuns: boolean;
  prStatus: { ciStatus: string; reviewStatus: string } | null;
  noData: boolean;
}

export async function fetchIssueData(identifier: string, signal?: AbortSignal): Promise<IssueData> {
  const res = await fetch(`/api/v1/issue/${encodeURIComponent(identifier)}`, {
    headers: getAuthHeaders(),
    signal,
  });
  if (!res.ok) throw new Error(`issue fetch failed: ${res.status}`);
  return res.json() as Promise<IssueData>;
}

export interface TypeEntry {
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
  stats: {
    total: number;
    succeeded: number;
    failed: number;
    totalCost: number;
    avgCost: number | null;
    avgDuration: number | null;
  };
}

export async function fetchTypes(signal?: AbortSignal): Promise<{ types: TypeEntry[] }> {
  const res = await fetch("/api/v1/types", { headers: getAuthHeaders(), signal });
  if (!res.ok) throw new Error(`types fetch failed: ${res.status}`);
  return res.json();
}

export interface RepoEntry {
  url: string;
  short: string;
  projectId: string | null;
  extraTools: string[];
  runs14d: number;
  successRate: number | null;
  cost14d: number;
  topType: string | null;
}

export async function fetchRepos(signal?: AbortSignal): Promise<{ repos: RepoEntry[] }> {
  const res = await fetch("/api/v1/repos", { headers: getAuthHeaders(), signal });
  if (!res.ok) throw new Error(`repos fetch failed: ${res.status}`);
  return res.json();
}

export interface ModelEntry {
  name: string;
  provider: string;
  runs: number;
  succeeded: number;
  totalCost: number;
  avgCost: number;
  avgDuration: number | null;
  usedBy: string[];
}

export async function fetchModels(signal?: AbortSignal): Promise<{ models: ModelEntry[] }> {
  const res = await fetch("/api/v1/models", { headers: getAuthHeaders(), signal });
  if (!res.ok) throw new Error(`models fetch failed: ${res.status}`);
  return res.json();
}

export interface HooksResponse {
  hooks: Array<{ event: string; cmd: string; enabled: boolean }>;
  webhooks: Array<{ provider: string; endpoint: string; secretSet: boolean }>;
  tunnel: { domain: string | null } | null;
}

export async function fetchHooks(signal?: AbortSignal): Promise<HooksResponse> {
  const res = await fetch("/api/v1/hooks", { headers: getAuthHeaders(), signal });
  if (!res.ok) throw new Error(`hooks fetch failed: ${res.status}`);
  return res.json();
}

export interface EnvStatusResponse {
  envVars: Array<{ key: string; set: boolean; category: string }>;
}

export async function fetchEnvStatus(signal?: AbortSignal): Promise<EnvStatusResponse> {
  const res = await fetch("/api/v1/env-status", { headers: getAuthHeaders(), signal });
  if (!res.ok) throw new Error(`env-status fetch failed: ${res.status}`);
  return res.json();
}

export interface ReleaseEntry {
  version: string;
  date: string;
  current: boolean;
  body: string;
  name: string;
}

export async function fetchReleases(signal?: AbortSignal): Promise<{ current: string; releases: ReleaseEntry[] }> {
  const res = await fetch("/api/v1/releases", { headers: getAuthHeaders(), signal });
  if (!res.ok) throw new Error(`releases fetch failed: ${res.status}`);
  return res.json();
}

declare global {
  interface Window {
    __CRITTERS__?: {
      token?: string | null;
      typeFilter: string | null;
      identifier?: string | null;
    };
  }
}
