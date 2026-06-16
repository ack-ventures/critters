import type { TriggerConfig } from "../critter-type.js";
import { log, logError, logTaskError } from "../logger.js";
import { withRetry } from "../retry.js";
import { isTransientTaskError } from "../task-retry.js";
import type { CreatedIssue, CreateIssueInput, IssueTracker, IssueTrackerIssue, TrackerTask, TrackerTeam } from "./types.js";

/** Cap on the number of issues paginated through in a single findIssues call. */
const MAX_PAGINATED_ISSUES = 200;

/**
 * Jira Cloud tracker implementation using REST API v3.
 */
export class JiraTracker implements IssueTracker {
  readonly provider = "jira";
  private baseUrl: string;
  private authHeader: string;
  private statusMap: Record<string, string>;
  private host: string;

  constructor(
    host: string,
    email: string,
    apiToken: string,
    statusMap?: Record<string, string>,
  ) {
    this.host = host;
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
        // Stable ordering so pagination is deterministic across pages.
        jql += " ORDER BY created ASC";

        // Page through results via nextPageToken until isLast or the cap is hit.
        const issues: JiraIssue[] = [];
        let nextPageToken: string | undefined;
        let cappedOut = false;
        do {
          const resp = await this.request("/search/jql", {
            method: "POST",
            body: JSON.stringify({
              jql,
              fields: ["summary", "description", "labels", "project", "issuelinks", "updated"],
              expand: "renderedFields",
              maxResults: 100,
              ...(nextPageToken ? { nextPageToken } : {}),
            }),
          });
          const data = (await resp.json()) as JiraSearchResponse;
          for (const issue of data.issues ?? []) issues.push(issue);
          nextPageToken = data.isLast ? undefined : data.nextPageToken;
          if (issues.length >= MAX_PAGINATED_ISSUES) {
            cappedOut = true;
            break;
          }
        } while (nextPageToken);

        if (cappedOut) {
          log(`Warning: hit pagination cap of ${MAX_PAGINATED_ISSUES} Jira issues — some issues may be skipped`);
        }

        const tasks: TrackerTask[] = [];
        for (const issue of issues) {
          const description = extractPlainText(issue.renderedFields?.description ?? "") ||
            adfToPlainText(issue.fields.description);

          // Find blockers from issue links. Gate on the Jira statusCategory
          // ("new" | "indeterminate" | "done") rather than the human-readable
          // status name, so custom "done" status names don't starve dependents.
          // Mirrors LinearTracker's canonical state-type check.
          const blockedBy: { identifier: string; status: string }[] = [];
          for (const link of issue.fields.issuelinks ?? []) {
            if (link.type.inward === "is blocked by" && link.inwardIssue) {
              const blockerStatus = link.inwardIssue.fields?.status;
              if (blockerStatus && blockerStatus.statusCategory?.key !== "done") {
                blockedBy.push({
                  identifier: link.inwardIssue.key,
                  status: blockerStatus.name,
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
            issueUrl: `https://${this.host}/browse/${issue.key}`,
            ...(issue.fields.updated ? { updatedAt: new Date(issue.fields.updated) } : {}),
          });
        }

        return tasks;
      },
      {
        maxRetries: 3,
        baseDelayMs: 2000,
        // Only retry transient failures — non-retryable 4xx (auth, bad JQL)
        // should fail fast instead of burning the full retry budget.
        shouldRetry: (error) => isTransientTaskError(error instanceof Error ? error.message : String(error)),
        onRetry: (_error, attempt, delayMs) => {
          log(`findIssues (Jira) failed, retrying in ${Math.round(delayMs)}ms... (attempt ${attempt + 1}/3)`);
        },
      },
    );
  }

  async findIssueByIdentifier(identifier: string): Promise<IssueTrackerIssue | null> {
    try {
      const resp = await this.request(`/issue/${encodeURIComponent(identifier)}?fields=summary,description,status,labels,project,updated&expand=renderedFields`);
      const issue = (await resp.json()) as JiraIssue;
      const description = extractPlainText(issue.renderedFields?.description ?? "") ||
        adfToPlainText(issue.fields.description);
      return {
        id: issue.id,
        identifier: issue.key,
        title: issue.fields.summary,
        description,
        // Reverse-map the raw Jira status name back to the internal critter
        // status so the webhook compare (issueMatchesTrigger → statusName ===
        // trigger.status) agrees with the poll path, which queries by the
        // forward-mapped name. Both directions use the same statusMap.
        statusName: this.reverseMapStatusName(issue.fields.status?.name ?? "Unknown"),
        labels: issue.fields.labels ?? [],
        group: issue.fields.project.name,
        groupId: issue.fields.project.key,
        projectId: issue.fields.project.id,
        issueUrl: `https://${this.host}/browse/${issue.key}`,
        ...(issue.fields.updated ? { updatedAt: new Date(issue.fields.updated) } : {}),
      };
    } catch {
      return null;
    }
  }

  async updateStatus(taskId: string, statusName: string, _groupId: string, identifier?: string): Promise<void> {
    const targetStatus = this.mapStatusName(statusName);
    const logErr = identifier
      ? (msg: string) => logTaskError(identifier, msg)
      : (msg: string) => logError(msg);

    // Get available transitions
    const resp = await this.request(`/issue/${taskId}/transitions`);
    const data = (await resp.json()) as { transitions: JiraTransition[] };

    const transition = data.transitions.find(
      (t) => t.name.toLowerCase() === targetStatus.toLowerCase() ||
        t.to.name.toLowerCase() === targetStatus.toLowerCase(),
    );

    if (!transition) {
      const available = data.transitions.map((t) => `${t.name} → ${t.to.name}`).join(", ");
      logErr(`Jira: No transition to "${targetStatus}" for issue ${taskId}. Available: ${available}`);
      return;
    }

    try {
      await this.request(`/issue/${taskId}/transitions`, {
        method: "POST",
        body: JSON.stringify({ transition: { id: transition.id } }),
      });
    } catch (err) {
      // Jira workflow rules (e.g. "must be in a sprint") can reject transitions.
      // Log but don't crash — the critter's work matters more than the status update.
      logErr(`Jira: Failed to transition issue ${taskId} to "${targetStatus}": ${err}`);
    }
  }

  async comment(taskId: string, body: string): Promise<void> {
    await this.request(`/issue/${taskId}/comment`, {
      method: "POST",
      body: JSON.stringify({
        body: markdownToAdf(body),
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

  async getAttachments(issueId: string): Promise<Array<{ name: string; url: string }>> {
    try {
      const resp = await this.request(`/issue/${encodeURIComponent(issueId)}?fields=attachment`);
      const data = (await resp.json()) as { fields: { attachment?: Array<{ filename: string; content: string }> } };
      return (data.fields.attachment ?? []).map((a) => ({ name: a.filename, url: a.content }));
    } catch {
      return [];
    }
  }

  async fetchAttachmentContent(url: string): Promise<string | null> {
    try {
      const resp = await fetch(url, {
        headers: { Authorization: this.authHeader },
      });
      if (!resp.ok) return null;
      return await resp.text();
    } catch {
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

  async removeLabel(taskId: string, label: string): Promise<void> {
    await this.request(`/issue/${taskId}`, {
      method: "PUT",
      body: JSON.stringify({ update: { labels: [{ remove: label }] } }),
    });
  }

  async createIssue(input: CreateIssueInput): Promise<CreatedIssue> {
    const resp = await this.request("/issue", {
      method: "POST",
      body: JSON.stringify({
        fields: {
          project: { key: input.teamId },
          summary: input.title,
          description: {
            type: "doc",
            version: 1,
            content: [{
              type: "paragraph",
              content: [{ type: "text", text: input.description }],
            }],
          },
          labels: input.labelNames,
          issuetype: { name: "Task" },
        },
      }),
    });
    const data = (await resp.json()) as { id: string; key: string; self: string };
    return {
      id: data.id,
      identifier: data.key,
      url: `https://${this.host}/browse/${data.key}`,
    };
  }

  async listTeams(): Promise<TrackerTeam[]> {
    const resp = await this.request("/project/search?maxResults=100");
    const data = (await resp.json()) as { values: Array<{ id: string; name: string; key: string }> };
    return (data.values ?? []).map((p) => ({ id: p.key, name: p.name, key: p.key }));
  }

  /**
   * Map internal critter status name to Jira status name using the configured statusMap.
   */
  private mapStatusName(name: string): string {
    return this.statusMap[name] ?? name;
  }

  /**
   * Reverse of {@link mapStatusName}: map a raw Jira status name back to the
   * internal critter status name. Used so issues fetched by identifier report
   * statuses in the same vocabulary the poll path queries with.
   */
  private reverseMapStatusName(jiraName: string): string {
    for (const [internal, jira] of Object.entries(this.statusMap)) {
      if (jira === jiraName) return internal;
    }
    return jiraName;
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
  total?: number;
  /** Cursor for the next page in Jira's enhanced search (/search/jql). */
  nextPageToken?: string;
  /** True when this is the final page of results. */
  isLast?: boolean;
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
    updated?: string;
  };
  renderedFields?: {
    description?: string; // HTML
  };
}

interface JiraLinkedStatus {
  name: string;
  statusCategory?: { key: string };
}

interface JiraIssueLink {
  type: { name: string; inward: string; outward: string };
  inwardIssue?: { key: string; fields?: { status?: JiraLinkedStatus } };
  outwardIssue?: { key: string; fields?: { status?: JiraLinkedStatus } };
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

// ── Markdown → ADF ──────────────────────────────────────────────────────────

interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: Array<{ type: string }>;
}

/**
 * Convert markdown text to Jira ADF (Atlassian Document Format).
 * Handles headings, bullet lists, code blocks, bold, inline code, and paragraphs.
 */
function markdownToAdf(markdown: string): AdfNode {
  const lines = markdown.split("\n");
  const content: AdfNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      content.push({
        type: "codeBlock",
        ...(lang ? { attrs: { language: lang } } : {}),
        content: [{ type: "text", text: codeLines.join("\n") }],
      });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      content.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: parseInlineMarks(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Bullet list
    if (line.match(/^[-*]\s/)) {
      const items: AdfNode[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s/)) {
        items.push({
          type: "listItem",
          content: [{
            type: "paragraph",
            content: parseInlineMarks(lines[i].replace(/^[-*]\s/, "")),
          }],
        });
        i++;
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }

    // Numbered list
    if (line.match(/^\d+\.\s/)) {
      const items: AdfNode[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push({
          type: "listItem",
          content: [{
            type: "paragraph",
            content: parseInlineMarks(lines[i].replace(/^\d+\.\s/, "")),
          }],
        });
        i++;
      }
      content.push({ type: "orderedList", content: items });
      continue;
    }

    // Empty line — skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph
    content.push({
      type: "paragraph",
      content: parseInlineMarks(line),
    });
    i++;
  }

  return { type: "doc", version: 1, content } as AdfNode & { version: number };
}

/**
 * Parse inline markdown marks: **bold**, `code`.
 */
function parseInlineMarks(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  // Match **bold** or `code`
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
  let lastIndex = 0;
  for (
    let match = regex.exec(text);
    match !== null;
    match = regex.exec(text)
  ) {
    // Text before the match
    if (match.index > lastIndex) {
      nodes.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      // Bold
      nodes.push({ type: "text", text: match[2], marks: [{ type: "strong" }] });
    } else if (match[3]) {
      // Inline code
      nodes.push({ type: "text", text: match[3], marks: [{ type: "code" }] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    nodes.push({ type: "text", text: text.slice(lastIndex) });
  }

  // If nothing was parsed, return the raw text
  if (nodes.length === 0 && text.length > 0) {
    nodes.push({ type: "text", text });
  }

  return nodes;
}

export { adfToPlainText, extractPlainText, markdownToAdf };
