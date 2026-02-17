import { describe, expect, test } from "bun:test";
import {
  formatFailure,
  formatReviewFailure,
  formatReviewMerged,
  formatReviewNeedsChanges,
  formatSuccess,
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
