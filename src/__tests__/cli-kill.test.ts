import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import type { HealthStatus } from "../health.js";
import { resetMetadataCache, resetMetricsSummaryCache, startHealthServer } from "../health.js";
import { initMetrics } from "../metrics.js";
import type { KillResult } from "../unified-spawner.js";
import { createTempDir } from "./helpers.js";

let tempDir: string;
let cleanup: () => void;
let server: { stop: () => void } | null = null;

function defaultStatus(): HealthStatus {
  return {
    activeCritters: 0,
    queuedCritters: 0,
    activeReviews: 0,
    queuedReviews: 0,
    perType: {},
    lastPollAt: null,
    activeCritterDetails: [],
  };
}

function statusWithCritters(): HealthStatus {
  return {
    activeCritters: 2,
    queuedCritters: 0,
    activeReviews: 0,
    queuedReviews: 0,
    perType: { create: { active: 1, queued: 0 }, review: { active: 1, queued: 0 } },
    lastPollAt: null,
    activeCritterDetails: [
      {
        identifier: "ACK-100",
        title: "Fix login bug",
        phase: "execution",
        repo: "org/repo",
        branch: "critter/ACK-100-fix-login-bug",
        startedAt: Date.now() - 60_000,
        critterType: "create",
      },
      {
        identifier: "ACK-200",
        title: "Review PR",
        phase: "review",
        repo: "org/repo",
        branch: "feature/branch",
        startedAt: Date.now() - 120_000,
        critterType: "review",
      },
    ],
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

describe("POST /kill endpoint", () => {
  test("kills critters and returns results", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = 10000 + Math.floor(Math.random() * 50000);
    const mockKill = mock<(identifiers: string[]) => KillResult[]>(() => [
      { identifier: "ACK-100", critterType: "create", startedAt: Date.now() - 60_000 },
    ]);

    server = startHealthServer(port, statusWithCritters, undefined, {
      triggerKill: mockKill,
    });

    const res = await fetch(`http://localhost:${port}/kill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: ["ACK-100"] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as KillResult[];
    expect(body).toHaveLength(1);
    expect(body[0].identifier).toBe("ACK-100");
    expect(body[0].critterType).toBe("create");
    expect(mockKill).toHaveBeenCalledWith(["ACK-100"]);
  });

  test("returns 405 for GET", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus, undefined, {
      triggerKill: () => [],
    });

    const res = await fetch(`http://localhost:${port}/kill`);
    expect(res.status).toBe(405);
  });

  test("returns 400 for empty identifiers", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus, undefined, {
      triggerKill: () => [],
    });

    const res = await fetch(`http://localhost:${port}/kill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: [] }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("non-empty");
  });

  test("returns 400 for missing identifiers", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus, undefined, {
      triggerKill: () => [],
    });

    const res = await fetch(`http://localhost:${port}/kill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  test("returns 401 without token when dashboardToken is configured", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus, undefined, {
      triggerKill: () => [],
    }, undefined, "secret-token");

    const res = await fetch(`http://localhost:${port}/kill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: ["ACK-100"] }),
    });

    expect(res.status).toBe(401);
  });

  test("returns 200 with correct bearer token", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = 10000 + Math.floor(Math.random() * 50000);
    const mockKill = mock<(identifiers: string[]) => KillResult[]>(() => []);
    server = startHealthServer(port, defaultStatus, undefined, {
      triggerKill: mockKill,
    }, undefined, "secret-token");

    const res = await fetch(`http://localhost:${port}/kill`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-token",
      },
      body: JSON.stringify({ identifiers: ["ACK-100"] }),
    });

    expect(res.status).toBe(200);
  });

  test("returns 503 when triggerKill not configured", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus);

    const res = await fetch(`http://localhost:${port}/kill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: ["ACK-100"] }),
    });

    expect(res.status).toBe(503);
  });

  test("kills multiple critters at once", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = 10000 + Math.floor(Math.random() * 50000);
    const mockKill = mock<(identifiers: string[]) => KillResult[]>(() => [
      { identifier: "ACK-100", critterType: "create", startedAt: Date.now() - 60_000 },
      { identifier: "ACK-200", critterType: "review", startedAt: Date.now() - 120_000 },
    ]);

    server = startHealthServer(port, statusWithCritters, undefined, {
      triggerKill: mockKill,
    });

    const res = await fetch(`http://localhost:${port}/kill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: ["ACK-100", "ACK-200"] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as KillResult[];
    expect(body).toHaveLength(2);
    expect(mockKill).toHaveBeenCalledWith(["ACK-100", "ACK-200"]);
  });
});
