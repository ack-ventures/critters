import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildDashboardData } from "../dashboard/dashboard-data.js";
import { renderDashboard } from "../dashboard/index.js";
import type { HealthStatus } from "../health.js";
import { initMetrics, recordMetric } from "../metrics.js";
import { createTempDir } from "./helpers.js";

let tempDir: string;
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

beforeEach(() => {
  const tmp = createTempDir();
  tempDir = tmp.path;
  cleanup = tmp.cleanup;
  initMetrics(join(tempDir, "metrics.jsonl"));
});

afterEach(() => {
  cleanup();
});

describe("renderDashboard (shell HTML)", () => {
  test("returns valid HTML with DOCTYPE and a mount root", () => {
    const html = renderDashboard("", defaultStatus(), 0);
    expect(html).toStartWith("<!DOCTYPE html>");
    expect(html).toContain('id="root"');
    expect(html).toContain("</html>");
  });

  test("injects bootstrap config with filter but not token", () => {
    const html = renderDashboard("", defaultStatus(), 0, "create", "secret-token");
    expect(html).toContain("window.__CRITTERS__");
    expect(html).toContain('"typeFilter":"create"');
    expect(html).not.toContain("secret-token");
    expect(html).not.toContain('"token"');
  });

  test("omits token from bootstrap config", () => {
    const html = renderDashboard("", defaultStatus(), 0);
    expect(html).toContain('"typeFilter":null');
    expect(html).not.toContain('"token"');
  });

  test("no-script fallback preserves type filter in redirect URL", () => {
    const html = renderDashboard("", defaultStatus(), 0, "review");
    expect(html).toContain("/dashboard?type=review");
  });

  test("escapes typeFilter in the page title", () => {
    const html = renderDashboard("", defaultStatus(), 0, "<bad>");
    expect(html).not.toContain("<title>Critters · <bad>");
    expect(html).toContain("&lt;bad&gt;");
  });
});

describe("buildDashboardData (JSON API payload)", () => {
  test("computes totals from metrics", () => {
    const now = new Date().toISOString();
    recordMetric({ timestamp: now, event: "task_completed", identifier: "TST-1", costUsd: 1.5, duration: 600000 });
    recordMetric({ timestamp: now, event: "task_completed", identifier: "TST-2", costUsd: 2.0, duration: 1200000 });
    recordMetric({ timestamp: now, event: "task_completed", identifier: "TST-3", costUsd: 0.5, duration: 300000 });
    recordMetric({ timestamp: now, event: "task_failed", identifier: "TST-4", costUsd: 1.0, duration: 900000 });

    const data = buildDashboardData(defaultStatus(), 0, undefined, undefined);
    expect(data.totals.totalTasks).toBe(4);
    expect(data.totals.succeeded).toBe(3);
    expect(data.totals.failed).toBe(1);
    expect(data.totals.successRate).toBe(75);
    expect(data.totals.totalCost).toBeCloseTo(5.0);
  });

  test("includes identifiers in activity feed with correct status", () => {
    const now = new Date().toISOString();
    recordMetric({ timestamp: now, event: "task_completed", identifier: "ACK-42" });
    recordMetric({ timestamp: now, event: "task_failed", identifier: "ACK-99" });

    const data = buildDashboardData(defaultStatus(), 0, undefined, undefined);
    const ids = data.activity.map((a) => a.identifier).sort();
    expect(ids).toEqual(["ACK-42", "ACK-99"]);
    const ack42 = data.activity.find((a) => a.identifier === "ACK-42");
    expect(ack42?.event).toBe("task_completed");
  });

  test("surfaces queued critter details", () => {
    const status: HealthStatus = {
      ...defaultStatus(),
      queuedCritterDetails: [
        { identifier: "Q-1", title: "first", critterType: "create", repo: "org/repo", enqueuedAt: Date.now() },
      ],
    };
    const data = buildDashboardData(status, 0, undefined, undefined);
    expect(data.queuedCritters).toHaveLength(1);
    expect(data.queuedCritters[0].identifier).toBe("Q-1");
  });

  test("respects typeFilter when computing totals", () => {
    const now = new Date().toISOString();
    recordMetric({ timestamp: now, event: "task_completed", identifier: "C-1", critterType: "create" });
    recordMetric({ timestamp: now, event: "task_completed", identifier: "R-1", critterType: "review" });

    const data = buildDashboardData(defaultStatus(), 0, "create", undefined);
    expect(data.totals.totalTasks).toBe(1);
    expect(data.activity.every((a) => a.critterType === "create")).toBe(true);
  });

  test("exposes poll interval and concurrency from HealthStatus", () => {
    const status: HealthStatus = { ...defaultStatus(), pollIntervalSeconds: 60, concurrencyMax: 5 };
    const data = buildDashboardData(status, 0, undefined, undefined);
    expect(data.pollIntervalSeconds).toBe(60);
    expect(data.concurrency.max).toBe(5);
  });

  test("review events appear alongside task events in activity + totals", () => {
    const now = new Date().toISOString();
    recordMetric({ timestamp: now, event: "task_completed", identifier: "T-1", costUsd: 1.0 });
    recordMetric({ timestamp: now, event: "task_failed", identifier: "T-2", costUsd: 0.5 });
    recordMetric({ timestamp: now, event: "review_completed", identifier: "R-1", costUsd: 0.3 });
    recordMetric({ timestamp: now, event: "review_failed", identifier: "R-2", costUsd: 0.2 });

    const data = buildDashboardData(defaultStatus(), 0, undefined, undefined);
    expect(data.totals.totalTasks).toBe(4);
    expect(data.totals.totalCost).toBeCloseTo(2.0);
    expect(data.activity).toHaveLength(4);
  });

  test("handles empty metrics without NaN", () => {
    const data = buildDashboardData(defaultStatus(), 0, undefined, undefined);
    expect(data.totals.totalTasks).toBe(0);
    expect(data.totals.successRate).toBeNull();
    expect(data.totals.avgCost).toBeNull();
    expect(data.totals.avgDuration).toBeNull();
  });

  test("exposes active critter details unchanged", () => {
    const status: HealthStatus = {
      ...defaultStatus(),
      activeCritters: 1,
      activeCritterDetails: [
        {
          identifier: "ACK-100",
          title: "Test task",
          phase: "plan",
          repo: "org/repo",
          branch: "critter/ACK-100-test-task",
          startedAt: Date.now() - 120000,
        },
      ],
    };
    const data = buildDashboardData(status, 0, undefined, undefined);
    expect(data.activeCritters).toHaveLength(1);
    expect(data.activeCritters[0].identifier).toBe("ACK-100");
    expect(data.activeCritters[0].phase).toBe("plan");
  });
});
