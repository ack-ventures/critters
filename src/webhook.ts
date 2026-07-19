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

/**
 * Verify an HMAC-SHA256 signature in constant time.
 *
 * Comparison happens on the decoded *bytes*, not the hex strings, and never
 * throws: a malformed (e.g. odd-length or multi-byte) header decodes to a
 * different byte length and is rejected cleanly with `false` instead of letting
 * `timingSafeEqual` raise a RangeError (which would surface as an HTTP 500
 * rather than a clean 401). A `sha256=` prefix is stripped (Jira sends one,
 * Linear does not).
 */
export function verifyHmacSignature(body: string, header: string, secret: string): boolean {
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"), "hex");
  const providedHex = header.replace(/^sha256=/, "");
  // `Buffer.from(..., "hex")` never throws in Bun — malformed/odd-length hex is
  // silently truncated, so the byte-length compare below is what rejects bad
  // input. The decoded byte lengths must match before timingSafeEqual runs.
  const provided = Buffer.from(providedHex, "hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export function verifyLinearSignature(body: string, signature: string, secret: string): boolean {
  return verifyHmacSignature(body, signature, secret);
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
  return verifyHmacSignature(body, signatureHeader, secret);
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

// ── GitHub Webhooks ──────────────────────────────────────────────────────────

export interface GitHubWebhookPayload {
  action?: string;
  issue?: {
    number: number;
    state?: string;
    labels?: Array<{ name: string }>;
  };
  repository?: {
    full_name: string; // "owner/repo"
  };
}

/**
 * GitHub signs with `X-Hub-Signature-256: sha256=<hex hmac>` — the shared
 * verifier already strips the `sha256=` prefix.
 */
export function verifyGithubSignature(body: string, signatureHeader: string, secret: string): boolean {
  return verifyHmacSignature(body, signatureHeader, secret);
}

/**
 * `issues`-event actions that can change whether an issue matches a trigger.
 * Everything else (`closed`, `assigned`, `deleted`, ...) is ignored. Note that
 * issue-field-value changes emit no webhook event — field-mode status changes
 * made by humans are discovered by regular polling, not webhooks.
 */
const GITHUB_TRIGGER_ACTIONS = new Set(["opened", "labeled", "unlabeled", "reopened", "edited"]);

export function extractGithubWebhookTrigger(
  payload: GitHubWebhookPayload,
  critterTypes: CritterTypeConfig[],
  configuredRepos: string[],
): string | null {
  if (!payload.action || !GITHUB_TRIGGER_ACTIONS.has(payload.action)) return null;

  const fullName = payload.repository?.full_name;
  const issueNumber = payload.issue?.number;
  if (!fullName || issueNumber == null) return null;

  // Closing a GitHub issue doesn't strip labels or field values, so a closed
  // issue can still "match" a trigger — never dispatch on it. (`reopened`
  // events arrive with state "open" and pass.)
  if (payload.issue?.state === "closed") return null;

  // Org-wide webhooks deliver events for every repo — only configured ones
  // may trigger polls (case-insensitive: GitHub repo names are).
  const configured = new Set(configuredRepos.map((r) => r.toLowerCase()));
  if (!configured.has(fullName.toLowerCase())) return null;

  const labelNames = new Set((payload.issue?.labels ?? []).map((l) => l.name));
  const triggerLabels = new Set(critterTypes.map((ct) => ct.trigger.label));
  for (const label of labelNames) {
    if (triggerLabels.has(label)) return `${fullName}#${issueNumber}`;
  }
  return null;
}
