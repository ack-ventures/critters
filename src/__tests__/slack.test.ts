import { describe, expect, test } from "bun:test";
import {
  formatFailure,
  formatPlanningComplete,
  formatReviewFailure,
  formatReviewMerged,
  formatReviewNeedsChanges,
  formatReviewStarted,
  formatSuccess,
  formatTaskPickedUp,
  formatTimeoutWarning,
} from "../slack.js";

describe("formatSuccess", () => {
  test("includes identifier, title, and PR URL", () => {
    const msg = formatSuccess("ACK-1", "Add feature", "https://github.com/org/repo/pull/1");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("https://github.com/org/repo/pull/1");
  });

  test("includes duration when provided", () => {
    const msg = formatSuccess("ACK-1", "Add feature", "https://github.com/org/repo/pull/1", "5m 30s");
    expect(msg).toContain("5m 30s");
  });
});

describe("formatFailure", () => {
  test("includes identifier, title, and error", () => {
    const msg = formatFailure("ACK-1", "Add feature", "timeout");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("timeout");
  });
});

describe("formatReviewMerged", () => {
  test("includes identifier, title, PR URL, and duration", () => {
    const msg = formatReviewMerged("ACK-1", "Add feature", "https://github.com/org/repo/pull/1", "2m 15s");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("https://github.com/org/repo/pull/1");
    expect(msg).toContain("2m 15s");
    expect(msg).toContain("merged");
  });
});

describe("formatReviewNeedsChanges", () => {
  test("includes identifier, title, and reason", () => {
    const msg = formatReviewNeedsChanges("ACK-1", "Add feature", "Missing tests", "3m");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("Missing tests");
    expect(msg).toContain("Needs changes");
  });
});

describe("formatReviewFailure", () => {
  test("includes identifier, title, and error", () => {
    const msg = formatReviewFailure("ACK-1", "Add feature", "Claude crashed", "1m");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("Claude crashed");
    expect(msg).toContain("Review failed");
  });
});

describe("formatTaskPickedUp", () => {
  test("includes identifier, title, and repo URL", () => {
    const msg = formatTaskPickedUp("ACK-1", "Add feature", "git@github.com:org/repo.git");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("git@github.com:org/repo.git");
    expect(msg).toContain("Picked up");
  });
});

describe("formatPlanningComplete", () => {
  test("includes identifier and title", () => {
    const msg = formatPlanningComplete("ACK-1", "Add feature");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("Planning complete");
    expect(msg).toContain("executing");
  });

  test("includes stats when provided", () => {
    const msg = formatPlanningComplete("ACK-1", "Add feature", 12, 1.5);
    expect(msg).toContain("12 turns");
    expect(msg).toContain("$1.50");
  });

  test("omits stats when not provided", () => {
    const msg = formatPlanningComplete("ACK-1", "Add feature");
    expect(msg).not.toContain("turns");
    expect(msg).not.toContain("$");
  });
});

describe("formatReviewStarted", () => {
  test("includes identifier, title, and PR URL", () => {
    const msg = formatReviewStarted("ACK-1", "Add feature", "https://github.com/org/repo/pull/1");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("https://github.com/org/repo/pull/1");
    expect(msg).toContain("Review started");
  });
});

describe("formatTimeoutWarning", () => {
  test("includes identifier, title, elapsed and timeout minutes", () => {
    const msg = formatTimeoutWarning("ACK-1", "Add feature", 24, 30);
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("24/30 minutes");
  });
});
