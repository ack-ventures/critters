import { LinearClient } from "@linear/sdk";
import { log, logError, logTaskError } from "./logger.js";
import { withRetry } from "./retry.js";
import type { Config, CritterTask, TeamStatuses } from "./types.js";

const MAX_PAGINATED_ISSUES = 200;

let client: LinearClient;

export function initLinear(config: Config): void {
  client = new LinearClient({ apiKey: config.linear.apiKey });
}

export function getClient(): LinearClient {
  return client;
}

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

export async function ensureLabel(labelName: string): Promise<string> {
  const labels = await client.issueLabels({
    filter: { name: { eq: labelName } },
  });

  if (labels.nodes.length > 0) {
    log(`Label "${labelName}" already exists`);
    return labels.nodes[0].id;
  }

  log(`Creating label "${labelName}"...`);
  const result = await client.createIssueLabel({
    name: labelName,
    color: "#8B5CF6",
  });
  const label = await result.issueLabel;
  if (!label) throw new Error(`Failed to create label "${labelName}"`);
  log(`Created label "${labelName}" (${label.id})`);
  return label.id;
}

export async function loadTeamStatuses(): Promise<TeamStatuses> {
  const teamStatuses: TeamStatuses = {};
  const teams = await client.teams();

  for (const team of teams.nodes) {
    const states = await team.states();
    const map: Record<string, string> = {};
    for (const state of states.nodes) {
      map[state.name] = state.id;
    }
    teamStatuses[team.id] = map;
    log(`Loaded ${states.nodes.length} statuses for team ${team.name} (${team.key})`);
  }

  return teamStatuses;
}

export async function ensureCritterFailedStatus(teamStatuses: TeamStatuses): Promise<TeamStatuses> {
  const teams = await client.teams();

  for (const team of teams.nodes) {
    if (!teamStatuses[team.id]?.["Critter Failed"]) {
      log(`Creating "Critter Failed" status for team ${team.name}...`);
      const result = await client.createWorkflowState({
        teamId: team.id,
        name: "Critter Failed",
        type: "started",
        color: "#EF4444",
      });
      const state = await result.workflowState;
      if (state) {
        if (!teamStatuses[team.id]) teamStatuses[team.id] = {};
        teamStatuses[team.id]["Critter Failed"] = state.id;
        log(`Created "Critter Failed" status for team ${team.name}`);
      }
    }
  }

  return teamStatuses;
}

export async function findCritterIssues(triggerLabel: string): Promise<CritterTask[]> {
  return withRetry(
    async () => {
      const issueConnection = await client.issues({
        filter: {
          labels: { some: { name: { eq: triggerLabel } } },
          state: { type: { eq: "unstarted" } },
        },
      });
      const allIssues = await fetchAllNodes(issueConnection);

      const tasks: CritterTask[] = [];
      for (const issue of allIssues) {
        const team = await issue.team;
        const project = await issue.project;
        if (!team) continue;

        // Fetch inverse relations to find issues that block this one.
        // inverseRelations() returns relations where this issue is the relatedIssue (object).
        // A relation with type "blocks" means: relation.issue blocks relation.relatedIssue.
        // So relation.issue is the blocker.
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

        tasks.push({
          issueId: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description ?? "",
          repoUrl: "",
          teamId: team.id,
          projectId: project?.id,
          ...(blockedBy.length > 0 ? { blockedBy } : {}),
        });
      }

      return tasks;
    },
    {
      maxRetries: 3,
      baseDelayMs: 2000,
      onRetry: (_error, attempt, delayMs) => {
        log(`findCritterIssues failed, retrying in ${Math.round(delayMs)}ms... (attempt ${attempt + 1}/3)`);
      },
    },
  );
}

export async function findReviewIssues(reviewLabel: string): Promise<CritterTask[]> {
  return withRetry(
    async () => {
      const issueConnection = await client.issues({
        filter: {
          labels: { some: { name: { eq: reviewLabel } } },
          state: { name: { eq: "In Review" } },
        },
      });
      const allIssues = await fetchAllNodes(issueConnection);

      const tasks: CritterTask[] = [];
      for (const issue of allIssues) {
        const team = await issue.team;
        const project = await issue.project;
        if (!team) continue;

        tasks.push({
          issueId: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description ?? "",
          repoUrl: "",
          teamId: team.id,
          projectId: project?.id,
        });
      }

      return tasks;
    },
    {
      maxRetries: 3,
      baseDelayMs: 2000,
      onRetry: (_error, attempt, delayMs) => {
        log(`findReviewIssues failed, retrying in ${Math.round(delayMs)}ms... (attempt ${attempt + 1}/3)`);
      },
    },
  );
}

export async function getIssueByIdentifier(identifier: string) {
  // identifier is e.g. "ACK-101" — parse into team key + issue number
  const match = identifier.match(/^([A-Za-z]+-?)(\d+)$/);
  if (!match) return null;
  const teamKey = match[1].replace(/-$/, "");
  const issueNumber = parseInt(match[2], 10);
  const result = await client.issues({
    filter: {
      number: { eq: issueNumber },
      team: { key: { eq: teamKey } },
    },
    first: 1,
  });
  return result.nodes[0] ?? null;
}

export async function getIssueComments(issueId: string): Promise<string[]> {
  const issue = await client.issue(issueId);
  const comments = await issue.comments();
  return comments.nodes.map((c) => c.body);
}

export async function ensureHumanReviewStatus(teamStatuses: TeamStatuses): Promise<TeamStatuses> {
  const teams = await client.teams();

  for (const team of teams.nodes) {
    if (!teamStatuses[team.id]?.["Human Review"]) {
      log(`Creating "Human Review" status for team ${team.name}...`);
      const result = await client.createWorkflowState({
        teamId: team.id,
        name: "Human Review",
        type: "started",
        color: "#F59E0B",
      });
      const state = await result.workflowState;
      if (state) {
        if (!teamStatuses[team.id]) teamStatuses[team.id] = {};
        teamStatuses[team.id]["Human Review"] = state.id;
        log(`Created "Human Review" status for team ${team.name}`);
      }
    }
  }

  return teamStatuses;
}

export async function updateIssueStatus(
  issueId: string,
  statusId: string,
): Promise<void> {
  await client.updateIssue(issueId, { stateId: statusId });
}

export async function commentOnIssue(
  issueId: string,
  body: string,
): Promise<void> {
  await client.createComment({ issueId, body });
}

export async function uploadFileToIssue(
  issueId: string,
  filename: string,
  content: Buffer,
  contentType: string,
  identifier?: string,
): Promise<string | null> {
  const logErr = identifier
    ? (msg: string) => logTaskError(identifier, msg)
    : (msg: string) => logError(msg);

  const payload = await client.fileUpload(contentType, filename, content.length).catch((err: unknown) => {
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

  const attachment = await client.createAttachment({
    issueId,
    url: uploadFile.assetUrl,
    title: filename,
  }).catch((err: unknown) => {
    logErr(`createAttachment() failed for ${filename}: ${err}`);
    return null;
  });
  if (!attachment) return null;

  return uploadFile.assetUrl;
}
