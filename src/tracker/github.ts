import type { TriggerConfig } from "../critter-type.js";
import { log, logError, logTaskError } from "../logger.js";
import { withRetry } from "../retry.js";
import { isPermanentTrackerError } from "../task-retry.js";
import type { CreatedIssue, CreateIssueInput, IssueTracker, IssueTrackerIssue, TrackerTask, TrackerTeam } from "./types.js";

/** Single seam for a future GitHub Enterprise `host` config. */
const API_BASE = "https://api.github.com";
/** Cap on issues paginated through per repo in a single findIssues call. */
const MAX_PAGINATED_ISSUES = 200;
const STATUS_LABEL_PREFIX = "status:";
const DEFAULT_STATUS_FIELD = "Status";

export const GITHUB_IDENTIFIER_RE = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/;

export function parseGitHubIdentifier(id: string): { owner: string; repo: string; number: number } | null {
  const match = id.match(GITHUB_IDENTIFIER_RE);
  if (!match) return null;
  const [owner, repo] = match[1].split("/");
  return { owner, repo, number: Number.parseInt(match[2], 10) };
}

export interface GitHubTrackerOptions {
  /** Name of the org-level single_select issue field used for statuses. Default "Status". */
  statusField?: string;
  /** Internal critter status name -> GitHub option/label name. */
  statusMap?: Record<string, string>;
  /** Critter statusType ("unstarted" | "started" | ...) -> GitHub option/label names. */
  statusTypes?: Record<string, string[]>;
}

export type GitHubRepoMode =
  | { kind: "field"; org: string; fieldId: number; fieldName: string; options: GitHubFieldOption[] }
  | { kind: "label" };

interface GitHubFieldOption {
  id?: number;
  name: string;
  description?: string | null;
  color?: string | null;
}

interface GitHubIssueField {
  id: number;
  name: string;
  data_type: string;
  options?: GitHubFieldOption[] | null;
}

interface GitHubIssueFieldValue {
  issue_field_id: number;
  issue_field_name?: string;
  data_type?: string;
  value?: string | number | null;
  single_select_option?: { id?: number; name?: string } | null;
}

interface GitHubIssue {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  labels?: Array<{ name: string } | string>;
  html_url: string;
  updated_at?: string;
  pull_request?: unknown;
  repository_url?: string;
  issue_field_values?: GitHubIssueFieldValue[] | null;
  issue_dependencies_summary?: { blocked_by?: number; blocking?: number } | null;
}

/** Map the hex colors daemon.ts produces to GitHub's option-color enum (lowercase). */
function hexToOptionColor(hex: string): string {
  const map: Record<string, string> = {
    "#EF4444": "red",
    "#F59E0B": "yellow",
    "#8B5CF6": "purple",
  };
  return map[hex.toUpperCase()] ?? map[hex] ?? "gray";
}

/**
 * True when err is one of our own request() errors with the given status.
 * Anchored to the emitted format so a "403"/"404" appearing in the error
 * BODY (e.g. a quoted upstream status) can't false-match a 500.
 */
function isHttpError(err: unknown, ...statuses: number[]): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return new RegExp(`GitHub API error: (?:${statuses.join("|")})\\b`).test(msg);
}

/**
 * GitHub Issues tracker using the REST API (plain fetch, no octokit).
 *
 * Statuses are dual-mode, detected per repo at init():
 * - field mode: org-level single_select issue field (requires the repo to live
 *   in an organization whose fields the token can read);
 * - label mode: `status:<Name>` labels (personal repos, or orgs whose fields
 *   are unreadable — degraded with a warning).
 *
 * Task identity is `owner/repo#N` everywhere (id === identifier).
 */
export class GitHubTracker implements IssueTracker {
  readonly provider = "github";
  private token: string;
  private configuredRepos: string[];
  private statusField: string;
  private statusMap: Record<string, string>;
  private statusTypes: Record<string, string[]>;
  /** Key: "owner/repo" lowercased. Mode is fixed at init — no runtime re-detection. */
  private repoModes = new Map<string, GitHubRepoMode>();
  /** Key: org login. null = org fields unreadable (degraded to label mode). */
  private orgFieldsCache = new Map<string, GitHubIssueField[] | null>();
  private viewerLogin = "";

  constructor(token: string, repos: string[], options?: GitHubTrackerOptions) {
    this.token = token;
    this.configuredRepos = repos;
    this.statusField = options?.statusField ?? DEFAULT_STATUS_FIELD;
    this.statusMap = options?.statusMap ?? {};
    this.statusTypes = options?.statusTypes ?? {};
  }

  async init(): Promise<void> {
    const resp = await this.request("/user");
    const user = (await resp.json()) as { login: string };
    this.viewerLogin = user.login;
    log(`Connected to GitHub as ${user.login}`);

    for (const fullName of this.configuredRepos) {
      const parts = fullName.split("/");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(`GitHub: malformed repo entry "${fullName}" — must match "owner/repo"`);
      }
      const [owner, repo] = parts;

      let repoInfo: { owner: { type: string } };
      try {
        const repoResp = await this.request(`/repos/${owner}/${repo}`);
        repoInfo = (await repoResp.json()) as { owner: { type: string } };
      } catch (err) {
        throw new Error(`GitHub: cannot access configured repo "${fullName}": ${err instanceof Error ? err.message : err}`);
      }

      if (repoInfo.owner.type !== "Organization") {
        this.repoModes.set(fullName.toLowerCase(), { kind: "label" });
        log(`GitHub: ${fullName} — label mode (status:* labels; issue fields require an organization)`);
        continue;
      }

      const fields = await this.getOrgFields(owner);
      const field = fields?.find((f) => f.data_type === "single_select" && f.name === this.statusField);
      if (!fields || !field) {
        if (fields) {
          const available = fields.filter((f) => f.data_type === "single_select").map((f) => f.name);
          log(`GitHub: ${fullName} — label mode (no single_select field named "${this.statusField}" in org ${owner}; available: ${available.join(", ") || "none"})`);
        } else {
          log(`GitHub: ${fullName} — label mode (org fields unreadable)`);
        }
        this.repoModes.set(fullName.toLowerCase(), { kind: "label" });
        continue;
      }

      this.repoModes.set(fullName.toLowerCase(), {
        kind: "field",
        org: owner,
        fieldId: field.id,
        fieldName: field.name,
        options: field.options ?? [],
      });
      log(`GitHub: ${fullName} — field mode (org field "${field.name}" #${field.id})`);
    }

    // Typo guard: warn for statusMap values that don't exist as field options.
    for (const mode of this.repoModes.values()) {
      if (mode.kind !== "field") continue;
      for (const mapped of Object.values(this.statusMap)) {
        if (!mode.options.some((o) => o.name === mapped)) {
          log(`Warning: GitHub statusMap value "${mapped}" is not an option of field "${mode.fieldName}" in org ${mode.org} — status updates to it will no-op until the option is added`);
        }
      }
    }
  }

  private async getOrgFields(org: string): Promise<GitHubIssueField[] | null> {
    const cacheKey = org.toLowerCase();
    if (this.orgFieldsCache.has(cacheKey)) return this.orgFieldsCache.get(cacheKey) ?? null;
    try {
      const resp = await this.request(`/orgs/${org}/issue-fields?per_page=100`);
      const fields = (await resp.json()) as GitHubIssueField[];
      this.orgFieldsCache.set(cacheKey, fields);
      return fields;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isHttpError(err, 403, 404)) {
        // Repo-scoped tokens can't read org fields — degrade to label mode.
        log(`Warning: GitHub: cannot read org issue fields for ${org} — repos in this org will use status:* labels (${msg})`);
        this.orgFieldsCache.set(cacheKey, null);
        return null;
      }
      // 5xx/network: can't determine the mode — fail init rather than misfile statuses.
      throw err;
    }
  }

  async findIssues(trigger: TriggerConfig): Promise<TrackerTask[]> {
    return withRetry(
      async () => {
        const tasks: TrackerTask[] = [];
        for (const fullName of this.configuredRepos) {
          const mode = this.repoModes.get(fullName.toLowerCase()) ?? { kind: "label" as const };
          const issues = await this.listRepoIssues(fullName, trigger);
          for (const issue of issues) {
            // GitHub's issues endpoint also returns PRs — never tasks (I9).
            if (issue.pull_request) continue;
            if (!this.matchesTrigger(issue, mode, trigger)) continue;
            const blockedBy = await this.fetchBlockedBy(fullName, issue);
            tasks.push(this.toTask(fullName, issue, blockedBy));
          }
        }
        return tasks;
      },
      {
        maxRetries: 3,
        baseDelayMs: 2000,
        // Fail fast only on definitive client errors (auth, bad request);
        // retry everything else (network failures, rate limits, 5xx).
        shouldRetry: (error) => !isPermanentTrackerError(error instanceof Error ? error.message : String(error)),
        onRetry: (_error, attempt, delayMs) => {
          log(`findIssues (GitHub) failed, retrying in ${Math.round(delayMs)}ms... (attempt ${attempt + 1}/3)`);
        },
      },
    );
  }

  private async listRepoIssues(fullName: string, trigger: TriggerConfig): Promise<GitHubIssue[]> {
    const [owner, repo] = fullName.split("/");
    const issues: GitHubIssue[] = [];
    let page = 1;
    let cappedOut = false;
    for (;;) {
      const params = new URLSearchParams({
        labels: trigger.label,
        state: "open",
        per_page: "100",
        page: String(page),
        // Stable ordering so pagination is deterministic across pages.
        sort: "created",
        direction: "asc",
      });
      if (trigger.assignee) {
        params.set("assignee", trigger.assignee === "me" ? this.viewerLogin : trigger.assignee);
      }
      const resp = await this.request(`/repos/${owner}/${repo}/issues?${params}`);
      const batch = (await resp.json()) as GitHubIssue[];
      issues.push(...batch);
      if (batch.length < 100) break;
      if (issues.length >= MAX_PAGINATED_ISSUES) {
        cappedOut = true;
        break;
      }
      page++;
    }
    if (cappedOut) {
      log(`Warning: hit pagination cap of ${MAX_PAGINATED_ISSUES} GitHub issues in ${fullName} — some issues may be skipped`);
    }
    return issues;
  }

  private matchesTrigger(issue: GitHubIssue, mode: GitHubRepoMode, trigger: TriggerConfig): boolean {
    const configuredBucket = trigger.statusType ? this.statusTypes[trigger.statusType] : undefined;
    // An empty bucket array is a config error — treat as unconfigured (exact-name fallback).
    const bucket = configuredBucket && configuredBucket.length > 0 ? configuredBucket : undefined;
    if (mode.kind === "field") {
      const name = this.fieldStatusName(issue, mode);
      if (bucket) return name !== "" && bucket.includes(name);
      return name === this.mapStatusName(trigger.status);
    }
    const names = this.statusLabelNames(issue);
    if (bucket) return names.some((n) => bucket.includes(n));
    return names.includes(this.mapStatusName(trigger.status));
  }

  private async fetchBlockedBy(fullName: string, issue: GitHubIssue): Promise<{ identifier: string; status: string }[]> {
    const count = issue.issue_dependencies_summary?.blocked_by ?? 0;
    if (count <= 0) return [];
    const [owner, repo] = fullName.split("/");
    const resp = await this.request(`/repos/${owner}/${repo}/issues/${issue.number}/dependencies/blocked_by?per_page=100`);
    const blockers = (await resp.json()) as GitHubIssue[];
    const blockedBy: { identifier: string; status: string }[] = [];
    for (const blocker of blockers) {
      if (blocker.state === "closed") continue;
      const blockerRepo = repoFullNameFromIssue(blocker) ?? fullName;
      blockedBy.push({
        identifier: `${blockerRepo}#${blocker.number}`,
        status: this.blockerStatusString(blocker, blockerRepo),
      });
    }
    return blockedBy;
  }

  private blockerStatusString(blocker: GitHubIssue, blockerRepo: string): string {
    const mode = this.repoModes.get(blockerRepo.toLowerCase());
    if (mode?.kind === "field") {
      const name = this.fieldStatusName(blocker, mode);
      if (name) return name;
    }
    return blocker.state;
  }

  private toTask(fullName: string, issue: GitHubIssue, blockedBy: { identifier: string; status: string }[]): TrackerTask {
    const identifier = `${fullName}#${issue.number}`;
    return {
      id: identifier,
      identifier,
      title: issue.title,
      description: issue.body ?? "",
      repoUrl: "",
      group: fullName.split("/")[1],
      groupId: fullName,
      labels: labelNames(issue),
      ...(blockedBy.length > 0 ? { blockedBy } : {}),
      issueUrl: issue.html_url,
      ...(issue.updated_at ? { updatedAt: new Date(issue.updated_at) } : {}),
    };
  }

  async findIssueByIdentifier(identifier: string): Promise<IssueTrackerIssue | null> {
    const parsed = parseGitHubIdentifier(identifier);
    if (!parsed) return null;
    const fullName = `${parsed.owner}/${parsed.repo}`;
    const configured = this.configuredRepos.find((r) => r.toLowerCase() === fullName.toLowerCase());
    if (!configured) return null;
    const mode = this.repoModes.get(configured.toLowerCase()) ?? { kind: "label" as const };
    try {
      const resp = await this.request(`/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`);
      const issue = (await resp.json()) as GitHubIssue;
      const rawStatus = this.reportStatusName(issue, mode);
      // Canonicalize to the configured casing — the watcher's dispatch dedup
      // keys on the exact id string, so webhook/payload casing must not leak.
      const canonical = `${configured}#${parsed.number}`;
      return {
        id: canonical,
        identifier: canonical,
        title: issue.title,
        description: issue.body ?? "",
        // Reverse-map so the webhook compare (issueMatchesTrigger) uses the same
        // internal vocabulary as the poll path (Jira parity).
        statusName: this.reverseMapStatusName(rawStatus),
        statusType: this.statusTypeOf(rawStatus),
        labels: labelNames(issue),
        group: configured.split("/")[1],
        groupId: configured,
        issueUrl: issue.html_url,
        ...(issue.updated_at ? { updatedAt: new Date(issue.updated_at) } : {}),
      };
    } catch {
      return null;
    }
  }

  async updateStatus(taskId: string, statusName: string, _groupId: string, identifier?: string): Promise<void> {
    const logErr = identifier
      ? (msg: string) => logTaskError(identifier, msg)
      : (msg: string) => logError(msg);

    const parsed = parseGitHubIdentifier(taskId);
    if (!parsed) {
      logErr(`GitHub: cannot parse task id "${taskId}" (expected owner/repo#N)`);
      return;
    }
    const fullName = `${parsed.owner}/${parsed.repo}`;
    const mode = this.repoModes.get(fullName.toLowerCase());
    if (!mode) {
      logErr(`GitHub: repo "${fullName}" is not configured — skipping status update`);
      return;
    }
    const mapped = this.mapStatusName(statusName);

    // Never throws: the critter's work outcome matters more than the status write.
    try {
      if (mode.kind === "field") {
        if (!mode.options.some((o) => o.name === mapped)) {
          logErr(`GitHub: status "${mapped}" is not an option of field "${mode.fieldName}" in org ${mode.org} (available: ${mode.options.map((o) => o.name).join(", ") || "none"})`);
          return;
        }
        // POST upserts this one field. NEVER PUT — PUT replaces ALL field
        // values on the issue and would clobber Priority etc.
        await this.request(`/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}/issue-field-values`, {
          method: "POST",
          body: JSON.stringify({ issue_field_values: [{ field_id: mode.fieldId, value: mapped }] }),
        });
      } else {
        await this.updateStatusViaLabels(parsed, mapped);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hint = isHttpError(err, 404) && mode.kind === "field"
        ? ` — field "${mode.fieldName}" may have been deleted from org ${mode.org}; restart to re-detect status mode`
        : "";
      logErr(`GitHub: failed to set status "${mapped}" on ${taskId}: ${msg}${hint}`);
    }
  }

  /** Label-mode status update: ensure the issue carries the target status label and no other. */
  private async updateStatusViaLabels(parsed: { owner: string; repo: string; number: number }, mapped: string): Promise<void> {
    const target = `${STATUS_LABEL_PREFIX}${mapped}`;
    await this.ensureRepoLabel(parsed.owner, parsed.repo, target);

    const resp = await this.request(`/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}/labels?per_page=100`);
    const current = ((await resp.json()) as Array<{ name: string }>).map((l) => l.name);

    if (!current.includes(target)) {
      await this.request(`/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}/labels`, {
        method: "POST",
        body: JSON.stringify({ labels: [target] }),
      });
    }

    for (const label of current) {
      if (!label.startsWith(STATUS_LABEL_PREFIX) || label === target) continue;
      try {
        await this.request(
          `/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}/labels/${encodeURIComponent(label)}`,
          { method: "DELETE" },
        );
      } catch (err) {
        if (!isHttpError(err, 404)) throw err; // 404 = already gone, that's the goal state
      }
    }
  }

  async comment(taskId: string, body: string): Promise<void> {
    const parsed = this.requireParsed(taskId);
    await this.request(`/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  async getComments(taskId: string): Promise<string[]> {
    const parsed = this.requireParsed(taskId);
    const resp = await this.request(`/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}/comments?per_page=100`);
    const data = (await resp.json()) as Array<{ body?: string }>;
    return data.map((c) => c.body ?? "");
  }

  async uploadAttachment(
    _taskId: string,
    _filename: string,
    _content: Buffer,
    _contentType: string,
    _identifier?: string,
  ): Promise<string | null> {
    // GitHub has no official API for uploading issue attachments. Returning
    // null makes the spawner fall back to inline log excerpts.
    return null;
  }

  async getAttachments(_issueId: string): Promise<Array<{ name: string; url: string }>> {
    return [];
  }

  async fetchAttachmentContent(_url: string): Promise<string | null> {
    return null;
  }

  async ensureStatus(groupId: string, name: string, _type = "started", color = "#8B5CF6"): Promise<void> {
    const mode = this.repoModes.get(groupId.toLowerCase());
    if (!mode) {
      logError(`GitHub: ensureStatus for unconfigured repo "${groupId}" — skipping`);
      return;
    }
    const mapped = this.mapStatusName(name);

    if (mode.kind === "field") {
      if (mode.options.some((o) => o.name === mapped)) return;
      try {
        // PATCH replaces the ENTIRE option set: resend existing options with
        // their ids (id-less options would be deleted and recreated), then append.
        // Undefined description/color are omitted entirely — never sent as null.
        const resent = mode.options.map((o) => ({
          id: o.id,
          name: o.name,
          ...(o.description != null ? { description: o.description } : {}),
          ...(o.color != null ? { color: o.color } : {}),
        }));
        await this.request(`/orgs/${mode.org}/issue-fields/${mode.fieldId}`, {
          method: "PATCH",
          body: JSON.stringify({
            options: [...resent, { name: mapped, color: hexToOptionColor(color) }],
          }),
        });
        mode.options.push({ name: mapped, color: hexToOptionColor(color) });
        log(`GitHub: added option "${mapped}" to field "${mode.fieldName}" in org ${mode.org} — note: add it to github.statusTypes if you use statusType triggers`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isHttpError(err, 403)) {
          logError(`GitHub: cannot add option "${mapped}" to field "${mode.fieldName}" in org ${mode.org} (403) — ask your org admin to add it; status updates to it will no-op`);
        } else if (isHttpError(err, 404)) {
          logError(`GitHub: field "${mode.fieldName}" no longer exists in org ${mode.org} (404) — restart to re-detect status mode`);
        } else {
          logError(`GitHub: failed to add option "${mapped}" to field "${mode.fieldName}": ${msg}`);
        }
      }
      return;
    }

    const [owner, repo] = groupId.split("/");
    try {
      await this.ensureRepoLabel(owner, repo, `${STATUS_LABEL_PREFIX}${mapped}`);
      log(`GitHub: ensured label "status:${mapped}" in ${groupId}`);
    } catch (err) {
      logError(`GitHub: failed to create label "status:${mapped}" in ${groupId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  async ensureLabel(name: string): Promise<void> {
    for (const fullName of this.configuredRepos) {
      const [owner, repo] = fullName.split("/");
      try {
        await this.ensureRepoLabel(owner, repo, name);
      } catch (err) {
        // One bad repo must not kill startup or skip the remaining repos.
        logError(`GitHub: failed to ensure label "${name}" in ${fullName}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  /** Create a repo label; 422 already_exists means the goal state is met. */
  private async ensureRepoLabel(owner: string, repo: string, name: string): Promise<void> {
    try {
      await this.request(`/repos/${owner}/${repo}/labels`, {
        method: "POST",
        body: JSON.stringify({ name, color: "8B5CF6" }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already_exists")) return;
      throw err;
    }
  }

  async removeLabel(taskId: string, label: string): Promise<void> {
    const parsed = this.requireParsed(taskId);
    try {
      await this.request(
        `/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}/labels/${encodeURIComponent(label)}`,
        { method: "DELETE" },
      );
    } catch (err) {
      if (isHttpError(err, 404)) return; // already gone — goal state
      throw err;
    }
  }

  async createIssue(input: CreateIssueInput): Promise<CreatedIssue> {
    const configured = this.configuredRepos.find((r) => r.toLowerCase() === input.teamId.toLowerCase());
    if (!configured) {
      throw new Error(`GitHub: cannot create issue in unconfigured repo "${input.teamId}"`);
    }
    const [owner, repo] = configured.split("/");
    // GitHub 422s on unknown labels at issue creation — ensure them first.
    for (const label of input.labelNames) {
      await this.ensureRepoLabel(owner, repo, label);
    }
    const resp = await this.request(`/repos/${owner}/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify({ title: input.title, body: input.description, labels: input.labelNames }),
    });
    const issue = (await resp.json()) as { number: number; html_url: string };
    const identifier = `${configured}#${issue.number}`;
    return { id: identifier, identifier, url: issue.html_url };
  }

  async listTeams(): Promise<TrackerTeam[]> {
    return this.configuredRepos.map((fullName) => ({
      id: fullName,
      name: fullName.split("/")[1],
      key: fullName,
    }));
  }

  /** Map internal critter status name to GitHub option/label name (Jira parity). */
  private mapStatusName(name: string): string {
    return this.statusMap[name] ?? name;
  }

  /** Reverse of {@link mapStatusName}: raw GitHub name back to internal critter name. */
  private reverseMapStatusName(githubName: string): string {
    for (const [internal, github] of Object.entries(this.statusMap)) {
      if (github === githubName) return internal;
    }
    return githubName;
  }

  /** Which configured statusType bucket (if any) contains this raw GitHub status name. */
  private statusTypeOf(rawName: string): string | undefined {
    if (!rawName) return undefined;
    for (const [type, names] of Object.entries(this.statusTypes)) {
      if (names.includes(rawName)) return type;
    }
    return undefined;
  }

  /** Raw GitHub status name of an issue in field mode; "" when unset (unset ≠ "Todo"). */
  private fieldStatusName(issue: GitHubIssue, mode: GitHubRepoMode & { kind: "field" }): string {
    const value = (issue.issue_field_values ?? []).find((v) => v.issue_field_id === mode.fieldId);
    if (!value) return "";
    return value.single_select_option?.name ?? (typeof value.value === "string" ? value.value : "");
  }

  /** All `status:*` label suffixes on an issue (label mode). */
  private statusLabelNames(issue: GitHubIssue): string[] {
    return labelNames(issue)
      .filter((l) => l.startsWith(STATUS_LABEL_PREFIX))
      .map((l) => l.slice(STATUS_LABEL_PREFIX.length));
  }

  /** Status name for reporting: field option, or the alphabetically-first status:* suffix. */
  private reportStatusName(issue: GitHubIssue, mode: GitHubRepoMode): string {
    if (mode.kind === "field") return this.fieldStatusName(issue, mode);
    const names = this.statusLabelNames(issue);
    return names.sort()[0] ?? "";
  }

  private requireParsed(taskId: string): { owner: string; repo: string; number: number } {
    const parsed = parseGitHubIdentifier(taskId);
    if (!parsed) throw new Error(`GitHub: cannot parse task id "${taskId}" (expected owner/repo#N)`);
    return parsed;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const resp = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      },
    });

    if (!resp.ok) {
      // Rate-limit check BEFORE the generic throw. The message must contain NO
      // digits (a retry-after value could literally be "403"), so
      // isPermanentTrackerError returns false and withRetry retries it.
      if (
        (resp.status === 403 || resp.status === 429) &&
        (resp.headers.get("x-ratelimit-remaining") === "0" || resp.headers.get("retry-after"))
      ) {
        throw new Error("GitHub API rate limited (transient)");
      }
      const text = await resp.text().catch(() => "");
      throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`);
    }

    return resp;
  }
}

function labelNames(issue: GitHubIssue): string[] {
  return (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
}

/** "https://api.github.com/repos/{owner}/{repo}" → "owner/repo". */
function repoFullNameFromIssue(issue: GitHubIssue): string | null {
  const url = issue.repository_url;
  if (!url) return null;
  const parts = url.split("/").filter(Boolean);
  return parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : null;
}
