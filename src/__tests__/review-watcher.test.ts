import { describe, expect, test } from "bun:test";
import { extractPrFromComments } from "../review-watcher.js";

describe("extractPrFromComments", () => {
  test("extracts URL from 'PR created: <url>'", () => {
    const comments = [
      "Cloning repo...",
      "Planning...",
      "PR created: https://github.com/org/repo/pull/42",
    ];
    const result = extractPrFromComments(comments);
    expect(result).not.toBeNull();
    expect(result!.prUrl).toBe("https://github.com/org/repo/pull/42");
    expect(result!.prNumber).toBe(42);
  });

  test("extracts URL from comment with trailing text", () => {
    const comments = [
      "PR created: https://github.com/org/repo/pull/42 (completed in 5m)",
    ];
    const result = extractPrFromComments(comments);
    expect(result).not.toBeNull();
    expect(result!.prUrl).toBe("https://github.com/org/repo/pull/42");
    expect(result!.prNumber).toBe(42);
  });

  test("returns null when no PR comment exists", () => {
    const comments = [
      "Cloning repo...",
      "Planning...",
      "Execution completed",
    ];
    const result = extractPrFromComments(comments);
    expect(result).toBeNull();
  });

  test("extracts from newest comment first", () => {
    const comments = [
      "PR created: https://github.com/org/repo/pull/10",
      "Some other comment",
      "PR created: https://github.com/org/repo/pull/42",
    ];
    const result = extractPrFromComments(comments);
    expect(result).not.toBeNull();
    expect(result!.prNumber).toBe(42);
  });

  test("handles empty comments array", () => {
    const result = extractPrFromComments([]);
    expect(result).toBeNull();
  });

  test("parses PR number correctly from multi-digit numbers", () => {
    const comments = [
      "PR created: https://github.com/org/repo/pull/1234",
    ];
    const result = extractPrFromComments(comments);
    expect(result).not.toBeNull();
    expect(result!.prNumber).toBe(1234);
  });
});
