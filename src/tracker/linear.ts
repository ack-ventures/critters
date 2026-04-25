import { LinearClient } from "@linear/sdk";
import type { TriggerConfig } from "../critter-type.js";
import { log, logError, logTaskError } from "../logger.js";
import { withRetry } from "../retry.js";
import type { CreatedIssue, CreateIssueInput, IssueTracker, IssueTrackerIssue, TrackerTask, TrackerTeam } from "./types.js";

const MAX_PAGINATED_ISSUES = 200;

async function fetchAllNodes<T>(connection: {
  nodes: T[];
  pageInfo: { hasNextPage: boolean };
  fetchNext(): Promise<unknown>;
}): Promise<T[]> {
  while (connection.pageInfo.hasNextPage && connection.nodes.length < MAX_PAGINATED_ISSUES) {
    await connection.fetchNext();
  }
  if (connection.nodes.length >= MAX_PAGINATED_ISSUES) {
    log(`Warning: hit pagination cap of ${MAX_PAGINATED_ISSUES} issues — some issues may be skipped`);
  }
  return connection.nodes;
}

export class LinearTracker implements IssueTracker {
  readonly provider = "linear";
  private client: LinearClient;
  private apiKey: string;
  private teamStatusCache: Record<string, Record<string, string>> = {};

  constructor(apiKey: string) {
    this.client = new LinearClient({ apiKey });
    this.apiKey = apiKey;
  }

  getClient(): LinearClient {
    return this.client;
  }

  async init(): Promise<void> {
    await this.loadTeamStatuses();
    log("Connected to Linear");
  }

  private async loadTeamStatuses(): Promise<void> {
    const teams = await this.client.teams();
    for (const team of teams.nodes) {
      const states = await team.states();
      const map: Record<string, string> = {};
      for (const state of states.nodes) {
        map[state.name] = state.id;
      }
      this.teamStatusCache[team.id] = map;
      log(`Loaded ${states.nodes.length} statuses for team ${team.name} (${team.key})`);
    }
  }

  async findIssues(trigger: TriggerConfig): Promise<TrackerTask[]> {
    return withRetry(
      async () => {
        // Build filter based on trigger config
        const stateFilter = trigger.statusType
          ? { type: { eq: trigger.statusType } }
          : { name: { eq: trigger.status } };

        const assigneeFilter = trigger.assignee
          ? trigger.assignee === "me"
            ? { assignee: { isMe: { eq: true } } }
            : { assignee: { email: { eq: trigger.assignee } } }
          : {};

        const issueConnection = await this.client.issues({
          filter: {
            labels: { some: { name: { eq: trigger.label } } },
            state: stateFilter,
            ...assigneeFilter,
          },
        });
        const allIssues = await fetchAllNodes(issueConnection);

        const tasks: TrackerTask[] = [];
        for (const issue of allIssues) {
          const team = await issue.team;
          const project = await issue.project;
          if (!team) continue;

          // Fetch blockers via inverse relations
          const relations = await issue.inverseRelations();
          const blockedBy: { identifier: string; status: string }[] = [];

          for (const relation of relations.nodes) {
            if (relation.type === "blocks") {
              const blocker = await relation.issue;
              if (!blocker) continue;
              const blockerState = await blocker.state;
              if (!blockerState) continue;
              if (blockerState.type !== "completed" && blockerState.type !== "canceled") {
                blockedBy.push({
                  identifier: blocker.identifier,
                  status: blockerState.name,
                });
              }
            }
          }

          // Gather labels
          const issueLabels = await issue.labels();
          const labelNames = issueLabels.nodes.map((l) => l.name);

          tasks.push({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description ?? "",
            repoUrl: "",
            group: team.name,
            groupId: team.id,
            projectId: project?.id,
            labels: labelNames,
            ...(blockedBy.length > 0 ? { blockedBy } : {}),
            issueUrl: issue.url,
            updatedAt: issue.updatedAt,
          });
        }

        return tasks;
      },
      {
        maxRetries: 3,
        baseDelayMs: 2000,
        onRetry: (_error, attempt, delayMs) => {
          log(`findIssues failed, retrying in ${Math.round(delayMs)}ms... (attempt ${attempt + 1}/3)`);
        },
      },
    );
  }

  async updateStatus(taskId: string, statusName: string, groupId: string, identifier?: string): Promise<void> {
    const statusId = this.teamStatusCache[groupId]?.[statusName];
    if (!statusId) {
      if (identifier) {
        logTaskError(identifier, `Status "${statusName}" not found for group ${groupId}`);
      } else {
        logError(`Status "${statusName}" not found for group ${groupId}`);
      }
      return;
    }
    await this.client.updateIssue(taskId, { stateId: statusId });
  }

  async comment(taskId: string, body: string): Promise<void> {
    await this.client.createComment({ issueId: taskId, body });
  }

  async getComments(taskId: string): Promise<string[]> {
    const issue = await this.client.issue(taskId);
    const comments = await issue.comments();
    return comments.nodes.map((c) => c.body);
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

    const payload = await this.client.fileUpload(contentType, filename, content.length).catch((err: unknown) => {
      logErr(`fileUpload() failed for ${filename}: ${err}`);
      return null;
    });
    if (!payload) return null;

    const uploadFile = payload.uploadFile;
    if (!uploadFile) {
      logErr(`File upload failed: no uploadFile in payload for ${filename}`);
      return null;
    }

    const headers: Record<string, string> = {};
    for (const h of uploadFile.headers) {
      headers[h.key] = h.value;
    }
    if (!headers["content-type"] && !headers["Content-Type"]) {
      headers["content-type"] = contentType;
    }

    const resp = await fetch(uploadFile.uploadUrl, {
      method: "PUT",
      headers,
      body: new Uint8Array(content),
    }).catch((err: unknown) => {
      logErr(`PUT upload failed for ${filename}: ${err}`);
      return null;
    });
    if (!resp) return null;

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logErr(`PUT upload failed for ${filename}: HTTP ${resp.status} ${resp.statusText}${body ? ` — ${body}` : ""}`);
      return null;
    }

    const attachment = await this.client.createAttachment({
      issueId: taskId,
      url: uploadFile.assetUrl,
      title: filename,
    }).catch((err: unknown) => {
      logErr(`createAttachment() failed for ${filename}: ${err}`);
      return null;
    });
    if (!attachment) return null;

    return uploadFile.assetUrl;
  }

  async getAttachments(issueId: string): Promise<Array<{ name: string; url: string }>> {
    const issue = await this.client.issue(issueId);
    const attachments = await issue.attachments();
    return attachments.nodes
      .filter((a) => a.title && a.url)
      .map((a) => ({ name: a.title, url: a.url }));
  }

  async fetchAttachmentContent(url: string): Promise<string | null> {
    try {
      const resp = await fetch(url, {
        headers: { Authorization: this.apiKey },
      });
      if (!resp.ok) return null;
      return await resp.text();
    } catch {
      return null;
    }
  }

  async ensureStatus(groupId: string, name: string, type = "started", color = "#EF4444"): Promise<void> {
    if (this.teamStatusCache[groupId]?.[name]) return;

    // Find the team to get its name for logging
    const teams = await this.client.teams();
    const team = teams.nodes.find((t) => t.id === groupId);
    const teamName = team?.name ?? groupId;

    log(`Creating "${name}" status for team ${teamName}...`);
    const result = await this.client.createWorkflowState({
      teamId: groupId,
      name,
      type,
      color,
    });
    const state = await result.workflowState;
    if (state) {
      if (!this.teamStatusCache[groupId]) this.teamStatusCache[groupId] = {};
      this.teamStatusCache[groupId][name] = state.id;
      log(`Created "${name}" status for team ${teamName}`);
    }
  }

  async removeLabel(taskId: string, label: string): Promise<void> {
    const issue = await this.client.issue(taskId);
    const labels = await issue.labels();
    const labelToRemove = labels.nodes.find((l) => l.name === label);
    if (!labelToRemove) return;
    const remainingLabelIds = labels.nodes
      .filter((l) => l.id !== labelToRemove.id)
      .map((l) => l.id);
    await this.client.updateIssue(taskId, { labelIds: remainingLabelIds });
  }

  async ensureLabel(labelName: string): Promise<void> {
    const labels = await this.client.issueLabels({
      filter: { name: { eq: labelName } },
    });

    if (labels.nodes.length > 0) {
      log(`Label "${labelName}" already exists`);
      return;
    }

    log(`Creating label "${labelName}"...`);
    const result = await this.client.createIssueLabel({
      name: labelName,
      color: "#8B5CF6",
    });
    const label = await result.issueLabel;
    if (!label) throw new Error(`Failed to create label "${labelName}"`);
    log(`Created label "${labelName}" (${label.id})`);
  }

  async findIssueByIdentifier(identifier: string): Promise<IssueTrackerIssue | null> {
    const match = identifier.match(/^([A-Za-z]+-?)(\d+)$/);
    if (!match) return null;
    const teamKey = match[1].replace(/-$/, "");
    const issueNumber = parseInt(match[2], 10);
    const result = await this.client.issues({
      filter: {
        number: { eq: issueNumber },
        team: { key: { eq: teamKey } },
      },
      first: 1,
    });
    const issue = result.nodes[0];
    if (!issue) return null;

    const state = await issue.state;
    const labels = await issue.labels();
    const team = await issue.team;
    const project = await issue.project;

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? "",
      statusName: state?.name ?? "Unknown",
      statusType: state?.type,
      labels: labels.nodes.map((l) => l.name),
      group: team?.name ?? "",
      groupId: team?.id ?? "",
      projectId: project?.id,
      issueUrl: issue.url,
      updatedAt: issue.updatedAt,
    };
  }

  async listTeams(): Promise<TrackerTeam[]> {
    const teams = await this.client.teams();
    return teams.nodes.map((t) => ({ id: t.id, name: t.name, key: t.key }));
  }

  async createIssue(input: CreateIssueInput): Promise<CreatedIssue> {
    const labelIds: string[] = [];
    for (const labelName of input.labelNames) {
      const labels = await this.client.issueLabels({
        filter: { name: { eq: labelName } },
      });
      if (labels.nodes.length > 0) {
        labelIds.push(labels.nodes[0].id);
      } else {
        const result = await this.client.createIssueLabel({
          name: labelName,
          color: "#8B5CF6",
        });
        const label = await result.issueLabel;
        if (!label) throw new Error(`Failed to create label "${labelName}"`);
        labelIds.push(label.id);
      }
    }

    const result = await this.client.createIssue({
      teamId: input.teamId,
      title: input.title,
      description: input.description,
      labelIds,
    });
    const issue = await result.issue;
    if (!issue) throw new Error("Failed to create issue");
    return { id: issue.id, identifier: issue.identifier, url: issue.url };
  }

  /**
   * Get the internal team status cache. Used by callers that need raw status IDs
   * (e.g. for backward-compat paths).
   */
  getTeamStatusCache(): Record<string, Record<string, string>> {
    return this.teamStatusCache;
  }
}
