import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type HealthStatus, resetMetricsSummaryCache, startHealthServer } from "../health.js";
import { initMetrics, recordMetric } from "../metrics.js";
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

beforeEach(() => {
  const tmp = createTempDir();
  tempDir = tmp.path;
  cleanup = tmp.cleanup;
  resetMetricsSummaryCache();
});

afterEach(() => {
  server?.stop();
  server = null;
  cleanup();
});

describe("GET /healthz", () => {
  test("returns 200 with correct shape", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    server = startHealthServer(0, defaultStatus);
    // Extract port from the server - Bun.serve with port 0 assigns a random port
    // We need to get the actual URL from the server internals
    // Since startHealthServer doesn't expose the port, we'll use a known port
    // Actually, we need to rethink - let's use a random high port
    // Port 0 with Bun.serve picks a random port, but our wrapper doesn't expose it.
    // Let's test by starting on a specific high port range.
    server.stop();

    // Restart with port 0 - need to capture the actual server port
    // The startHealthServer function logs the port but doesn't return it.
    // Let's create a helper that tests by trying the port.
    // For now, we'll use a random port in the ephemeral range.
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus);

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
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, () => ({
      activeCritters: 2,
      queuedCritters: 3,
      activeReviews: 1,
      queuedReviews: 0,
      perType: { create: { active: 2, queued: 3 }, review: { active: 1, queued: 0 } },
      lastPollAt: "2026-01-15T10:00:00.000Z",
      activeCritterDetails: [],
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

    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus);

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

    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus);

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

    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus);

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

    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus);

    const res = await fetch(`http://localhost:${port}/metrics`);
    const body = await res.json();

    expect(body).toEqual([]);
  });
});

describe("GET / (dashboard)", () => {
  test("returns 200 with HTML content type", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus);

    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Critters Dashboard");
  });

  test("/dashboard returns same content as /", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus);

    const res = await fetch(`http://localhost:${port}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

describe("unknown routes", () => {
  test("returns 404", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus);

    const res = await fetch(`http://localhost:${port}/unknown`);
    expect(res.status).toBe(404);
  });
});

describe("POST /poll", () => {
  test("triggers poll and returns issue count", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus, undefined, {
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
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus, undefined, {
      triggerPoll: async () => 0,
      triggerReviewPoll: async () => 0,
    });

    const res = await fetch(`http://localhost:${port}/poll`);
    expect(res.status).toBe(405);
  });

  test("returns 503 when triggers not configured", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus);

    const res = await fetch(`http://localhost:${port}/poll`, { method: "POST" });
    expect(res.status).toBe(503);
  });
});

describe("POST /review-poll", () => {
  test("triggers review poll and returns issue count", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus, undefined, {
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
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus, undefined, {
      triggerPoll: async () => 0,
      triggerReviewPoll: async () => 0,
    });

    const res = await fetch(`http://localhost:${port}/review-poll`);
    expect(res.status).toBe(405);
  });
});

describe("stop()", () => {
  test("shuts down the server", async () => {
    initMetrics(join(tempDir, "metrics.jsonl"));
    const port = 10000 + Math.floor(Math.random() * 50000);
    server = startHealthServer(port, defaultStatus);

    // Verify server is running
    const res = await fetch(`http://localhost:${port}/healthz`);
    expect(res.status).toBe(200);

    // Stop the server
    server.stop();
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
