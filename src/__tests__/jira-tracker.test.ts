import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { adfToPlainText, extractPlainText, JiraTracker } from "../tracker/jira.js";

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

describe("JiraTracker", () => {
  const tracker = new JiraTracker("mycompany.atlassian.net", "user@example.com", "token123", {
    "In Progress": "Working",
    "Critter Failed": "Failed",
  });

  describe("init", () => {
    test("verifies credentials with /myself", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse({ displayName: "Test User", emailAddress: "user@example.com" }),
      );

      await tracker.init();

      expect(mockFetchFn).toHaveBeenCalledTimes(1);
      const call = mockFetchFn.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toBe("https://mycompany.atlassian.net/rest/api/3/myself");
      expect(call[1].headers).toMatchObject({
        Authorization: expect.stringContaining("Basic "),
      });
    });
  });

  describe("findIssues", () => {
    test("queries JQL and maps fields to TrackerTask", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse({
          issues: [
            {
              id: "10001",
              key: "PROJ-42",
              fields: {
                summary: "Fix the bug",
                description: {
                  type: "doc",
                  version: 1,
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "repo: git@github.com:org/repo.git" }],
                    },
                  ],
                },
                labels: ["Critter", "backend"],
                project: { id: "10000", key: "PROJ", name: "My Project" },
                issuelinks: [],
              },
              renderedFields: {
                description: "<p>repo: git@github.com:org/repo.git</p>",
              },
            },
          ],
          total: 1,
        }),
      );

      const tasks = await tracker.findIssues({ label: "Critter", status: "To Do" });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("10001");
      expect(tasks[0].identifier).toBe("PROJ-42");
      expect(tasks[0].title).toBe("Fix the bug");
      expect(tasks[0].group).toBe("My Project");
      expect(tasks[0].groupId).toBe("PROJ");
      expect(tasks[0].labels).toEqual(["Critter", "backend"]);
      expect(tasks[0].description).toContain("repo: git@github.com:org/repo.git");
    });

    test("includes assignee in JQL when set", async () => {
      mockFetchFn.mockResolvedValueOnce(mockResponse({ issues: [], total: 0 }));

      await tracker.findIssues({ label: "Critter", status: "To Do", assignee: "alice@company.com" });

      const call = mockFetchFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.jql).toContain('AND assignee = "alice@company.com"');
    });

    test("uses currentUser() for assignee 'me'", async () => {
      mockFetchFn.mockResolvedValueOnce(mockResponse({ issues: [], total: 0 }));

      await tracker.findIssues({ label: "Critter", status: "To Do", assignee: "me" });

      const call = mockFetchFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.jql).toContain("AND assignee = currentUser()");
    });

    test("omits assignee from JQL when not set", async () => {
      mockFetchFn.mockResolvedValueOnce(mockResponse({ issues: [], total: 0 }));

      await tracker.findIssues({ label: "Critter", status: "To Do" });

      const call = mockFetchFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.jql).not.toContain("assignee");
    });

    test("detects blockers from issue links", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse({
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
                    inwardIssue: {
                      key: "PROJ-40",
                      fields: { status: { name: "In Progress" } },
                    },
                  },
                ],
              },
              renderedFields: { description: "" },
            },
          ],
          total: 1,
        }),
      );

      const tasks = await tracker.findIssues({ label: "Critter", status: "To Do" });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].blockedBy).toEqual([
        { identifier: "PROJ-40", status: "In Progress" },
      ]);
    });
  });

  describe("findIssueByIdentifier", () => {
    test("returns issue details", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse({
          id: "10001",
          key: "PROJ-42",
          fields: {
            status: { name: "To Do" },
            labels: ["Critter"],
            project: { id: "10000", key: "PROJ", name: "My Project" },
          },
        }),
      );

      const issue = await tracker.findIssueByIdentifier("PROJ-42");

      expect(issue).not.toBeNull();
      expect(issue?.id).toBe("10001");
      expect(issue?.identifier).toBe("PROJ-42");
      expect(issue?.statusName).toBe("To Do");
      expect(issue?.labels).toEqual(["Critter"]);
      expect(issue?.groupId).toBe("PROJ");
    });

    test("returns null on 404", async () => {
      mockFetchFn.mockResolvedValueOnce(
        new Response("Not found", { status: 404 }),
      );

      const issue = await tracker.findIssueByIdentifier("PROJ-999");
      expect(issue).toBeNull();
    });
  });

  describe("updateStatus", () => {
    test("uses statusMap and finds transition", async () => {
      // First call: get transitions
      mockFetchFn.mockResolvedValueOnce(
        mockResponse({
          transitions: [
            { id: "11", name: "Start Progress", to: { name: "Working" } },
            { id: "21", name: "Done", to: { name: "Done" } },
          ],
        }),
      );
      // Second call: execute transition
      mockFetchFn.mockResolvedValueOnce(mockResponse({}));

      await tracker.updateStatus("10001", "In Progress", "PROJ");

      const transitionCall = mockFetchFn.mock.calls[1] as [string, RequestInit];
      expect(transitionCall[0]).toContain("/issue/10001/transitions");
      const body = JSON.parse(transitionCall[1].body as string);
      expect(body.transition.id).toBe("11");
    });

    test("logs error but does not throw when transition is rejected", async () => {
      // First call: get transitions
      mockFetchFn.mockResolvedValueOnce(
        mockResponse({
          transitions: [
            { id: "31", name: "In Review", to: { name: "In Review" } },
          ],
        }),
      );
      // Second call: transition rejected (e.g. sprint requirement)
      mockFetchFn.mockResolvedValueOnce(
        mockResponse(
          { errorMessages: ["Tickets must be added to a sprint before they can move to in-progress statuses"] },
          400,
        ),
      );

      // Should not throw
      await tracker.updateStatus("10001", "In Review", "PROJ");
    });
  });

  describe("comment", () => {
    test("posts ADF comment", async () => {
      mockFetchFn.mockResolvedValueOnce(mockResponse({}));

      await tracker.comment("10001", "Hello world");

      const call = mockFetchFn.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toContain("/issue/10001/comment");
      const body = JSON.parse(call[1].body as string);
      expect(body.body.type).toBe("doc");
      expect(body.body.content[0].content[0].text).toBe("Hello world");
    });
  });

  describe("getComments", () => {
    test("returns plain text from ADF comments", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse({
          comments: [
            {
              body: {
                type: "doc",
                version: 1,
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "PR created: https://github.com/org/repo/pull/42" }],
                  },
                ],
              },
            },
          ],
        }),
      );

      const comments = await tracker.getComments("10001");

      expect(comments).toHaveLength(1);
      expect(comments[0]).toContain("PR created: https://github.com/org/repo/pull/42");
    });
  });

  describe("ensureStatus", () => {
    test("is a no-op for Jira", async () => {
      await tracker.ensureStatus("PROJ", "Critter Failed");
      expect(mockFetchFn).not.toHaveBeenCalled();
    });
  });

  describe("ensureLabel", () => {
    test("is a no-op for Jira", async () => {
      await tracker.ensureLabel("Critter");
      expect(mockFetchFn).not.toHaveBeenCalled();
    });
  });

  describe("listTeams", () => {
    test("fetches projects and maps to TrackerTeam shape", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse({
          values: [
            { id: "10001", name: "My Project", key: "PROJ" },
            { id: "10002", name: "Backend", key: "BACK" },
          ],
        }),
      );

      const teams = await tracker.listTeams();

      expect(teams).toEqual([
        { id: "PROJ", name: "My Project", key: "PROJ" },
        { id: "BACK", name: "Backend", key: "BACK" },
      ]);
      const call = mockFetchFn.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toContain("/project/search");
    });

    test("returns empty array when no projects exist", async () => {
      mockFetchFn.mockResolvedValueOnce(mockResponse({ values: [] }));

      const teams = await tracker.listTeams();
      expect(teams).toEqual([]);
    });
  });

  describe("createIssue", () => {
    test("creates issue with correct ADF description and labels", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse({ id: "10042", key: "PROJ-42", self: "https://mycompany.atlassian.net/rest/api/3/issue/10042" }),
      );

      await tracker.createIssue({
        teamId: "PROJ",
        title: "Fix bug",
        description: "Details here",
        labelNames: ["Critter"],
      });

      const call = mockFetchFn.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toContain("/issue");
      expect(call[1].method).toBe("POST");
      const body = JSON.parse(call[1].body as string);
      expect(body.fields.project).toEqual({ key: "PROJ" });
      expect(body.fields.summary).toBe("Fix bug");
      expect(body.fields.labels).toEqual(["Critter"]);
      expect(body.fields.issuetype).toEqual({ name: "Task" });
      expect(body.fields.description).toEqual({
        type: "doc",
        version: 1,
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "Details here" }],
        }],
      });
    });

    test("returns correct identifier and URL", async () => {
      mockFetchFn.mockResolvedValueOnce(
        mockResponse({ id: "10042", key: "PROJ-42", self: "https://mycompany.atlassian.net/rest/api/3/issue/10042" }),
      );

      const result = await tracker.createIssue({
        teamId: "PROJ",
        title: "Fix bug",
        description: "Details here",
        labelNames: ["Critter"],
      });

      expect(result).toEqual({
        id: "10042",
        identifier: "PROJ-42",
        url: "https://mycompany.atlassian.net/browse/PROJ-42",
      });
    });
  });
});

describe("extractPlainText", () => {
  test("strips HTML tags", () => {
    expect(extractPlainText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  test("converts br to newlines", () => {
    expect(extractPlainText("line1<br/>line2")).toBe("line1\nline2");
  });

  test("converts list items", () => {
    expect(extractPlainText("<ul><li>item 1</li><li>item 2</li></ul>")).toBe("- item 1\n- item 2");
  });

  test("returns empty string for empty input", () => {
    expect(extractPlainText("")).toBe("");
  });
});

describe("adfToPlainText", () => {
  test("converts simple paragraph", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello world" }],
        },
      ],
    };
    expect(adfToPlainText(adf).trim()).toBe("Hello world");
  });

  test("converts nested content", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "repo: " },
            { type: "text", text: "git@github.com:org/repo.git" },
          ],
        },
      ],
    };
    expect(adfToPlainText(adf).trim()).toBe("repo: git@github.com:org/repo.git");
  });

  test("returns empty string for null/undefined", () => {
    expect(adfToPlainText(null)).toBe("");
    expect(adfToPlainText(undefined)).toBe("");
  });

  test("converts bullet list", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item 1" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item 2" }] }] },
          ],
        },
      ],
    };
    const result = adfToPlainText(adf);
    expect(result).toContain("item 1");
    expect(result).toContain("item 2");
  });
});
