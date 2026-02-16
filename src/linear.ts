import { LinearClient } from "@linear/sdk";
import { log, logError } from "./logger.js";
import type { Config, CritterTask, TeamStatuses } from "./types.js";

let client: LinearClient;

export function initLinear(config: Config): void {
  client = new LinearClient({ apiKey: config.linearApiKey });
}

export function getClient(): LinearClient {
  return client;
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
  const issues = await client.issues({
    filter: {
      labels: { some: { name: { eq: triggerLabel } } },
      state: { type: { eq: "unstarted" } },
    },
    first: 20,
  });

  const tasks: CritterTask[] = [];
  for (const issue of issues.nodes) {
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
): Promise<string | null> {
  const payload = await client.fileUpload(contentType, filename, content.length);
  const uploadFile = payload.uploadFile;
  if (!uploadFile) {
    logError("File upload failed: no uploadFile in payload");
    return null;
  }

  const headers: Record<string, string> = {};
  for (const h of uploadFile.headers) {
    headers[h.key] = h.value;
  }

  const resp = await fetch(uploadFile.uploadUrl, {
    method: "PUT",
    headers,
    body: new Uint8Array(content),
  });

  if (!resp.ok) {
    logError(`File upload failed: PUT request returned HTTP ${resp.status}`);
    return null;
  }

  await client.createAttachment({
    issueId,
    url: uploadFile.assetUrl,
    title: filename,
  });

  return uploadFile.assetUrl;
}
