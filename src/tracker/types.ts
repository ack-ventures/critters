import type { TriggerConfig } from "../critter-type.js";

export interface IssueTrackerIssue {
  id: string;
  identifier: string;
  statusName: string;
  labels: string[];
  groupId: string;
}

export interface IssueTracker {
  readonly provider: string;
  init(): Promise<void>;
  findIssues(trigger: TriggerConfig): Promise<TrackerTask[]>;
  findIssueByIdentifier(identifier: string): Promise<IssueTrackerIssue | null>;
  updateStatus(taskId: string, statusName: string, groupId: string): Promise<void>;
  comment(taskId: string, body: string): Promise<void>;
  getComments(taskId: string): Promise<string[]>;
  uploadAttachment(
    taskId: string,
    filename: string,
    content: Buffer,
    contentType: string,
    identifier?: string,
  ): Promise<string | null>;
  ensureStatus(groupId: string, name: string, type?: string, color?: string): Promise<void>;
  ensureLabel(name: string): Promise<void>;
  createIssue(input: CreateIssueInput): Promise<CreatedIssue>;
  listTeams(): Promise<TrackerTeam[]>;
}

export interface CreateIssueInput {
  teamId: string;
  title: string;
  description: string;
  labelNames: string[];
}

export interface CreatedIssue {
  id: string;
  identifier: string;
  url: string;
}

export interface TrackerTeam {
  id: string;
  name: string;
  key: string;
}

export interface TrackerTask {
  id: string;
  identifier: string;
  title: string;
  description: string;
  repoUrl: string;
  group: string;
  groupId: string;
  projectId?: string;
  labels: string[];
  blockedBy?: { identifier: string; status: string }[];
  prUrl?: string;
  prNumber?: number;
  prBranch?: string;
}

export interface ProviderConfig {
  type: "linear" | "jira";
  apiKey?: string;
  host?: string;
  email?: string;
  apiToken?: string;
  statusMap?: Record<string, string>;
}
