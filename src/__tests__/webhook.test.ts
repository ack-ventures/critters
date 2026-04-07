import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { CritterTypeConfig } from "../critter-type.js";
import {
  extractJiraWebhookTrigger,
  extractLinearWebhookTrigger,
  type JiraWebhookPayload,
  type LinearWebhookPayload,
  verifyJiraSignature,
  verifyLinearSignature,
} from "../webhook.js";
import { makeTestCritterType } from "./helpers.js";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

// ── Linear signature verification ────────────────────────────────────────────

describe("verifyLinearSignature", () => {
  const secret = "test-secret";

  test("accepts valid signature", () => {
    const body = '{"type":"Issue","action":"create"}';
    const sig = sign(body, secret);
    expect(verifyLinearSignature(body, sig, secret)).toBe(true);
  });

  test("rejects invalid signature", () => {
    const body = '{"type":"Issue","action":"create"}';
    expect(verifyLinearSignature(body, "invalid-hex-signature-value-here!", secret)).toBe(false);
  });

  test("rejects tampered body", () => {
    const body = '{"type":"Issue","action":"create"}';
    const sig = sign(body, secret);
    expect(verifyLinearSignature(`${body}x`, sig, secret)).toBe(false);
  });

  test("rejects wrong secret", () => {
    const body = '{"type":"Issue"}';
    const sig = sign(body, "wrong-secret");
    expect(verifyLinearSignature(body, sig, secret)).toBe(false);
  });

  test("rejects mismatched length", () => {
    const body = '{"type":"Issue"}';
    expect(verifyLinearSignature(body, "short", secret)).toBe(false);
  });
});

// ── Jira signature verification ──────────────────────────────────────────────

describe("verifyJiraSignature", () => {
  const secret = "jira-secret";

  test("accepts valid signature with sha256= prefix", () => {
    const body = '{"webhookEvent":"jira:issue_created"}';
    const sig = `sha256=${sign(body, secret)}`;
    expect(verifyJiraSignature(body, sig, secret)).toBe(true);
  });

  test("accepts valid signature without prefix", () => {
    const body = '{"webhookEvent":"jira:issue_created"}';
    const sig = sign(body, secret);
    expect(verifyJiraSignature(body, sig, secret)).toBe(true);
  });

  test("rejects invalid signature", () => {
    const body = '{"webhookEvent":"jira:issue_created"}';
    expect(verifyJiraSignature(body, "sha256=bad", secret)).toBe(false);
  });
});

// ── Linear payload parsing ───────────────────────────────────────────────────

describe("extractLinearWebhookTrigger", () => {
  const types = [makeTestCritterType({ trigger: { label: "Critter", status: "Todo" } }), makeTestCritterType({ trigger: { label: "Code Audit", status: "Todo" } })];

  test("issue created with trigger label returns identifier", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Issue",
      data: {
        id: "id-1",
        identifier: "ACK-100",
        labels: [{ id: "l1", name: "Critter" }],
        state: { name: "Todo", type: "unstarted" },
      },
    };
    expect(extractLinearWebhookTrigger(payload, types)).toBe("ACK-100");
  });

  test("label added via update returns identifier", () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "id-2",
        identifier: "ACK-101",
        labels: [{ id: "l1", name: "Code Audit" }],
      },
      updatedFrom: { labelIds: ["old-label"] },
    };
    expect(extractLinearWebhookTrigger(payload, types)).toBe("ACK-101");
  });

  test("status changed with trigger label returns identifier", () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "id-3",
        identifier: "ACK-102",
        labels: [{ id: "l1", name: "Critter" }],
      },
      updatedFrom: { stateId: "old-state" },
    };
    expect(extractLinearWebhookTrigger(payload, types)).toBe("ACK-102");
  });

  test("update without label or status change returns null", () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "id-4",
        identifier: "ACK-103",
        labels: [{ id: "l1", name: "Critter" }],
      },
      updatedFrom: {},
    };
    expect(extractLinearWebhookTrigger(payload, types)).toBeNull();
  });

  test("non-Issue type returns null", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Comment",
      data: { id: "id-5", identifier: "ACK-104" },
    };
    expect(extractLinearWebhookTrigger(payload, types)).toBeNull();
  });

  test("remove action returns null", () => {
    const payload: LinearWebhookPayload = {
      action: "remove",
      type: "Issue",
      data: {
        id: "id-6",
        identifier: "ACK-105",
        labels: [{ id: "l1", name: "Critter" }],
      },
    };
    expect(extractLinearWebhookTrigger(payload, types)).toBeNull();
  });

  test("non-matching label returns null", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Issue",
      data: {
        id: "id-7",
        identifier: "ACK-106",
        labels: [{ id: "l1", name: "Bug" }],
      },
    };
    expect(extractLinearWebhookTrigger(payload, types)).toBeNull();
  });

  test("no labels returns null", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Issue",
      data: { id: "id-8", identifier: "ACK-107" },
    };
    expect(extractLinearWebhookTrigger(payload, types)).toBeNull();
  });
});

// ── Jira payload parsing ─────────────────────────────────────────────────────

describe("extractJiraWebhookTrigger", () => {
  const types = [makeTestCritterType({ trigger: { label: "Critter", status: "Todo" } })];

  test("issue created with trigger label returns key", () => {
    const payload: JiraWebhookPayload = {
      webhookEvent: "jira:issue_created",
      issue: {
        id: "10001",
        key: "PROJ-42",
        fields: {
          labels: ["Critter"],
          status: { name: "To Do" },
        },
      },
    };
    expect(extractJiraWebhookTrigger(payload, types)).toBe("PROJ-42");
  });

  test("issue updated with label change and trigger label returns key", () => {
    const payload: JiraWebhookPayload = {
      webhookEvent: "jira:issue_updated",
      issue: {
        id: "10002",
        key: "PROJ-43",
        fields: {
          labels: ["Critter"],
          status: { name: "To Do" },
        },
      },
      changelog: {
        items: [
          { field: "labels", fieldtype: "jira", from: null, fromString: "", to: null, toString: "Critter" },
        ],
      },
    };
    expect(extractJiraWebhookTrigger(payload, types)).toBe("PROJ-43");
  });

  test("issue updated with status change and trigger label returns key", () => {
    const payload: JiraWebhookPayload = {
      webhookEvent: "jira:issue_updated",
      issue: {
        id: "10003",
        key: "PROJ-44",
        fields: {
          labels: ["Critter"],
          status: { name: "To Do" },
        },
      },
      changelog: {
        items: [
          { field: "status", fieldtype: "jira", from: "1", fromString: "Backlog", to: "2", toString: "To Do" },
        ],
      },
    };
    expect(extractJiraWebhookTrigger(payload, types)).toBe("PROJ-44");
  });

  test("issue updated without label or status change returns null", () => {
    const payload: JiraWebhookPayload = {
      webhookEvent: "jira:issue_updated",
      issue: {
        id: "10004",
        key: "PROJ-45",
        fields: {
          labels: ["Critter"],
          status: { name: "To Do" },
        },
      },
      changelog: {
        items: [
          { field: "summary", fieldtype: "jira", from: null, fromString: "Old", to: null, toString: "New" },
        ],
      },
    };
    expect(extractJiraWebhookTrigger(payload, types)).toBeNull();
  });

  test("irrelevant webhook event returns null", () => {
    const payload: JiraWebhookPayload = {
      webhookEvent: "jira:issue_deleted",
      issue: {
        id: "10005",
        key: "PROJ-46",
        fields: {
          labels: ["Critter"],
          status: { name: "To Do" },
        },
      },
    };
    expect(extractJiraWebhookTrigger(payload, types)).toBeNull();
  });

  test("non-matching label returns null", () => {
    const payload: JiraWebhookPayload = {
      webhookEvent: "jira:issue_created",
      issue: {
        id: "10006",
        key: "PROJ-47",
        fields: {
          labels: ["Bug"],
          status: { name: "To Do" },
        },
      },
    };
    expect(extractJiraWebhookTrigger(payload, types)).toBeNull();
  });
});
