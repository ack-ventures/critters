import type { TriggerConfig } from "../critter-type.js";
import { log, logError, logTaskError } from "../logger.js";
import { withRetry } from "../retry.js";
import type { IssueTracker, IssueTrackerIssue, TrackerTask } from "./types.js";

/**
 * Jira Cloud tracker implementation using REST API v3.
 */
export class JiraTracker implements IssueTracker {
  readonly provider = "jira";
  private baseUrl: string;
  private authHeader: string;
  private statusMap: Record<string, string>;

  constructor(
    host: string,
    email: string,
    apiToken: string,
    statusMap?: Record<string, string>,
  ) {
    this.baseUrl = `https://${host}/rest/api/3`;
    this.authHeader = `Basic ${btoa(`${email}:${apiToken}`)}`;
    this.statusMap = statusMap ?? {};
  }

  async init(): Promise<void> {
    const resp = await this.request("/myself");
    const user = (await resp.json()) as { displayName: string; emailAddress: string };
    log(`Connected to Jira as ${user.displayName} (${user.emailAddress})`);
  }

  async findIssues(trigger: TriggerConfig): Promise<TrackerTask[]> {
    return withRetry(
      async () => {
        const statusName = this.mapStatusName(trigger.status);
        let jql = `labels = "${trigger.label}" AND status = "${statusName}"`;
        if (trigger.assignee) {
          const assigneeValue = trigger.assignee === "me" ? "currentUser()" : `"${trigger.assignee}"`;
          jql += ` AND assignee = ${assigneeValue}`;
        }
        const resp = await this.request(
          `/search?jql=${encodeURIComponent(jql)}&expand=renderedFields&fields=summary,description,labels,project,issuelinks`,
        );
        const data = (await resp.json()) as JiraSearchResponse;

        const tasks: TrackerTask[] = [];
        for (const issue of data.issues ?? []) {
          const description = extractPlainText(issue.renderedFields?.description ?? "") ||
            adfToPlainText(issue.fields.description);

          // Find blockers from issue links
          const blockedBy: { identifier: string; status: string }[] = [];
          for (const link of issue.fields.issuelinks ?? []) {
            if (link.type.inward === "is blocked by" && link.inwardIssue) {
              const blockerStatus = link.inwardIssue.fields?.status?.name;
              if (blockerStatus && blockerStatus !== "Done" && blockerStatus !== "Closed" && blockerStatus !== "Resolved") {
                blockedBy.push({
                  identifier: link.inwardIssue.key,
                  status: blockerStatus,
                });
              }
            }
          }

          tasks.push({
            id: issue.id,
            identifier: issue.key,
            title: issue.fields.summary,
            description,
            repoUrl: "",
            group: issue.fields.project.name,
            groupId: issue.fields.project.key,
            projectId: issue.fields.project.id,
            labels: issue.fields.labels ?? [],
            ...(blockedBy.length > 0 ? { blockedBy } : {}),
          });
        }

        return tasks;
      },
      {
        maxRetries: 3,
        baseDelayMs: 2000,
        onRetry: (_error, attempt, delayMs) => {
          log(`findIssues (Jira) failed, retrying in ${Math.round(delayMs)}ms... (attempt ${attempt + 1}/3)`);
        },
      },
    );
  }

  async findIssueByIdentifier(identifier: string): Promise<IssueTrackerIssue | null> {
    try {
      const resp = await this.request(`/issue/${encodeURIComponent(identifier)}?fields=status,labels,project`);
      const issue = (await resp.json()) as JiraIssue;
      return {
        id: issue.id,
        identifier: issue.key,
        statusName: issue.fields.status?.name ?? "Unknown",
        labels: issue.fields.labels ?? [],
        groupId: issue.fields.project.key,
      };
    } catch {
      return null;
    }
  }

  async updateStatus(taskId: string, statusName: string, _groupId: string): Promise<void> {
    const targetStatus = this.mapStatusName(statusName);

    // Get available transitions
    const resp = await this.request(`/issue/${taskId}/transitions`);
    const data = (await resp.json()) as { transitions: JiraTransition[] };

    const transition = data.transitions.find(
      (t) => t.name.toLowerCase() === targetStatus.toLowerCase() ||
        t.to.name.toLowerCase() === targetStatus.toLowerCase(),
    );

    if (!transition) {
      const available = data.transitions.map((t) => `${t.name} → ${t.to.name}`).join(", ");
      logError(`Jira: No transition to "${targetStatus}" for issue ${taskId}. Available: ${available}`);
      return;
    }

    await this.request(`/issue/${taskId}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: transition.id } }),
    });
  }

  async comment(taskId: string, body: string): Promise<void> {
    await this.request(`/issue/${taskId}/comment`, {
      method: "POST",
      body: JSON.stringify({
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: body }],
            },
          ],
        },
      }),
    });
  }

  async getComments(taskId: string): Promise<string[]> {
    const resp = await this.request(`/issue/${taskId}/comment`);
    const data = (await resp.json()) as { comments: JiraComment[] };
    return (data.comments ?? []).map((c) => adfToPlainText(c.body));
  }

  async uploadAttachment(
    taskId: string,
    filename: string,
    content: Buffer,
    contentType: string,
    identifier?: string,
  ): Promise<string | null> {
    const logErr = identifier
      ? (msg: string) => logTaskError(identifier, msg)
      : (msg: string) => logError(msg);

    try {
      const formData = new FormData();
      formData.append("file", new Blob([new Uint8Array(content)], { type: contentType }), filename);

      const resp = await fetch(`${this.baseUrl}/issue/${taskId}/attachments`, {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "X-Atlassian-Token": "no-check",
        },
        body: formData,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        logErr(`Jira attachment upload failed: HTTP ${resp.status}${text ? ` — ${text}` : ""}`);
        return null;
      }

      const attachments = (await resp.json()) as Array<{ content: string }>;
      return attachments[0]?.content ?? null;
    } catch (err) {
      logErr(`Jira attachment upload failed: ${err}`);
      return null;
    }
  }

  async ensureStatus(_groupId: string, name: string): Promise<void> {
    // Jira statuses are workflow-managed and can't be created via API
    log(`Jira: Status "${name}" is managed by Jira workflow — skipping creation`);
  }

  async ensureLabel(_name: string): Promise<void> {
    // Jira labels are auto-created when applied to issues — no action needed
  }

  /**
   * Map internal critter status name to Jira status name using the configured statusMap.
   */
  private mapStatusName(name: string): string {
    return this.statusMap[name] ?? name;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Jira API error: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`);
    }

    return resp;
  }
}

// ── Jira API types ──────────────────────────────────────────────────────────

interface JiraSearchResponse {
  issues: JiraIssue[];
  total: number;
}

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: unknown; // ADF format
    labels: string[];
    project: { id: string; key: string; name: string };
    status?: { name: string };
    issuelinks?: JiraIssueLink[];
  };
  renderedFields?: {
    description?: string; // HTML
  };
}

interface JiraIssueLink {
  type: { name: string; inward: string; outward: string };
  inwardIssue?: { key: string; fields?: { status?: { name: string } } };
  outwardIssue?: { key: string; fields?: { status?: { name: string } } };
}

interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

interface JiraComment {
  body: unknown; // ADF format
}

// ── ADF / HTML helpers ──────────────────────────────────────────────────────

/**
 * Strip HTML tags to extract plain text (used for renderedFields).
 */
function extractPlainText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Convert Jira's ADF (Atlassian Document Format) to plain text.
 * Handles basic node types — paragraphs, text, code blocks, lists.
 */
function adfToPlainText(adf: unknown): string {
  if (!adf || typeof adf !== "object") return "";
  const node = adf as { type?: string; text?: string; content?: unknown[] };

  if (node.type === "text") return node.text ?? "";

  const children = (node.content ?? []).map(adfToPlainText);

  switch (node.type) {
    case "paragraph":
      return `${children.join("")}\n`;
    case "hardBreak":
      return "\n";
    case "codeBlock":
      return `\`\`\`\n${children.join("")}\n\`\`\`\n`;
    case "listItem":
      return `- ${children.join("").trim()}\n`;
    case "bulletList":
    case "orderedList":
      return children.join("");
    case "heading":
      return `${"#".repeat((adf as { attrs?: { level?: number } }).attrs?.level ?? 1)} ${children.join("")}\n`;
    default:
      return children.join("");
  }
}

export { adfToPlainText, extractPlainText };
