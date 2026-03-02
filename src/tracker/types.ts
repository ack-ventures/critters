import type { TriggerConfig } from "../critter-type.js";

export interface IssueTracker {
  readonly provider: string;
  init(): Promise<void>;
  findIssues(trigger: TriggerConfig): Promise<TrackerTask[]>;
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
}
