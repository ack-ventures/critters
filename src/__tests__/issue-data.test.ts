import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildIssueData } from "../dashboard/issue-data.js";
import type { HealthStatus } from "../health.js";
import { initMetrics, recordMetric } from "../metrics.js";
import type { IssueTracker } from "../tracker/types.js";
import { createTempDir } from "./helpers.js";

let cleanup: () => void;

function defaultStatus(): HealthStatus {
  return {
    activeCritters: 0,
    queuedCritters: 0,
    activeReviews: 0,
    queuedReviews: 0,
    perType: {},
    lastPollAt: null,
    activeCritterDetails: [],
    queuedCritterDetails: [],
    pollIntervalSeconds: 120,
    concurrencyMax: 1,
  };
}

function createMockTracker(content: string): IssueTracker {
  return {
    provider: "linear",
    init: async () => {},
    findIssues: async () => [],
    findIssueByIdentifier: async () => ({
      id: "issue-id",
      identifier: "ACK-330",
      statusName: "Done",
      labels: [],
      groupId: "team-id",
    }),
    updateStatus: async () => {},
    comment: async () => {},
    getComments: async () => [],
    uploadAttachment: async () => null,
    getAttachments: async () => [{ name: "ACK-330-plan-output.txt", url: "attachment://plan" }],
    fetchAttachmentContent: async () => content,
    ensureStatus: async () => {},
    ensureLabel: async () => {},
    removeLabel: async () => {},
    createIssue: async () => ({ id: "new-id", identifier: "ACK-999", url: "https://linear.app/test/ACK-999" }),
    listTeams: async () => [],
  };
}

beforeEach(() => {
  const tmp = createTempDir();
  cleanup = tmp.cleanup;
  initMetrics(join(tmp.path, "metrics.jsonl"));
});

afterEach(() => {
  cleanup();
});

describe("buildIssueData", () => {
  test("parses uploaded Codex phase attachments when local logs are gone", async () => {
    const codexLog = [
      JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 17370,
          cached_input_tokens: 4480,
          output_tokens: 22,
        },
      }),
    ].join("\n");

    recordMetric({
      timestamp: new Date().toISOString(),
      event: "task_completed",
      identifier: "ACK-330",
      costUsd: 0,
      inputTokens: 17370,
      outputTokens: 22,
      cacheReadTokens: 4480,
    });

    const data = await buildIssueData(
      "ACK-330",
      defaultStatus(),
      "/tmp/critters-work-does-not-exist",
      undefined,
      new Map([["linear", createMockTracker(codexLog)]]),
    );

    expect(data.phases).toEqual(["planning"]);
    expect(data.phaseResults[0]).toMatchObject({
      phase: "planning",
      isDone: true,
      inputTokens: 17370,
      outputTokens: 22,
      cacheReadTokens: 4480,
      numTurns: 1,
    });
    expect(data.cost.inputTokens).toBe(17370);
    expect(data.cost.outputTokens).toBe(22);
    expect(data.cost.cacheReadTokens).toBe(4480);
  });
});
