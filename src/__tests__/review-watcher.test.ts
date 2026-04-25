import { describe, expect, mock, test } from "bun:test";
import type { IssueTracker } from "../tracker/types.js";
import { extractPrFromComments, UnifiedWatcher } from "../unified-watcher.js";
import { makeTestConfig, makeTestCritterType } from "./helpers.js";

describe("extractPrFromComments", () => {
  test("extracts URL from 'PR created: <url>'", () => {
    const comments = [
      "Cloning repo...",
      "Planning...",
      "PR created: https://github.com/org/repo/pull/42",
    ];
    const result = extractPrFromComments(comments);
    expect(result).not.toBeNull();
    expect(result?.prUrl).toBe("https://github.com/org/repo/pull/42");
    expect(result?.prNumber).toBe(42);
  });

  test("extracts URL from comment with trailing text", () => {
    const comments = [
      "PR created: https://github.com/org/repo/pull/42 (completed in 5m)",
    ];
    const result = extractPrFromComments(comments);
    expect(result).not.toBeNull();
    expect(result?.prUrl).toBe("https://github.com/org/repo/pull/42");
    expect(result?.prNumber).toBe(42);
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
    expect(result?.prNumber).toBe(42);
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
    expect(result?.prNumber).toBe(1234);
  });
});

describe("UnifiedWatcher webhook issue polling", () => {
  test("uses direct issue lookup and claims before dispatching", async () => {
    const updateStatus = mock(async () => {});
    const findIssues = mock(async () => {
      throw new Error("findIssues should not be called for a single issue poll");
    });
    const tracker = {
      provider: "linear",
      init: async () => {},
      findIssues,
      findIssueByIdentifier: mock(async () => ({
        id: "issue-1",
        identifier: "ACK-1",
        title: "Do the thing",
        description: "repo: https://github.com/acme/app",
        statusName: "Todo",
        labels: ["Critter"],
        group: "ACK",
        groupId: "team-1",
        issueUrl: "https://linear.app/acme/issue/ACK-1",
      })),
      updateStatus,
      comment: async () => {},
      getComments: async () => [],
      uploadAttachment: async () => null,
      getAttachments: async () => [],
      fetchAttachmentContent: async () => null,
      ensureStatus: async () => {},
      ensureLabel: async () => {},
      removeLabel: async () => {},
      createIssue: async () => ({ id: "new-1", identifier: "ACK-2", url: "" }),
      listTeams: async () => [],
    } satisfies IssueTracker;

    const type = makeTestCritterType({
      trigger: { label: "Critter", status: "Todo" },
      claimStatus: "In Progress",
    });
    const config = makeTestConfig({
      provider: "linear",
      repos: { default: { url: "https://github.com/acme/app" } },
      critterTypes: [type],
    });
    const trackers = new Map<string, IssueTracker>([["linear", tracker]]);
    const dispatch = mock((_task, _type) => {
      expect(updateStatus).toHaveBeenCalledTimes(1);
      return Promise.resolve({ success: true });
    });
    const watcher = new UnifiedWatcher(config, trackers, { dispatch } as never);

    const dispatched = await watcher.pollForIssue("ACK-1");

    expect(dispatched).toBe(1);
    expect(findIssues).not.toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledWith("issue-1", "In Progress", "team-1", "ACK-1");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
