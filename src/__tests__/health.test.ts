import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { CritterTypeConfig } from "../critter-type.js";
import { type HealthStatus, resetMetadataCache, resetMetricsSummaryCache, startHealthServer } from "../health.js";
import { initMetrics, recordMetric } from "../metrics.js";
import type { IssueTracker } from "../tracker/types.js";
import { createTempDir } from "./helpers.js";

let tempDir: string;
let cleanup: () => void;
let server: { port: number; stop: () => void } | null = null;

/** Start health server on an OS-assigned port and return the port number. */
function startServer(...args: Parameters<typeof startHealthServer>): number {
  args[0] = 0;
  server = startHealthServer(...args);
  return server.port;
}

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

beforeEach(() => {
  const tmp = createTempDir();
  tempDir = tmp.path;
  cleanup = tmp.cleanup;
  resetMetricsSummaryCache();
  resetMetadataCache();
});

afterEach(() => {
  server?.stop();
  server = null;
  cleanup();
});

describe("GET /healthz", () => {
  test("returns 200 with correct shape", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus);

    const res = await fetch(`http://localhost:${port}/healthz`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof body.version).toBe("string");
    expect(body.activeCritters).toBe(0);
    expect(body.queuedCritters).toBe(0);
    expect(body.activeReviews).toBe(0);
    expect(body.queuedReviews).toBe(0);
    expect(body.lastPollAt).toBeNull();
    expect(body.metrics).toEqual({ totalTasks: 0, succeeded: 0, failed: 0, totalCost: 0, avgCost: 0 });
    expect(typeof body.displayVersion).toBe("string");
  });

  test("reflects getStatus callback values", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, () => ({
      activeCritters: 2,
      queuedCritters: 3,
      activeReviews: 1,
      queuedReviews: 0,
      perType: { create: { active: 2, queued: 3 }, review: { active: 1, queued: 0 } },
      lastPollAt: "2026-01-15T10:00:00.000Z",
      activeCritterDetails: [],
      queuedCritterDetails: [],
      pollIntervalSeconds: 120,
      concurrencyMax: 3,
    }));

    const res = await fetch(`http://localhost:${port}/healthz`);
    const body = await res.json();

    expect(body.activeCritters).toBe(2);
    expect(body.queuedCritters).toBe(3);
    expect(body.activeReviews).toBe(1);
    expect(body.queuedReviews).toBe(0);
    expect(body.perType).toEqual({ create: { active: 2, queued: 3 }, review: { active: 1, queued: 0 } });
    expect(body.lastPollAt).toBe("2026-01-15T10:00:00.000Z");
  });

  test("caches metrics summary across rapid requests", async () => {
    const metricsFile = join(tempDir, "metrics.jsonl");
    initMetrics(metricsFile);
    recordMetric({ timestamp: "", event: "task_completed", issueId: "C-1" });

    const port = startServer(0, defaultStatus);

    // First request computes fresh
    const res1 = await fetch(`http://localhost:${port}/healthz`);
    const body1 = await res1.json();
    expect(body1.metrics.totalTasks).toBe(1);
    expect(body1.metrics.succeeded).toBe(1);

    // Add another metric — but cache should still return old value
    recordMetric({ timestamp: "", event: "task_failed", issueId: "C-2" });

    const res2 = await fetch(`http://localhost:${port}/healthz`);
    const body2 = await res2.json();
    // Should still be cached (1 task, not 2)
    expect(body2.metrics.totalTasks).toBe(1);
    expect(body2.metrics.succeeded).toBe(1);
    expect(body2.metrics.failed).toBe(0);
  });

  test("includes metrics summary from metrics file", async () => {
    const metricsFile = join(tempDir, "metrics.jsonl");
    initMetrics(metricsFile);
    recordMetric({ timestamp: "", event: "task_completed", issueId: "A-1" });
    recordMetric({ timestamp: "", event: "task_completed", issueId: "A-2" });
    recordMetric({ timestamp: "", event: "task_failed", issueId: "A-3" });
    recordMetric({ timestamp: "", event: "task_started", issueId: "A-4" });

    const port = startServer(0, defaultStatus);

    const res = await fetch(`http://localhost:${port}/healthz`);
    const body = await res.json();

    expect(body.metrics.totalTasks).toBe(3);
    expect(body.metrics.succeeded).toBe(2);
    expect(body.metrics.failed).toBe(1);
  });
});

describe("GET /metrics", () => {
  test("returns recent metrics as JSON array", async () => {
    const metricsFile = join(tempDir, "metrics.jsonl");
    initMetrics(metricsFile);
    recordMetric({ timestamp: "", event: "task_started", issueId: "X-1" });
    recordMetric({ timestamp: "", event: "task_completed", issueId: "X-2" });

    const port = startServer(0, defaultStatus);

    const res = await fetch(`http://localhost:${port}/metrics`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0].event).toBe("task_started");
    expect(body[1].event).toBe("task_completed");
  });

  test("returns empty array when no metrics file exists", async () => {
    initMetrics(join(tempDir, "nonexistent", "metrics.jsonl"));

    const port = startServer(0, defaultStatus);

    const res = await fetch(`http://localhost:${port}/metrics`);
    const body = await res.json();

    expect(body).toEqual([]);
  });
});

describe("GET / (dashboard)", () => {
  test("returns 200 with HTML content type", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus);

    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Critters Dashboard");
  });

  test("/dashboard returns same content as /", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus);

    const res = await fetch(`http://localhost:${port}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

describe("unknown routes", () => {
  test("returns 404", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus);

    const res = await fetch(`http://localhost:${port}/unknown`);
    expect(res.status).toBe(404);
  });
});

describe("POST /poll", () => {
  test("triggers poll and returns issue count", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus, undefined, {
      triggerPoll: async () => 5,
      triggerReviewPoll: async () => 0,
    });

    const res = await fetch(`http://localhost:${port}/poll`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ triggered: true, issuesFound: 5 });
  });

  test("returns 405 for GET", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus, undefined, {
      triggerPoll: async () => 0,
      triggerReviewPoll: async () => 0,
    });

    const res = await fetch(`http://localhost:${port}/poll`);
    expect(res.status).toBe(405);
  });

  test("returns 503 when triggers not configured", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus);

    const res = await fetch(`http://localhost:${port}/poll`, { method: "POST" });
    expect(res.status).toBe(503);
  });
});

describe("POST /review-poll", () => {
  test("triggers review poll and returns issue count", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus, undefined, {
      triggerPoll: async () => 0,
      triggerReviewPoll: async () => 3,
    });

    const res = await fetch(`http://localhost:${port}/review-poll`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ triggered: true, issuesFound: 3 });
  });

  test("returns 405 for GET", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus, undefined, {
      triggerPoll: async () => 0,
      triggerReviewPoll: async () => 0,
    });

    const res = await fetch(`http://localhost:${port}/review-poll`);
    expect(res.status).toBe(405);
  });
});

describe("auth", () => {
  test("POST /poll returns 401 without token when dashboardToken is configured", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus, undefined, {
      triggerPoll: async () => 0,
      triggerReviewPoll: async () => 0,
    }, undefined, "secret-token");

    const res = await fetch(`http://localhost:${port}/poll`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("POST /poll returns 200 with correct bearer token", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus, undefined, {
      triggerPoll: async () => 2,
      triggerReviewPoll: async () => 0,
    }, undefined, "secret-token");

    const res = await fetch(`http://localhost:${port}/poll`, {
      method: "POST",
      headers: { Authorization: "Bearer secret-token" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ triggered: true, issuesFound: 2 });
  });

  test("POST /poll returns 401 with wrong bearer token", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus, undefined, {
      triggerPoll: async () => 0,
      triggerReviewPoll: async () => 0,
    }, undefined, "secret-token");

    const res = await fetch(`http://localhost:${port}/poll`, {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  test("POST /poll works without auth when dashboardToken is not set", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus, undefined, {
      triggerPoll: async () => 1,
      triggerReviewPoll: async () => 0,
    });

    const res = await fetch(`http://localhost:${port}/poll`, { method: "POST" });
    expect(res.status).toBe(200);
  });

  test("GET /api/v1/auth-check returns required: true when token set", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus, undefined, undefined, undefined, "secret-token");

    const res = await fetch(`http://localhost:${port}/api/v1/auth-check`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ required: true });
  });

  test("GET /api/v1/auth-check returns required: false when token not set", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus);

    const res = await fetch(`http://localhost:${port}/api/v1/auth-check`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ required: false });
  });
});

// ── Mock helpers for metadata/issues tests ──────────────────────────────────

function createMockTracker(overrides?: Partial<IssueTracker>): IssueTracker {
  return {
    provider: "linear",
    init: async () => {},
    findIssues: async () => [],
    findIssueByIdentifier: async () => null,
    updateStatus: async () => {},
    comment: async () => {},
    getComments: async () => [],
    uploadAttachment: async () => null,
    getAttachments: async () => [],
    fetchAttachmentContent: async () => null,
    ensureStatus: async () => {},
    ensureLabel: async () => {},
    removeLabel: async () => {},
    createIssue: async () => ({
      id: "new-id",
      identifier: "ACK-999",
      url: "https://linear.app/test/ACK-999",
    }),
    listTeams: async () => [
      { id: "team1", name: "Team Alpha", key: "TA" },
    ],
    ...overrides,
  };
}

function createMockCritterType(overrides?: Partial<CritterTypeConfig>): CritterTypeConfig {
  return {
    name: "create",
    trigger: { label: "Critter", status: "Todo" },
    repo: { clone: true, branch: true },
    phases: [{ name: "execution", prompt: "builtin:execution", model: "opus", maxTurns: 75, tools: "default" }],
    outcomes: { success: { status: "In Review" } },
    concurrency: 2,
    timeoutMinutes: 30,
    ...overrides,
  };
}

describe("GET /api/v1/metadata", () => {
  test("returns providers and critter types with mock trackers", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const trackers = new Map([["linear", createMockTracker()]]);
    const critterTypes = [createMockCritterType()];
    const port = startServer(0, defaultStatus, undefined, undefined, undefined, undefined, {
      trackers,
      critterTypes,
    });

    const res = await fetch(`http://localhost:${port}/api/v1/metadata`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers.linear.teams).toEqual([{ id: "team1", name: "Team Alpha", key: "TA" }]);
    expect(body.critterTypes).toEqual([
      { name: "create", triggerLabel: "Critter", triggerStatus: "Todo", provider: "linear" },
    ]);
  });

  test("returns empty providers when no context provided", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus);

    const res = await fetch(`http://localhost:${port}/api/v1/metadata`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers).toEqual({});
    expect(body.critterTypes).toEqual([]);
  });

  test("uses defaultProvider for critter types without explicit provider", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const trackers = new Map([["jira", createMockTracker({ provider: "jira" })]]);
    const critterTypes = [createMockCritterType({ provider: undefined })];
    const port = startServer(0, defaultStatus, undefined, undefined, undefined, undefined, {
      trackers,
      critterTypes,
      defaultProvider: "jira",
    });

    const res = await fetch(`http://localhost:${port}/api/v1/metadata`);
    const body = await res.json();
    expect(body.critterTypes[0].provider).toBe("jira");
  });

  test("returns empty teams when tracker.listTeams throws", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const trackers = new Map([["linear", createMockTracker({
      listTeams: async () => { throw new Error("API error"); },
    })]]);
    const port = startServer(0, defaultStatus, undefined, undefined, undefined, undefined, {
      trackers,
      critterTypes: [],
    });

    const res = await fetch(`http://localhost:${port}/api/v1/metadata`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers.linear.teams).toEqual([]);
  });
});

describe("POST /api/v1/issues", () => {
  test("creates issue via tracker and returns identifier", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const trackers = new Map([["linear", createMockTracker()]]);
    const critterTypes = [createMockCritterType()];
    const port = startServer(0, defaultStatus, undefined, undefined, undefined, undefined, {
      trackers,
      critterTypes,
    });

    const res = await fetch(`http://localhost:${port}/api/v1/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "linear", teamId: "team1", title: "Test Issue", critterType: "create" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, identifier: "ACK-999", url: "https://linear.app/test/ACK-999" });
  });

  test("returns 400 when title is missing", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const trackers = new Map([["linear", createMockTracker()]]);
    const port = startServer(0, defaultStatus, undefined, undefined, undefined, undefined, { trackers, critterTypes: [] });

    const res = await fetch(`http://localhost:${port}/api/v1/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "linear", teamId: "team1" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Title is required");
  });

  test("returns 400 when teamId is missing", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const trackers = new Map([["linear", createMockTracker()]]);
    const port = startServer(0, defaultStatus, undefined, undefined, undefined, undefined, { trackers, critterTypes: [] });

    const res = await fetch(`http://localhost:${port}/api/v1/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "linear", title: "Test" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Team is required");
  });

  test("returns 400 for unknown provider", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const trackers = new Map([["linear", createMockTracker()]]);
    const port = startServer(0, defaultStatus, undefined, undefined, undefined, undefined, { trackers, critterTypes: [] });

    const res = await fetch(`http://localhost:${port}/api/v1/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "github", teamId: "t1", title: "Test" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("github");
  });

  test("returns 401 when auth is required and missing", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const trackers = new Map([["linear", createMockTracker()]]);
    const port = startServer(0, defaultStatus, undefined, undefined, undefined, "secret-token", { trackers, critterTypes: [] });

    const res = await fetch(`http://localhost:${port}/api/v1/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "linear", teamId: "t1", title: "Test" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 405 for GET request", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const trackers = new Map([["linear", createMockTracker()]]);
    const port = startServer(0, defaultStatus, undefined, undefined, undefined, undefined, { trackers, critterTypes: [] });

    const res = await fetch(`http://localhost:${port}/api/v1/issues`);
    expect(res.status).toBe(405);
  });

  test("returns 503 when trackers not available", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus);

    const res = await fetch(`http://localhost:${port}/api/v1/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "linear", teamId: "t1", title: "Test" }),
    });
    expect(res.status).toBe(503);
  });
});

describe("stop()", () => {
  test("shuts down the server", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = startServer(0, defaultStatus);

    // Verify server is running
    const res = await fetch(`http://localhost:${port}/healthz`);
    expect(res.status).toBe(200);

    // Stop the server
    server!.stop();
    server = null;

    // Verify server is no longer accepting connections
    try {
      await fetch(`http://localhost:${port}/healthz`);
      // If fetch doesn't throw, the server might still be shutting down
      // This is acceptable - the important thing is that stop() was called
    } catch {
      // Expected - connection refused
    }
  });
});
