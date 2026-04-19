import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
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

describe("renderDashboard", () => {
  test("returns valid HTML with DOCTYPE", () => {
    const html = renderDashboard("", defaultStatus(), 0);
    expect(html).toStartWith("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  test("contains auto-refresh meta tag", () => {
    const html = renderDashboard("", defaultStatus(), 0);
    expect(html).toContain('<meta http-equiv="refresh" content="30;url=/dashboard">');
  });

  test("contains viewport meta tag", () => {
    const html = renderDashboard("", defaultStatus(), 0);
    expect(html).toContain('<meta name="viewport"');
  });

  test("shows summary cards with correct values", () => {
    const now = new Date().toISOString();
    recordMetric({ timestamp: now, event: "task_completed", identifier: "TST-1", costUsd: 1.5, duration: 600000 });
    recordMetric({ timestamp: now, event: "task_completed", identifier: "TST-2", costUsd: 2.0, duration: 1200000 });
    recordMetric({ timestamp: now, event: "task_completed", identifier: "TST-3", costUsd: 0.5, duration: 300000 });
    recordMetric({ timestamp: now, event: "task_failed", identifier: "TST-4", costUsd: 1.0, duration: 900000 });

    const html = renderDashboard("", defaultStatus(), 0);
    // Total tasks = 4
    expect(html).toContain(">4<");
    // Success rate = 75%
    expect(html).toContain("75%");
    // Total cost = $5.00
    expect(html).toContain("$5.00");
  });

  test("shows recent activity table with identifiers", () => {
    const now = new Date().toISOString();
    recordMetric({ timestamp: now, event: "task_completed", identifier: "ACK-42" });
    recordMetric({ timestamp: now, event: "task_failed", identifier: "ACK-99" });

    const html = renderDashboard("", defaultStatus(), 0);
    expect(html).toContain("ACK-42");
    expect(html).toContain("ACK-99");
    expect(html).toContain("shipped");
    expect(html).toContain("failed");
  });

  test("shows KPI strip with in-flight and slot counts", () => {
    const status: HealthStatus = {
      activeCritters: 2,
      queuedCritters: 1,
      activeReviews: 3,
      queuedReviews: 0,
      perType: { create: { active: 2, queued: 1 }, review: { active: 3, queued: 0 } },
      lastPollAt: null,
      activeCritterDetails: [],
      queuedCritterDetails: [],
      pollIntervalSeconds: 120,
      concurrencyMax: 4,
    };
    const html = renderDashboard("", status, 0);
    // Sidebar slots pill: 5/4 (active/max)
    expect(html).toContain("5/4");
    expect(html).toContain("In flight");
    // Poll interval surfaced in daemon card
    expect(html).toContain("every 120s");
  });

  test("shows queued count in KPI sub-label", () => {
    const status: HealthStatus = {
      activeCritters: 1,
      queuedCritters: 2,
      activeReviews: 0,
      queuedReviews: 0,
      perType: {},
      lastPollAt: null,
      activeCritterDetails: [],
      queuedCritterDetails: [
        { identifier: "Q-1", title: "first", critterType: "create", repo: "org/repo", enqueuedAt: Date.now() },
        { identifier: "Q-2", title: "second", critterType: "create", repo: "org/repo", enqueuedAt: Date.now() },
      ],
      pollIntervalSeconds: 60,
      concurrencyMax: 2,
    };
    const html = renderDashboard("", status, 0);
    expect(html).toContain("2 queued");
    expect(html).toContain("Q-1");
    expect(html).toContain("Q-2");
  });

  test("handles empty metrics gracefully", () => {
    const html = renderDashboard("", defaultStatus(), 0);
    expect(html).toStartWith("<!DOCTYPE html>");
    // Should show 0 total tasks
    expect(html).toContain(">0<");
    // Success rate should be N/A
    expect(html).toContain("N/A");
    // No activity message
    expect(html).toContain("No activity yet");
  });

  test("handles metrics without cost/duration", () => {
    const now = new Date().toISOString();
    recordMetric({ timestamp: now, event: "task_completed", identifier: "X-1" });
    recordMetric({ timestamp: now, event: "task_failed", identifier: "X-2" });

    const html = renderDashboard("", defaultStatus(), 0);
    // Should not contain NaN
    expect(html).not.toContain("NaN");
    // Should still render valid HTML
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("X-1");
    expect(html).toContain("X-2");
  });

  test("escapes HTML in identifiers", () => {
    const now = new Date().toISOString();
    recordMetric({ timestamp: now, event: "task_completed", identifier: '<script>alert("xss")</script>' });

    const html = renderDashboard("", defaultStatus(), 0);
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain("&lt;script&gt;");
  });

  test("contains throughput and breakdown sections", () => {
    const html = renderDashboard("", defaultStatus(), 0);
    expect(html).toContain("Throughput");
    expect(html).toContain("tasks / day");
    expect(html).toContain("Recent activity");
  });

  test("renders PR links in activity table", () => {
    const now = new Date().toISOString();
    recordMetric({ timestamp: now, event: "task_completed", identifier: "PR-1", prUrl: "https://github.com/org/repo/pull/42" });

    const html = renderDashboard("", defaultStatus(), 0);
    expect(html).toContain('href="https://github.com/org/repo/pull/42"');
    expect(html).toContain("PR</a>");
  });

  test("duration formatting converts from milliseconds", () => {
    const now = new Date().toISOString();
    recordMetric({ timestamp: now, event: "task_completed", identifier: "DUR-1", duration: 480000 });

    const html = renderDashboard("", defaultStatus(), 0);
    expect(html).toContain("8m");
    // data-sort-value contains the raw ms, but the display text should be formatted
    expect(html).toContain("8m 0s");
  });

  test("duration formatting for sub-minute values", () => {
    const now = new Date().toISOString();
    recordMetric({ timestamp: now, event: "task_completed", identifier: "DUR-2", duration: 45000 });

    const html = renderDashboard("", defaultStatus(), 0);
    expect(html).toContain("45s");
  });

  test("review events appear in dashboard summary and activity table", () => {
    const now = new Date().toISOString();
    recordMetric({ timestamp: now, event: "task_completed", identifier: "T-1", costUsd: 1.0 });
    recordMetric({ timestamp: now, event: "task_failed", identifier: "T-2", costUsd: 0.5 });
    recordMetric({ timestamp: now, event: "review_completed", identifier: "R-1", costUsd: 0.3 });
    recordMetric({ timestamp: now, event: "review_failed", identifier: "R-2", costUsd: 0.2 });

    const html = renderDashboard("", defaultStatus(), 0);
    // Total cost includes review costs: 1.0 + 0.5 + 0.3 + 0.2 = $2.00
    expect(html).toContain("$2.00");
    // Review status labels
    expect(html).toContain("reviewed");
    expect(html).toContain("review·fail");
  });

  test("contains New critter button", () => {
    const html = renderDashboard("", defaultStatus(), 0);
    expect(html).toContain('id="new-critter-btn"');
    expect(html).toContain("New critter");
  });

  test("contains create modal markup", () => {
    const html = renderDashboard("", defaultStatus(), 0);
    expect(html).toContain('id="create-modal"');
    expect(html).toContain('id="create-form"');
    expect(html).toContain('id="create-title"');
  });

  test("contains auth check script", () => {
    const html = renderDashboard("", defaultStatus(), 0);
    expect(html).toContain("api/v1/auth-check");
  });

  test("renders active critters detail table when critters are running", () => {
    const status = defaultStatus();
    status.activeCritters = 1;
    status.activeCritterDetails = [{
      identifier: "ACK-100",
      title: "Test task",
      phase: "plan",
      repo: "org/repo",
      branch: "critter/ACK-100-test-task",
      startedAt: Date.now() - 120000,
    }];
    const html = renderDashboard("", status, 0);
    expect(html).toContain("ACK-100");
    expect(html).toContain("Planning");
    expect(html).toContain("org/repo");
    expect(html).toContain("critter/ACK-100-test-task");
  });
});
