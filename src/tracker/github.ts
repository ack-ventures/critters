import type { TriggerConfig } from "../critter-type.js";
import { log, logError, logTaskError } from "../logger.js";
import { withRetry } from "../retry.js";
import type { CreatedIssue, CreateIssueInput, IssueTracker, IssueTrackerIssue, TrackerTask, TrackerTeam } from "./types.js";

const MAX_PAGINATED_ISSUES = 200;
const PER_PAGE = 100;

const DEFAULT_STATUS_LABELS: Record<string, string> = {
  "In Progress": "critter:in-progress",
  "In Review": "critter:in-review",
  "Critter Failed": "critter:failed",
  "Human Review": "critter:human-review",
};

const BLOCKER_RE = /blocked?\s+by\s+(?:(?<fullRef>[\w.-]+\/[\w.-]+)#(?<extNum>\d+)|#(?<localNum>\d+))/gi;

/**
 * GitHub Issues tracker implementation using REST API.
 */
export class GitHubTracker implements IssueTracker {
  readonly provider = "github";
  private token: string;
  private repos: string[];
  private statusLabelMap: Record<string, string>;
  private reverseStatusMap: Record<string, string>;
  private authenticatedUser = "";

  constructor(token: string, repos: string[], statusMap?: Record<string, string>) {
    this.token = token;
    this.repos = repos;
    this.statusLabelMap = { ...DEFAULT_STATUS_LABELS, ...statusMap };
    // Build reverse map: label → status name
    this.reverseStatusMap = {};
    for (const [status, label] of Object.entries(this.statusLabelMap)) {
      this.reverseStatusMap[label] = status;
    }
  }

  async init(): Promise<void> {
    const resp = await this.request("GET", "/user");
    const user = (await resp.json()) as { login: string };
    this.authenticatedUser = user.login;
    log(`Connected to GitHub as ${user.login}`);
  }

  async findIssues(trigger: TriggerConfig): Promise<TrackerTask[]> {
    return withRetry(
      async () => {
        const allTasks: TrackerTask[] = [];

        for (const repo of this.repos) {
          const tasks = await this.findIssuesForRepo(repo, trigger);
          allTasks.push(...tasks);
          if (allTasks.length >= MAX_PAGINATED_ISSUES) {
            log(`Warning: hit pagination cap of ${MAX_PAGINATED_ISSUES} issues — some issues may be skipped`);
            break;
          }
        }

        return allTasks.slice(0, MAX_PAGINATED_ISSUES);
      },
      {
        maxRetries: 3,
        baseDelayMs: 2000,
        onRetry: (_error, attempt, delayMs) => {
          log(`findIssues (GitHub) failed, retrying in ${Math.round(delayMs)}ms... (attempt ${attempt + 1}/3)`);
        },
      },
    );
  }

  async findIssueByIdentifier(identifier: string): Promise<IssueTrackerIssue | null> {
    const parsed = this.parseIdentifier(identifier);
    if (!parsed) return null;

    try {
      const resp = await this.request("GET", `/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`);
      const issue = (await resp.json()) as GitHubIssue;

      const labels = (issue.labels ?? []).map((l) =>
        typeof l === "string" ? l : l.name,
      );

      return {
        id: `${parsed.owner}/${parsed.repo}/${parsed.number}`,
        identifier: `${parsed.owner}/${parsed.repo}#${parsed.number}`,
        statusName: this.resolveStatusName(issue.state, labels),
        labels,
        groupId: `${parsed.owner}/${parsed.repo}`,
      };
    } catch {
      return null;
    }
  }

  async updateStatus(taskId: string, statusName: string, _groupId: string, identifier?: string): Promise<void> {
    const { owner, repo, number } = this.parseTaskId(taskId);
    const logErr = identifier
      ? (msg: string) => logTaskError(identifier, msg)
      : (msg: string) => logError(msg);

    try {
      // Remove all existing status labels
      const allStatusLabels = Object.values(this.statusLabelMap);
      for (const label of allStatusLabels) {
        try {
          await this.request("DELETE", `/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`);
        } catch {
          // Label may not be present — ignore
        }
      }

      if (statusName === "Done" || statusName === "Closed") {
        // Close the issue
        await this.request("PATCH", `/repos/${owner}/${repo}/issues/${number}`, {
          state: "closed",
          state_reason: "completed",
        });
      } else if (statusName === "Cancelled" || statusName === "Canceled") {
        await this.request("PATCH", `/repos/${owner}/${repo}/issues/${number}`, {
          state: "closed",
          state_reason: "not_planned",
        });
      } else {
        // Reopen if closed
        await this.request("PATCH", `/repos/${owner}/${repo}/issues/${number}`, {
          state: "open",
        });

        // Add the new status label if one exists for this status
        const statusLabel = this.statusLabelMap[statusName];
        if (statusLabel) {
          await this.request("POST", `/repos/${owner}/${repo}/issues/${number}/labels`, {
            labels: [statusLabel],
          });
        }
      }
    } catch (err) {
      logErr(`GitHub: Failed to update status of issue ${taskId} to "${statusName}": ${err}`);
    }
  }

  async comment(taskId: string, body: string): Promise<void> {
    const { owner, repo, number } = this.parseTaskId(taskId);
    await this.request("POST", `/repos/${owner}/${repo}/issues/${number}/comments`, { body });
  }

  async getComments(taskId: string): Promise<string[]> {
    const { owner, repo, number } = this.parseTaskId(taskId);
    const comments: string[] = [];
    let page = 1;

    while (true) {
      const resp = await this.request("GET", `/repos/${owner}/${repo}/issues/${number}/comments?per_page=${PER_PAGE}&page=${page}`);
      const data = (await resp.json()) as Array<{ body: string }>;
      for (const c of data) {
        comments.push(c.body ?? "");
      }
      if (data.length < PER_PAGE) break;
      page++;
    }

    return comments;
  }

  async uploadAttachment(
    _taskId: string,
    _filename: string,
    _content: Buffer,
    _contentType: string,
    _identifier?: string,
  ): Promise<string | null> {
    // GitHub Issues doesn't support file attachments via API
    return null;
  }

  async ensureStatus(_groupId: string, _name: string): Promise<void> {
    // GitHub doesn't have workflow states — statuses are tracked via labels
  }

  async ensureLabel(name: string): Promise<void> {
    for (const repo of this.repos) {
      const [owner, repoName] = repo.split("/");
      try {
        await this.request("POST", `/repos/${owner}/${repoName}/labels`, {
          name,
          color: this.getLabelColor(name),
        });
      } catch (err) {
        // 422 = label already exists — that's fine
        const msg = String(err);
        if (!msg.includes("422")) {
          logError(`GitHub: Failed to create label "${name}" in ${repo}: ${err}`);
        }
      }
    }
  }

  async removeLabel(taskId: string, label: string): Promise<void> {
    const { owner, repo, number } = this.parseTaskId(taskId);
    try {
      await this.request("DELETE", `/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`);
    } catch {
      // Label may not be present
    }
  }

  async createIssue(input: CreateIssueInput): Promise<CreatedIssue> {
    // teamId is "owner/repo" for GitHub
    const [owner, repo] = input.teamId.split("/");
    const resp = await this.request("POST", `/repos/${owner}/${repo}/issues`, {
      title: input.title,
      body: input.description,
      labels: input.labelNames,
    });
    const data = (await resp.json()) as { number: number; html_url: string; id: number };
    return {
      id: `${input.teamId}/${data.number}`,
      identifier: `${input.teamId}#${data.number}`,
      url: data.html_url,
    };
  }

  async listTeams(): Promise<TrackerTeam[]> {
    return this.repos.map((repo) => ({
      id: repo,
      name: repo,
      key: repo,
    }));
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async findIssuesForRepo(repo: string, trigger: TriggerConfig): Promise<TrackerTask[]> {
    const [owner, repoName] = repo.split("/");
    const repoUrl = `git@github.com:${repo}.git`;

    // Build query params
    const params = new URLSearchParams({
      labels: trigger.label,
      state: "open",
      per_page: String(PER_PAGE),
    });

    if (trigger.assignee) {
      params.set("assignee", trigger.assignee === "me" ? this.authenticatedUser : trigger.assignee);
    }

    // Paginate
    const allIssues: GitHubIssue[] = [];
    let page = 1;
    while (allIssues.length < MAX_PAGINATED_ISSUES) {
      params.set("page", String(page));
      const resp = await this.request("GET", `/repos/${owner}/${repoName}/issues?${params}`);
      const issues = (await resp.json()) as GitHubIssue[];

      // GitHub's issues endpoint also returns pull requests — filter them out
      for (const issue of issues) {
        if (!issue.pull_request) {
          allIssues.push(issue);
        }
      }

      if (issues.length < PER_PAGE) break;
      page++;
    }

    // Filter by status: for "Todo" status, we want issues that don't have any status labels
    const statusLabels = new Set(Object.values(this.statusLabelMap));
    const tasks: TrackerTask[] = [];

    for (const issue of allIssues) {
      const labels = (issue.labels ?? []).map((l) =>
        typeof l === "string" ? l : l.name,
      );
      const hasStatusLabel = labels.some((l) => statusLabels.has(l));

      // Determine if this issue matches the trigger status
      const statusType = trigger.statusType ?? "unstarted";
      if (statusType === "unstarted" && hasStatusLabel) {
        // Issue already has a status label, meaning it's been picked up — skip
        continue;
      } else if (statusType === "started") {
        // Looking for issues with the specific status label
        const targetLabel = this.statusLabelMap[trigger.status];
        if (targetLabel && !labels.includes(targetLabel)) continue;
      }

      // Parse blockers from body
      const blockedBy = this.parseBlockers(issue.body ?? "", repo);

      tasks.push({
        id: `${owner}/${repoName}/${issue.number}`,
        identifier: `${owner}/${repoName}#${issue.number}`,
        title: issue.title,
        description: issue.body ?? "",
        repoUrl,
        group: repo,
        groupId: repo,
        labels,
        ...(blockedBy.length > 0 ? { blockedBy } : {}),
        issueUrl: issue.html_url,
        ...(issue.updated_at ? { updatedAt: new Date(issue.updated_at) } : {}),
      });
    }

    return tasks;
  }

  private parseBlockers(body: string, currentRepo: string): Array<{ identifier: string; status: string }> {
    const blockers: Array<{ identifier: string; status: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = BLOCKER_RE.exec(body)) !== null) {
      const fullRef = match.groups?.fullRef;
      const extNum = match.groups?.extNum;
      const localNum = match.groups?.localNum;

      if (fullRef && extNum) {
        blockers.push({ identifier: `${fullRef}#${extNum}`, status: "open" });
      } else if (localNum) {
        blockers.push({ identifier: `${currentRepo}#${localNum}`, status: "open" });
      }
    }

    return blockers;
  }

  private resolveStatusName(state: string, labels: string[]): string {
    if (state === "closed") return "Done";

    // Check for status labels
    for (const label of labels) {
      const status = this.reverseStatusMap[label];
      if (status) return status;
    }

    return "Todo";
  }

  private getLabelColor(name: string): string {
    if (name.includes("Failed") || name.includes("failed")) return "E11D48";
    if (name.includes("Review") || name.includes("review")) return "F59E0B";
    if (name.includes("progress")) return "8B5CF6";
    return "6366F1";
  }

  private parseIdentifier(identifier: string): { owner: string; repo: string; number: number } | null {
    // Format: owner/repo#123
    const match = identifier.match(/^(.+?)\/(.+?)#(\d+)$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
  }

  private parseTaskId(taskId: string): { owner: string; repo: string; number: number } {
    // Format: owner/repo/123
    const parts = taskId.split("/");
    if (parts.length !== 3) {
      throw new Error(`Invalid GitHub task ID: ${taskId} (expected owner/repo/number)`);
    }
    return { owner: parts[0], repo: parts[1], number: parseInt(parts[2], 10) };
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const resp = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`);
    }

    return resp;
  }
}

// ── GitHub API types ──────────────────────────────────────────────────────────

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  updated_at: string;
  pull_request?: unknown;
  labels: Array<string | { name: string }>;
}
