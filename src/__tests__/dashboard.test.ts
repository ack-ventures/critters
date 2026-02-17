import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderDashboard } from "../dashboard.js";
import { type HealthStatus } from "../health.js";
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
    lastPollAt: null,
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
    const html = renderDashboard("", defaultStatus());
    expect(html).toStartWith("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  test("contains auto-refresh meta tag", () => {
    const html = renderDashboard("", defaultStatus());
    expect(html).toContain('<meta http-equiv="refresh" content="30">');
  });

  test("contains viewport meta tag", () => {
    const html = renderDashboard("", defaultStatus());
    expect(html).toContain('<meta name="viewport"');
  });

  test("shows summary cards with correct values", () => {
    const now = new Date().toISOString();
    recordMetric({ timestamp: now, event: "task_completed", identifier: "TST-1", costUsd: 1.5, duration: 10 });
    recordMetric({ timestamp: now, event: "task_completed", identifier: "TST-2", costUsd: 2.0, duration: 20 });
    recordMetric({ timestamp: now, event: "task_completed", identifier: "TST-3", costUsd: 0.5, duration: 5 });
    recordMetric({ timestamp: now, event: "task_failed", identifier: "TST-4", costUsd: 1.0, duration: 15 });

    const html = renderDashboard("", defaultStatus());
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

    const html = renderDashboard("", defaultStatus());
    expect(html).toContain("ACK-42");
    expect(html).toContain("ACK-99");
    expect(html).toContain("Completed");
    expect(html).toContain("Failed");
  });

  test("shows active critters section", () => {
    const status: HealthStatus = {
      activeCritters: 2,
      queuedCritters: 1,
      activeReviews: 3,
      queuedReviews: 0,
      lastPollAt: null,
    };
    const html = renderDashboard("", status);
    // Check active critters count appears
    expect(html).toContain(">2<");
    expect(html).toContain(">1<");
    expect(html).toContain(">3<");
    expect(html).toContain("Active Tasks");
    expect(html).toContain("Queued Tasks");
  });

  test("handles empty metrics gracefully", () => {
    const html = renderDashboard("", defaultStatus());
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

    const html = renderDashboard("", defaultStatus());
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

    const html = renderDashboard("", defaultStatus());
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("contains chart sections", () => {
    const html = renderDashboard("", defaultStatus());
    expect(html).toContain("Tasks per Day");
    expect(html).toContain("Cost per Day");
    expect(html).toContain("Success vs Failure");
    expect(html).toContain("bar-chart");
  });

  test("renders PR links in activity table", () => {
    const now = new Date().toISOString();
    recordMetric({ timestamp: now, event: "task_completed", identifier: "PR-1", prUrl: "https://github.com/org/repo/pull/42" });

    const html = renderDashboard("", defaultStatus());
    expect(html).toContain('href="https://github.com/org/repo/pull/42"');
    expect(html).toContain("PR</a>");
  });
});
