import { createHmac, timingSafeEqual } from "node:crypto";
import type { CritterTypeConfig } from "./critter-type.js";

// ── Linear Webhooks ──────────────────────────────────────────────────────────

export interface LinearWebhookPayload {
  action: string;
  type: string;
  data: {
    id: string;
    identifier: string;
    labels?: { id: string; name: string }[];
    state?: { name: string; type: string };
    team?: { key: string };
  };
  updatedFrom?: {
    labelIds?: string[];
    stateId?: string;
  };
}

export function verifyLinearSignature(body: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function extractLinearWebhookTrigger(
  payload: LinearWebhookPayload,
  critterTypes: CritterTypeConfig[],
): string | null {
  if (payload.type !== "Issue") return null;
  if (payload.action === "remove") return null;

  const labels = payload.data.labels ?? [];
  const labelNames = new Set(labels.map((l) => l.name));
  const triggerLabels = new Set(critterTypes.map((ct) => ct.trigger.label));

  if (payload.action === "create") {
    for (const label of labelNames) {
      if (triggerLabels.has(label)) return payload.data.identifier;
    }
    return null;
  }

  if (payload.action === "update") {
    // Only trigger on label or status changes
    const hasLabelChange = payload.updatedFrom?.labelIds != null;
    const hasStatusChange = payload.updatedFrom?.stateId != null;
    if (!hasLabelChange && !hasStatusChange) return null;

    for (const label of labelNames) {
      if (triggerLabels.has(label)) return payload.data.identifier;
    }
    return null;
  }

  return null;
}

// ── Jira Webhooks ────────────────────────────────────────────────────────────

export interface JiraWebhookPayload {
  webhookEvent: string;
  issue: {
    id: string;
    key: string;
    fields: {
      labels: string[];
      status: { name: string };
    };
  };
  changelog?: {
    items: Array<{
      field: string;
      fieldtype: string;
      from: string | null;
      fromString: string | null;
      to: string | null;
      toString: string | null;
    }>;
  };
}

export function verifyJiraSignature(body: string, signatureHeader: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const provided = signatureHeader.replace(/^sha256=/, "");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

export function extractJiraWebhookTrigger(
  payload: JiraWebhookPayload,
  critterTypes: CritterTypeConfig[],
): string | null {
  const labels = payload.issue?.fields?.labels ?? [];
  const labelSet = new Set(labels);
  const triggerLabels = new Set(critterTypes.map((ct) => ct.trigger.label));

  if (payload.webhookEvent === "jira:issue_created") {
    for (const label of labelSet) {
      if (triggerLabels.has(label)) return payload.issue.key;
    }
    return null;
  }

  if (payload.webhookEvent === "jira:issue_updated") {
    const changelog = payload.changelog?.items ?? [];
    const hasLabelChange = changelog.some((item) => item.field === "labels");
    const hasStatusChange = changelog.some((item) => item.field === "status");
    if (!hasLabelChange && !hasStatusChange) return null;

    for (const label of labelSet) {
      if (triggerLabels.has(label)) return payload.issue.key;
    }
    return null;
  }

  return null;
}

// ── GitHub Webhooks ─────────────────────────────────────────────────────────

export interface GitHubWebhookPayload {
  action: string;
  issue?: {
    number: number;
    labels: Array<{ name: string }>;
    state: string;
  };
  repository: {
    full_name: string;
  };
}

export function verifyGitHubSignature(body: string, signatureHeader: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const provided = signatureHeader.replace(/^sha256=/, "");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

export function extractGitHubWebhookTrigger(
  payload: GitHubWebhookPayload,
  critterTypes: CritterTypeConfig[],
): string | null {
  if (!payload.issue) return null;

  const labels = payload.issue.labels.map((l) => l.name);
  const labelSet = new Set(labels);
  const triggerLabels = new Set(critterTypes.map((ct) => ct.trigger.label));

  if (payload.action === "opened" || payload.action === "labeled") {
    for (const label of labelSet) {
      if (triggerLabels.has(label)) {
        return `${payload.repository.full_name}#${payload.issue.number}`;
      }
    }
  }

  return null;
}
