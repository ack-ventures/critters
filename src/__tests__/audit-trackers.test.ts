import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { JiraTracker } from "../tracker/jira.js";
import type { IssueTracker, IssueTrackerIssue, TrackerTask } from "../tracker/types.js";

// ── Jira fetch mock (used by B11 / B17 / F2 / 4xx tests) ─────────────────────
const originalFetch = globalThis.fetch;
let mockFetchFn: ReturnType<typeof mock>;

beforeEach(() => {
  mockFetchFn = mock(() =>
    Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
  );
  globalThis.fetch = mockFetchFn as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── B11: blocker "done" detection via statusCategory ─────────────────────────
describe("B11 — Jira blocker detection uses statusCategory", () => {
  const tracker = new JiraTracker("co.atlassian.net", "u@e.com", "tok");

  function blockedIssueResponse(blockerStatus: { name: string; statusCategory?: { key: string } }) {
    return mockResponse({
      issues: [
        {
          id: "10002",
          key: "PROJ-43",
          fields: {
            summary: "Blocked task",
            description: null,
            labels: ["Critter"],
            project: { id: "10000", key: "PROJ", name: "My Project" },
            issuelinks: [
              {
                type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
                inwardIssue: { key: "PROJ-40", fields: { status: blockerStatus } },
              },
            ],
          },
          renderedFields: { description: "" },
        },
      ],
      isLast: true,
    });
  }

  test("excludes a blocker whose statusCategory is 'done' even with a custom status name", async () => {
    // A custom done status named "Shipped to Prod" — old name-based code would
    // have (wrongly) treated this as still blocking.
    mockFetchFn.mockResolvedValueOnce(
      blockedIssueResponse({ name: "Shipped to Prod", statusCategory: { key: "done" } }),
    );

    const tasks = await tracker.findIssues({ label: "Critter", status: "To Do" });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].blockedBy).toBeUndefined();
  });

  test("includes a blocker whose statusCategory is not 'done'", async () => {
    mockFetchFn.mockResolvedValueOnce(
      blockedIssueResponse({ name: "In Progress", statusCategory: { key: "indeterminate" } }),
    );

    const tasks = await tracker.findIssues({ label: "Critter", status: "To Do" });

    expect(tasks[0].blockedBy).toEqual([{ identifier: "PROJ-40", status: "In Progress" }]);
  });

  test("treats a blocker with missing statusCategory as still blocking (safe default)", async () => {
    mockFetchFn.mockResolvedValueOnce(blockedIssueResponse({ name: "Mystery" }));

    const tasks = await tracker.findIssues({ label: "Critter", status: "To Do" });

    expect(tasks[0].blockedBy).toEqual([{ identifier: "PROJ-40", status: "Mystery" }]);
  });
});

// ── B17: statusMap webhook round-trip ────────────────────────────────────────
describe("B17 — findIssueByIdentifier reverse-maps statusMap", () => {
  const tracker = new JiraTracker("co.atlassian.net", "u@e.com", "tok", {
    Todo: "To Do",
    "In Progress": "Working",
  });

  test("reverse-maps the raw Jira status name back to the internal critter status", async () => {
    mockFetchFn.mockResolvedValueOnce(
      mockResponse({
        id: "1",
        key: "PROJ-1",
        fields: {
          status: { name: "To Do" },
          labels: ["Critter"],
          project: { id: "10000", key: "PROJ", name: "My Project" },
        },
      }),
    );

    const issue = await tracker.findIssueByIdentifier("PROJ-1");

    // Internal status "Todo" — matches a trigger configured with status: "Todo"
    // (the webhook path compares issue.statusName === trigger.status).
    expect(issue?.statusName).toBe("Todo");
  });

  test("round-trips: poll forward-maps to JQL, findIssueByIdentifier reverse-maps back", async () => {
    // Poll path: trigger status "Todo" must be forward-mapped to "To Do" in JQL.
    mockFetchFn.mockResolvedValueOnce(mockResponse({ issues: [], isLast: true }));
    await tracker.findIssues({ label: "Critter", status: "Todo" });
    const searchBody = JSON.parse((mockFetchFn.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(searchBody.jql).toContain('status = "To Do"');

    // Webhook path: the same issue resolves back to the internal "Todo".
    mockFetchFn.mockResolvedValueOnce(
      mockResponse({
        id: "1",
        key: "PROJ-1",
        fields: {
          status: { name: "To Do" },
          labels: ["Critter"],
          project: { id: "10000", key: "PROJ", name: "My Project" },
        },
      }),
    );
    const issue = await tracker.findIssueByIdentifier("PROJ-1");
    expect(issue?.statusName).toBe("Todo");
  });

  test("leaves unmapped status names untouched", async () => {
    mockFetchFn.mockResolvedValueOnce(
      mockResponse({
        id: "1",
        key: "PROJ-1",
        fields: {
          status: { name: "Backlog" },
          labels: ["Critter"],
          project: { id: "10000", key: "PROJ", name: "My Project" },
        },
      }),
    );

    const issue = await tracker.findIssueByIdentifier("PROJ-1");
    expect(issue?.statusName).toBe("Backlog");
  });
});

// ── F2: pagination + ORDER BY ────────────────────────────────────────────────
describe("F2 — Jira findIssues paginates and orders", () => {
  const tracker = new JiraTracker("co.atlassian.net", "u@e.com", "tok");

  function pageIssue(key: string) {
    return {
      id: key,
      key,
      fields: {
        summary: key,
        description: null,
        labels: ["Critter"],
        project: { id: "10000", key: "PROJ", name: "My Project" },
        issuelinks: [],
      },
      renderedFields: { description: "" },
    };
  }

  test("follows nextPageToken until isLast", async () => {
    mockFetchFn.mockResolvedValueOnce(
      mockResponse({ issues: [pageIssue("PROJ-1")], isLast: false, nextPageToken: "tok-2" }),
    );
    mockFetchFn.mockResolvedValueOnce(
      mockResponse({ issues: [pageIssue("PROJ-2")], isLast: true }),
    );

    const tasks = await tracker.findIssues({ label: "Critter", status: "To Do" });

    expect(tasks.map((t) => t.identifier)).toEqual(["PROJ-1", "PROJ-2"]);
    expect(mockFetchFn).toHaveBeenCalledTimes(2);
    // Second request carries the page cursor.
    const secondBody = JSON.parse((mockFetchFn.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(secondBody.nextPageToken).toBe("tok-2");
  });

  test("adds a stable ORDER BY clause to the JQL", async () => {
    mockFetchFn.mockResolvedValueOnce(mockResponse({ issues: [], isLast: true }));

    await tracker.findIssues({ label: "Critter", status: "To Do" });

    const body = JSON.parse((mockFetchFn.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.jql).toContain("ORDER BY created ASC");
  });
});

// ── 4xx fast-fail ────────────────────────────────────────────────────────────
describe("4xx fast-fail — findIssues does not retry non-transient errors", () => {
  const tracker = new JiraTracker("co.atlassian.net", "u@e.com", "tok");

  test("a 400 response fails immediately without retrying", async () => {
    mockFetchFn.mockResolvedValue(new Response("bad jql", { status: 400 }));

    await expect(tracker.findIssues({ label: "Critter", status: "To Do" })).rejects.toThrow();
    // No retries: exactly one HTTP call.
    expect(mockFetchFn).toHaveBeenCalledTimes(1);
  });
});

// ── B12: config-aware single-issue retry ─────────────────────────────────────
// Mock ONLY createTracker (not loadConfig — mocking the config module leaks into
// other test files). runRetry therefore runs against the real repo config, whose
// `review` type has a non-default trigger.status ("In Review") — exactly the case
// the hardcoded-"Todo" implementation got wrong.
const mockFindIssueByIdentifier = mock<() => Promise<IssueTrackerIssue | null>>(() => Promise.resolve(null));
const mockUpdateStatus = mock(() => Promise.resolve());
const mockComment = mock(() => Promise.resolve());

const retryTracker: IssueTracker = {
  provider: "linear",
  init: mock(() => Promise.resolve()),
  findIssues: mock<() => Promise<TrackerTask[]>>(() => Promise.resolve([])),
  findIssueByIdentifier: mockFindIssueByIdentifier,
  updateStatus: mockUpdateStatus,
  comment: mockComment,
  getComments: mock(() => Promise.resolve([])),
  uploadAttachment: mock(() => Promise.resolve(null)),
  getAttachments: mock(() => Promise.resolve([])),
  fetchAttachmentContent: mock(() => Promise.resolve(null)),
  ensureStatus: mock(() => Promise.resolve()),
  ensureLabel: mock(() => Promise.resolve()),
  removeLabel: mock(() => Promise.resolve()),
  createIssue: mock(() => Promise.reject(new Error("not implemented"))),
  listTeams: mock(() => Promise.resolve([])),
};

mock.module("../tracker/index.js", () => ({
  createTracker: () => retryTracker,
}));

process.env.LINEAR_API_KEY = process.env.LINEAR_API_KEY || "test-key";

const { runRetry } = await import("../cli-retry.js");

describe("B12 — runRetry is config-aware", () => {
  beforeEach(() => {
    mockFindIssueByIdentifier.mockReset();
    mockUpdateStatus.mockReset();
    mockComment.mockReset();
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    spyOn(console, "error").mockImplementation(() => {});
    spyOn(console, "log").mockImplementation(() => {});
  });

  // The repo config's `review` type: trigger { label "Critter Review", status
  // "In Review" }, failure status "Critter Failed".
  function makeReviewIssue(statusName: string): IssueTrackerIssue {
    return {
      id: "issue-9",
      identifier: "REV-9",
      statusName,
      labels: ["Critter Review"],
      groupId: "team-9",
    };
  }

  test("retries to the matched type's trigger.status (In Review), not hardcoded 'Todo'", async () => {
    mockFindIssueByIdentifier.mockResolvedValueOnce(makeReviewIssue("Critter Failed"));

    await runRetry("REV-9", false);

    // The review type's trigger status is "In Review" — the old hardcoded
    // implementation would have set "Todo" here.
    expect(mockUpdateStatus).toHaveBeenCalledWith("issue-9", "In Review", "team-9");
    expect(mockComment).toHaveBeenCalledWith("issue-9", "Retry triggered via CLI");
  });

  test("is a no-op when already in the matched type's trigger status", async () => {
    // "In Review" is the review type's trigger status, so this is a no-op — the
    // old code treated "In Review" as "currently being worked on" and errored.
    mockFindIssueByIdentifier.mockResolvedValueOnce(makeReviewIssue("In Review"));

    await runRetry("REV-9", false);

    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  test("rejects an issue lacking any configured trigger label", async () => {
    mockFindIssueByIdentifier.mockResolvedValueOnce({
      id: "issue-9",
      identifier: "REV-9",
      statusName: "Critter Failed",
      labels: ["Unrelated"],
      groupId: "team-9",
    });

    await expect(runRetry("REV-9", false)).rejects.toThrow("process.exit called");
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });
});
