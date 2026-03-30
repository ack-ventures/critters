import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GitHubTracker } from "../tracker/github.js";

// Mock global fetch
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

describe("GitHubTracker", () => {
  const tracker = new GitHubTracker("ghp_testtoken", ["acme/widgets", "acme/api"]);

  describe("init", () => {
    test("verifies credentials with /user", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse({ login: "testuser" }),
      );

      await tracker.init();

      expect(mockFetchFn).toHaveBeenCalledTimes(1);
      const call = mockFetchFn.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toBe("https://api.github.com/user");
      expect(call[1].headers).toMatchObject({
        Authorization: "Bearer ghp_testtoken",
      });
    });
  });

  describe("findIssues", () => {
    test("queries issues and maps to TrackerTask with auto-filled repoUrl", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse([
          {
            id: 1001,
            number: 42,
            title: "Fix the widget",
            body: "The widget is broken.\n\nPlease fix it.",
            state: "open",
            html_url: "https://github.com/acme/widgets/issues/42",
            updated_at: "2026-03-28T12:00:00Z",
            labels: [{ name: "Critter" }, { name: "bug" }],
          },
        ]),
      );
      // Second repo returns empty
      mockFetchFn.mockResolvedValueOnce(mockResponse([]));

      const tasks = await tracker.findIssues({ label: "Critter", status: "Todo" });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("acme/widgets/42");
      expect(tasks[0].identifier).toBe("acme/widgets#42");
      expect(tasks[0].title).toBe("Fix the widget");
      expect(tasks[0].repoUrl).toBe("git@github.com:acme/widgets.git");
      expect(tasks[0].group).toBe("acme/widgets");
      expect(tasks[0].groupId).toBe("acme/widgets");
      expect(tasks[0].labels).toEqual(["Critter", "bug"]);
      expect(tasks[0].issueUrl).toBe("https://github.com/acme/widgets/issues/42");
    });

    test("filters out pull requests from results", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse([
          {
            id: 1001,
            number: 42,
            title: "Real issue",
            body: "",
            state: "open",
            html_url: "https://github.com/acme/widgets/issues/42",
            updated_at: "2026-03-28T12:00:00Z",
            labels: [{ name: "Critter" }],
          },
          {
            id: 1002,
            number: 43,
            title: "A pull request",
            body: "",
            state: "open",
            html_url: "https://github.com/acme/widgets/pull/43",
            updated_at: "2026-03-28T12:00:00Z",
            labels: [{ name: "Critter" }],
            pull_request: { url: "https://api.github.com/repos/acme/widgets/pulls/43" },
          },
        ]),
      );
      mockFetchFn.mockResolvedValueOnce(mockResponse([]));

      const tasks = await tracker.findIssues({ label: "Critter", status: "Todo" });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].identifier).toBe("acme/widgets#42");
    });

    test("skips issues with status labels when looking for Todo/unstarted", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse([
          {
            id: 1001,
            number: 42,
            title: "Not started",
            body: "",
            state: "open",
            html_url: "https://github.com/acme/widgets/issues/42",
            updated_at: "2026-03-28T12:00:00Z",
            labels: [{ name: "Critter" }],
          },
          {
            id: 1002,
            number: 43,
            title: "Already in progress",
            body: "",
            state: "open",
            html_url: "https://github.com/acme/widgets/issues/43",
            updated_at: "2026-03-28T12:00:00Z",
            labels: [{ name: "Critter" }, { name: "critter:in-progress" }],
          },
        ]),
      );
      mockFetchFn.mockResolvedValueOnce(mockResponse([]));

      const tasks = await tracker.findIssues({ label: "Critter", status: "Todo" });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].identifier).toBe("acme/widgets#42");
    });

    test("includes assignee in query when set", async () => {
      // Init first to set authenticatedUser
      mockFetchFn.mockResolvedValueOnce(mockResponse({ login: "testuser" }));
      await tracker.init();

      mockFetchFn.mockResolvedValueOnce(mockResponse([]));
      mockFetchFn.mockResolvedValueOnce(mockResponse([]));

      await tracker.findIssues({ label: "Critter", status: "Todo", assignee: "alice" });

      const call = mockFetchFn.mock.calls[1] as [string, RequestInit];
      expect(call[0]).toContain("assignee=alice");
    });

    test("resolves 'me' to authenticated user", async () => {
      mockFetchFn.mockResolvedValueOnce(mockResponse({ login: "testuser" }));
      await tracker.init();

      mockFetchFn.mockResolvedValueOnce(mockResponse([]));
      mockFetchFn.mockResolvedValueOnce(mockResponse([]));

      await tracker.findIssues({ label: "Critter", status: "Todo", assignee: "me" });

      const call = mockFetchFn.mock.calls[1] as [string, RequestInit];
      expect(call[0]).toContain("assignee=testuser");
    });

    test("parses blockers from issue body", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse([
          {
            id: 1001,
            number: 42,
            title: "Blocked task",
            body: "This is blocked by #10 and blocked by other/repo#5",
            state: "open",
            html_url: "https://github.com/acme/widgets/issues/42",
            updated_at: "2026-03-28T12:00:00Z",
            labels: [{ name: "Critter" }],
          },
        ]),
      );
      mockFetchFn.mockResolvedValueOnce(mockResponse([]));

      const tasks = await tracker.findIssues({ label: "Critter", status: "Todo" });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].blockedBy).toEqual([
        { identifier: "acme/widgets#10", status: "open" },
        { identifier: "other/repo#5", status: "open" },
      ]);
    });
  });

  describe("findIssueByIdentifier", () => {
    test("returns issue details", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse({
          id: 1001,
          number: 42,
          title: "Fix the widget",
          state: "open",
          labels: [{ name: "Critter" }],
        }),
      );

      const issue = await tracker.findIssueByIdentifier("acme/widgets#42");

      expect(issue).not.toBeNull();
      expect(issue?.id).toBe("acme/widgets/42");
      expect(issue?.identifier).toBe("acme/widgets#42");
      expect(issue?.statusName).toBe("Todo");
      expect(issue?.labels).toEqual(["Critter"]);
      expect(issue?.groupId).toBe("acme/widgets");
    });

    test("resolves status from labels", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse({
          id: 1001,
          number: 42,
          state: "open",
          labels: [{ name: "Critter" }, { name: "critter:in-progress" }],
        }),
      );

      const issue = await tracker.findIssueByIdentifier("acme/widgets#42");
      expect(issue?.statusName).toBe("In Progress");
    });

    test("returns Done for closed issues", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse({
          id: 1001,
          number: 42,
          state: "closed",
          labels: [{ name: "Critter" }],
        }),
      );

      const issue = await tracker.findIssueByIdentifier("acme/widgets#42");
      expect(issue?.statusName).toBe("Done");
    });

    test("returns null for invalid identifier format", async () => {
      const issue = await tracker.findIssueByIdentifier("invalid");
      expect(issue).toBeNull();
    });

    test("returns null on API error", async () => {
      mockFetchFn.mockResolvedValueOnce(
        new Response("Not found", { status: 404 }),
      );

      const issue = await tracker.findIssueByIdentifier("acme/widgets#999");
      expect(issue).toBeNull();
    });
  });

  describe("updateStatus", () => {
    test("adds status label for In Progress", async () => {
      // Remove existing status labels (4 DELETE calls, some may fail)
      mockFetchFn.mockResolvedValue(mockResponse({}));

      await tracker.updateStatus("acme/widgets/42", "In Progress", "acme/widgets");

      // Should PATCH to reopen + POST to add label
      const calls = mockFetchFn.mock.calls as Array<[string, RequestInit]>;
      const patchCall = calls.find((c) => c[1].method === "PATCH");
      expect(patchCall).toBeDefined();
      expect(JSON.parse(patchCall![1].body as string)).toMatchObject({ state: "open" });

      const postCall = calls.find((c) => c[1].method === "POST" && c[0].includes("/labels"));
      expect(postCall).toBeDefined();
      expect(JSON.parse(postCall![1].body as string)).toMatchObject({
        labels: ["critter:in-progress"],
      });
    });

    test("closes issue for Done status", async () => {
      mockFetchFn.mockResolvedValue(mockResponse({}));

      await tracker.updateStatus("acme/widgets/42", "Done", "acme/widgets");

      const calls = mockFetchFn.mock.calls as Array<[string, RequestInit]>;
      const patchCall = calls.find((c) => c[1].method === "PATCH");
      expect(patchCall).toBeDefined();
      expect(JSON.parse(patchCall![1].body as string)).toMatchObject({
        state: "closed",
        state_reason: "completed",
      });
    });
  });

  describe("comment", () => {
    test("posts comment to correct issue", async () => {
      mockFetchFn.mockResolvedValueOnce(mockResponse({}));

      await tracker.comment("acme/widgets/42", "PR created: https://github.com/acme/widgets/pull/10");

      const call = mockFetchFn.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toBe("https://api.github.com/repos/acme/widgets/issues/42/comments");
      expect(call[1].method).toBe("POST");
      expect(JSON.parse(call[1].body as string)).toMatchObject({
        body: "PR created: https://github.com/acme/widgets/pull/10",
      });
    });
  });

  describe("getComments", () => {
    test("returns comment bodies", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse([
          { body: "First comment" },
          { body: "PR created: https://github.com/acme/widgets/pull/10" },
        ]),
      );

      const comments = await tracker.getComments("acme/widgets/42");

      expect(comments).toEqual([
        "First comment",
        "PR created: https://github.com/acme/widgets/pull/10",
      ]);
    });
  });

  describe("uploadAttachment", () => {
    test("returns null (not supported)", async () => {
      const result = await tracker.uploadAttachment("acme/widgets/42", "log.txt", Buffer.from("data"), "text/plain");
      expect(result).toBeNull();
    });
  });

  describe("ensureStatus", () => {
    test("is a no-op for GitHub", async () => {
      await tracker.ensureStatus("acme/widgets", "Critter Failed");
      expect(mockFetchFn).not.toHaveBeenCalled();
    });
  });

  describe("ensureLabel", () => {
    test("creates label in all configured repos", async () => {
      mockFetchFn.mockResolvedValue(mockResponse({}));

      await tracker.ensureLabel("Critter");

      expect(mockFetchFn).toHaveBeenCalledTimes(2);
      const calls = mockFetchFn.mock.calls as Array<[string, RequestInit]>;
      expect(calls[0][0]).toContain("/repos/acme/widgets/labels");
      expect(calls[1][0]).toContain("/repos/acme/api/labels");
      expect(JSON.parse(calls[0][1].body as string)).toMatchObject({ name: "Critter" });
    });

    test("ignores 422 (label already exists)", async () => {
      mockFetchFn.mockRejectedValue(new Error("GitHub API error: 422 Unprocessable Entity"));

      // Should not throw
      await tracker.ensureLabel("Critter");
    });
  });

  describe("removeLabel", () => {
    test("sends DELETE request", async () => {
      mockFetchFn.mockResolvedValueOnce(mockResponse({}));

      await tracker.removeLabel("acme/widgets/42", "Critter");

      const call = mockFetchFn.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toBe("https://api.github.com/repos/acme/widgets/issues/42/labels/Critter");
      expect(call[1].method).toBe("DELETE");
    });
  });

  describe("createIssue", () => {
    test("creates issue with labels", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse({ number: 99, html_url: "https://github.com/acme/widgets/issues/99", id: 2001 }),
      );

      const result = await tracker.createIssue({
        teamId: "acme/widgets",
        title: "New feature",
        description: "Implement the thing",
        labelNames: ["Critter", "enhancement"],
      });

      expect(result).toEqual({
        id: "acme/widgets/99",
        identifier: "acme/widgets#99",
        url: "https://github.com/acme/widgets/issues/99",
      });

      const call = mockFetchFn.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toBe("https://api.github.com/repos/acme/widgets/issues");
      const body = JSON.parse(call[1].body as string);
      expect(body.title).toBe("New feature");
      expect(body.body).toBe("Implement the thing");
      expect(body.labels).toEqual(["Critter", "enhancement"]);
    });
  });

  describe("listTeams", () => {
    test("returns configured repos as teams", async () => {
      const teams = await tracker.listTeams();

      expect(teams).toEqual([
        { id: "acme/widgets", name: "acme/widgets", key: "acme/widgets" },
        { id: "acme/api", name: "acme/api", key: "acme/api" },
      ]);
    });
  });
});
