import { beforeEach, describe, expect, it, mock } from "bun:test";
import { isPermanentTrackerError } from "../task-retry.js";
import { GitHubTracker, parseGitHubIdentifier } from "../tracker/github.js";

// ── Fetch mock scaffolding ───────────────────────────────────────────────────

const mockFetchFn = mock();
globalThis.fetch = mockFetchFn as unknown as typeof fetch;

type RouteValue = { status?: number; body?: unknown; headers?: Record<string, string> };

/**
 * Route-aware mock: keys are "METHOD /path-prefix" (first match wins, so list
 * specific paths before generic ones). Unmocked calls throw — a test that
 * misses a route fails loudly instead of returning a confusing empty 200.
 */
function installApi(routes: Record<string, RouteValue>): void {
  // Longest path prefix first, so "/repos/o/r/issues/42/comments" beats "/repos/o/r".
  const entries = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);
  mockFetchFn.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const path = String(input).replace("https://api.github.com", "");
    for (const [key, route] of entries) {
      const sep = key.indexOf(" ");
      if (method === key.slice(0, sep) && path.startsWith(key.slice(sep + 1))) {
        return new Response(JSON.stringify(route.body ?? {}), {
          status: route.status ?? 200,
          headers: { "Content-Type": "application/json", ...(route.headers ?? {}) },
        });
      }
    }
    throw new Error(`Unmocked fetch: ${method} ${path}`);
  });
}

function callsTo(pathPrefix: string, method = "GET"): unknown[][] {
  return mockFetchFn.mock.calls.filter(
    (c) => String(c[0]).includes(pathPrefix) && ((c[1] as RequestInit | undefined)?.method ?? "GET") === method,
  );
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

// NOTE: no log-content assertions in this file — updater.test.ts globally
// mock.module()s ../logger.js, so logger output never reaches console when the
// full suite runs. Assert observable API behavior instead.

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_FIELD = {
  id: 123,
  name: "Status",
  data_type: "single_select",
  options: [
    { id: 1, name: "Todo" },
    { id: 2, name: "In Progress" },
    { id: 3, name: "In Review" },
    { id: 4, name: "Done" },
    { id: 5, name: "Critter Failed" },
  ],
};

function orgRoutes(org: string, repo: string, fields: unknown = [ORG_FIELD]): Record<string, RouteValue> {
  return {
    "GET /user": { body: { login: "octocat" } },
    [`GET /repos/${org}/${repo}`]: { body: { owner: { type: "Organization" } } },
    [`GET /orgs/${org}/issue-fields`]: { body: fields },
  };
}

function userRoutes(owner: string, repo: string): Record<string, RouteValue> {
  return {
    "GET /user": { body: { login: "octocat" } },
    [`GET /repos/${owner}/${repo}`]: { body: { owner: { type: "User" } } },
  };
}

function ghIssue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 42,
    title: "Fix the thing",
    body: "Details here",
    state: "open",
    labels: [{ name: "Critter" }],
    html_url: "https://github.com/myorg/api/issues/42",
    updated_at: "2026-07-01T00:00:00Z",
    repository_url: "https://api.github.com/repos/myorg/api",
    ...overrides,
  };
}

function withStatus(issue: Record<string, unknown>, optionName: string, fieldId = 123): Record<string, unknown> {
  return {
    ...issue,
    issue_field_values: [
      {
        issue_field_id: fieldId,
        issue_field_name: "Status",
        data_type: "single_select",
        value: optionName,
        single_select_option: { id: 1, name: optionName },
      },
    ],
  };
}

async function initOrgTracker(repos = ["myorg/api"], options?: ConstructorParameters<typeof GitHubTracker>[2]): Promise<GitHubTracker> {
  const tracker = new GitHubTracker("tok", repos, options);
  await tracker.init();
  return tracker;
}

beforeEach(() => {
  mockFetchFn.mockReset();
});

// ── init / mode detection ────────────────────────────────────────────────────

describe("init mode detection", () => {
  it("user-owned repo → label mode, no org-fields call", async () => {
    installApi(userRoutes("andrew", "critters"));
    const tracker = new GitHubTracker("tok", ["andrew/critters"]);
    await tracker.init();
    expect(callsTo("/orgs/")).toHaveLength(0);
  });

  it("org repo with matching field → field mode", async () => {
    installApi(orgRoutes("myorg", "api"));
    const tracker = await initOrgTracker();
    // Prove field mode: updateStatus writes a field value, not labels.
    installApi({
      "POST /repos/myorg/api/issues/42/issue-field-values": { body: {} },
    });
    await tracker.updateStatus("myorg/api#42", "In Review", "myorg/api");
    expect(callsTo("/repos/myorg/api/issues/42/issue-field-values", "POST")).toHaveLength(1);
  });

  it("org repo without the field → label mode (proven by label-endpoint writes)", async () => {
    installApi({
      ...orgRoutes("myorg", "api", [{ id: 9, name: "Priority", data_type: "single_select", options: [] }]),
      "POST /repos/myorg/api/labels": { status: 422, body: { errors: [{ code: "already_exists" }] } },
      "GET /repos/myorg/api/issues/42/labels": { body: [] },
      "POST /repos/myorg/api/issues/42/labels": { body: {} },
    });
    const tracker = await initOrgTracker();
    await tracker.updateStatus("myorg/api#42", "In Progress", "myorg/api");
    // Label mode = label endpoints hit, field-value endpoint never touched.
    expect(callsTo("/repos/myorg/api/issues/42/labels", "POST")).toHaveLength(1);
    expect(callsTo("/repos/myorg/api/issues/42/issue-field-values")).toHaveLength(0);
  });

  it("org-fields 403 → degrades to label mode, init resolves", async () => {
    installApi({
      "GET /user": { body: { login: "octocat" } },
      "GET /repos/myorg/api": { body: { owner: { type: "Organization" } } },
      "GET /orgs/myorg/issue-fields": { status: 403, body: { message: "Forbidden" }, headers: { "x-ratelimit-remaining": "100" } },
      "POST /repos/myorg/api/labels": { status: 422, body: { errors: [{ code: "already_exists" }] } },
      "GET /repos/myorg/api/issues/42/labels": { body: [] },
      "POST /repos/myorg/api/issues/42/labels": { body: {} },
    });
    const tracker = new GitHubTracker("tok", ["myorg/api"]);
    await tracker.init(); // must not throw
    // Prove label mode: updateStatus hits label endpoints, not field values.
    await tracker.updateStatus("myorg/api#42", "Todo", "myorg/api");
    expect(callsTo("/repos/myorg/api/issues/42/labels", "POST")).toHaveLength(1);
    expect(callsTo("/repos/myorg/api/issues/42/issue-field-values")).toHaveLength(0);
  });

  it("org-fields 500 → init rejects", async () => {
    installApi({
      "GET /user": { body: { login: "octocat" } },
      "GET /repos/myorg/api": { body: { owner: { type: "Organization" } } },
      "GET /orgs/myorg/issue-fields": { status: 500, body: { message: "boom" } },
    });
    await expect(new GitHubTracker("tok", ["myorg/api"]).init()).rejects.toThrow();
  });

  it("inaccessible repo → init rejects naming the repo", async () => {
    installApi({
      "GET /user": { body: { login: "octocat" } },
      "GET /repos/myorg/ghost": { status: 404, body: { message: "Not Found" } },
    });
    await expect(new GitHubTracker("tok", ["myorg/ghost"]).init()).rejects.toThrow("myorg/ghost");
  });

  it("malformed repo entry → init rejects naming the entry", async () => {
    installApi({ "GET /user": { body: { login: "octocat" } } });
    await expect(new GitHubTracker("tok", ["justowner"]).init()).rejects.toThrow("justowner");
  });

  it("two repos in the same org → org fields fetched once", async () => {
    installApi({
      ...orgRoutes("myorg", "api"),
      "GET /repos/myorg/web": { body: { owner: { type: "Organization" } } },
    });
    await initOrgTracker(["myorg/api", "myorg/web"]);
    expect(callsTo("/orgs/myorg/issue-fields")).toHaveLength(1);
  });
});

// ── findIssues ───────────────────────────────────────────────────────────────

describe("findIssues", () => {
  it("field mode: query params, status filter, PR exclusion, task shape", async () => {
    installApi({
      ...orgRoutes("myorg", "api"),
      "GET /repos/myorg/api/issues": {
        body: [
          withStatus(ghIssue(), "Todo"),
          withStatus(ghIssue({ number: 43 }), "In Progress"), // wrong status
          { ...ghIssue({ number: 44 }), pull_request: { url: "x" }, ...withStatus(ghIssue({ number: 44 }), "Todo") }, // PR
        ],
      },
    });
    const tracker = await initOrgTracker();
    const tasks = await tracker.findIssues({ label: "Critter", status: "Todo" });

    const listCall = callsTo("/repos/myorg/api/issues?")[0];
    expect(String(listCall[0])).toContain("labels=Critter");
    expect(String(listCall[0])).toContain("state=open");
    expect(String(listCall[0])).toContain("per_page=100");
    expect(String(listCall[0])).toContain("sort=created");

    expect(tasks).toHaveLength(1);
    const t = tasks[0];
    expect(t.id).toBe("myorg/api#42");
    expect(t.identifier).toBe("myorg/api#42");
    expect(t.groupId).toBe("myorg/api");
    expect(t.group).toBe("api");
    expect(t.issueUrl).toBe("https://github.com/myorg/api/issues/42");
    expect(t.updatedAt).toBeInstanceOf(Date);
    expect(t.labels).toContain("Critter");
  });

  it("label mode: matches on status:<name> label membership", async () => {
    installApi({
      ...userRoutes("andrew", "critters"),
      "GET /repos/andrew/critters/issues": {
        body: [
          ghIssue({ number: 1, labels: [{ name: "Critter" }, { name: "status:Todo" }] }),
          ghIssue({ number: 2, labels: [{ name: "Critter" }, { name: "status:Doing" }] }),
        ],
      },
    });
    const tracker = new GitHubTracker("tok", ["andrew/critters"]);
    await tracker.init();
    const tasks = await tracker.findIssues({ label: "Critter", status: "Todo" });
    expect(tasks.map((t) => t.identifier)).toEqual(["andrew/critters#1"]);
  });

  it("statusType trigger with configured bucket matches bucket members", async () => {
    installApi({
      ...orgRoutes("myorg", "api"),
      "GET /repos/myorg/api/issues": {
        body: [withStatus(ghIssue({ number: 1 }), "Backlog"), withStatus(ghIssue({ number: 2 }), "In Progress")],
      },
    });
    const tracker = await initOrgTracker(["myorg/api"], { statusTypes: { unstarted: ["Todo", "Backlog"] } });
    const tasks = await tracker.findIssues({ label: "Critter", status: "Todo", statusType: "unstarted" });
    expect(tasks.map((t) => t.identifier)).toEqual(["myorg/api#1"]);
  });

  it("statusType bucket matching in label mode; empty bucket falls back to exact name", async () => {
    installApi({
      ...userRoutes("andrew", "critters"),
      "GET /repos/andrew/critters/issues": {
        body: [
          ghIssue({ number: 1, labels: [{ name: "Critter" }, { name: "status:Backlog" }] }),
          ghIssue({ number: 2, labels: [{ name: "Critter" }, { name: "status:Doing" }] }),
          ghIssue({ number: 3, labels: [{ name: "Critter" }, { name: "status:Todo" }] }),
        ],
      },
    });
    const tracker = new GitHubTracker("tok", ["andrew/critters"], { statusTypes: { unstarted: ["Todo", "Backlog"] } });
    await tracker.init();
    const tasks = await tracker.findIssues({ label: "Critter", status: "Todo", statusType: "unstarted" });
    expect(tasks.map((t) => t.identifier).sort()).toEqual(["andrew/critters#1", "andrew/critters#3"]);

    // Empty bucket array is treated as unconfigured → exact status-name match.
    const emptyBuckets = new GitHubTracker("tok", ["andrew/critters"], { statusTypes: { unstarted: [] } });
    await emptyBuckets.init();
    const exact = await emptyBuckets.findIssues({ label: "Critter", status: "Todo", statusType: "unstarted" });
    expect(exact.map((t) => t.identifier)).toEqual(["andrew/critters#3"]);
  });

  it("statusType trigger without buckets falls back to exact status name", async () => {
    installApi({
      ...orgRoutes("myorg", "api"),
      "GET /repos/myorg/api/issues": {
        body: [withStatus(ghIssue({ number: 1 }), "Backlog"), withStatus(ghIssue({ number: 2 }), "Todo")],
      },
    });
    const tracker = await initOrgTracker();
    const tasks = await tracker.findIssues({ label: "Critter", status: "Todo", statusType: "unstarted" });
    expect(tasks.map((t) => t.identifier)).toEqual(["myorg/api#2"]);
  });

  it("assignee: explicit value passed through; 'me' resolves to token login", async () => {
    installApi({ ...orgRoutes("myorg", "api"), "GET /repos/myorg/api/issues": { body: [] } });
    const tracker = await initOrgTracker();
    await tracker.findIssues({ label: "Critter", status: "Todo", assignee: "me" });
    expect(String(callsTo("/repos/myorg/api/issues?")[0][0])).toContain("assignee=octocat");
    await tracker.findIssues({ label: "Critter", status: "Todo", assignee: "alice" });
    expect(String(callsTo("/repos/myorg/api/issues?")[1][0])).toContain("assignee=alice");
  });

  it("paginates until a short page; caps at 200", async () => {
    const full = Array.from({ length: 100 }, (_, i) =>
      ghIssue({ number: i + 1, labels: [{ name: "Critter" }, { name: "status:Todo" }] }));
    installApi({
      ...userRoutes("andrew", "critters"),
      "GET /repos/andrew/critters/issues": { body: full },
    });
    const tracker = new GitHubTracker("tok", ["andrew/critters"]);
    await tracker.init();
    // Every page returns 100 — without the cap this would be 300+.
    const tasks = await tracker.findIssues({ label: "Critter", status: "Todo" });
    expect(tasks).toHaveLength(200);
    expect(callsTo("/repos/andrew/critters/issues?")).toHaveLength(2);
  });

  it("blockedBy: fetches dependencies only when summary > 0; open blockers only, cross-repo identifiers", async () => {
    installApi({
      ...orgRoutes("myorg", "api"),
      "GET /repos/myorg/api/issues": {
        body: [
          withStatus(ghIssue({ number: 1 }), "Todo"), // no dependencies summary → no extra call
          withStatus(ghIssue({ number: 2, issue_dependencies_summary: { blocked_by: 2 } }), "Todo"),
        ],
      },
      "GET /repos/myorg/api/issues/2/dependencies/blocked_by": {
        body: [
          ghIssue({ number: 7, state: "open", repository_url: "https://api.github.com/repos/other/lib", html_url: "https://github.com/other/lib/issues/7" }),
          ghIssue({ number: 8, state: "closed" }),
        ],
      },
    });
    const tracker = await initOrgTracker();
    const tasks = await tracker.findIssues({ label: "Critter", status: "Todo" });
    expect(callsTo("/dependencies/blocked_by")).toHaveLength(1);
    const withBlocker = tasks.find((t) => t.identifier === "myorg/api#2");
    expect(withBlocker?.blockedBy).toEqual([{ identifier: "other/lib#7", status: "open" }]);
    expect(tasks.find((t) => t.identifier === "myorg/api#1")?.blockedBy).toBeUndefined();
  });

  it("rate-limit 403 (remaining 0) is retried; auth 403 fails fast", async () => {
    // Rate limit: first list call 403s with remaining: 0, retry succeeds.
    let listCalls = 0;
    mockFetchFn.mockImplementation(async (input: unknown) => {
      const path = String(input).replace("https://api.github.com", "");
      if (path.startsWith("/user")) return new Response(JSON.stringify({ login: "octocat" }));
      if (path.startsWith("/orgs/myorg/issue-fields")) return new Response(JSON.stringify([ORG_FIELD]));
      if (path.startsWith("/repos/myorg/api/issues")) {
        listCalls++;
        if (listCalls === 1) {
          return new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
            status: 403,
            headers: { "x-ratelimit-remaining": "0" },
          });
        }
        return new Response(JSON.stringify([]));
      }
      if (path.startsWith("/repos/myorg/api")) return new Response(JSON.stringify({ owner: { type: "Organization" } }));
      throw new Error(`Unmocked ${path}`);
    });
    const tracker = await initOrgTracker();
    const tasks = await tracker.findIssues({ label: "Critter", status: "Todo" });
    expect(tasks).toEqual([]);
    expect(listCalls).toBe(2); // retried — rate-limit errors are not permanent

    // Auth failure: 403 with quota remaining → permanent, no retry.
    listCalls = 0;
    mockFetchFn.mockImplementation(async (input: unknown) => {
      const path = String(input).replace("https://api.github.com", "");
      if (path.startsWith("/user")) return new Response(JSON.stringify({ login: "octocat" }));
      if (path.startsWith("/orgs/myorg/issue-fields")) return new Response(JSON.stringify([ORG_FIELD]));
      if (path.startsWith("/repos/myorg/api/issues")) {
        listCalls++;
        return new Response(JSON.stringify({ message: "Forbidden" }), {
          status: 403,
          headers: { "x-ratelimit-remaining": "100" },
        });
      }
      if (path.startsWith("/repos/myorg/api")) return new Response(JSON.stringify({ owner: { type: "Organization" } }));
      throw new Error(`Unmocked ${path}`);
    });
    await expect(tracker.findIssues({ label: "Critter", status: "Todo" })).rejects.toThrow("403");
    expect(listCalls).toBe(1);
  });

  it("rate-limit error message contains no digits (stays retryable)", async () => {
    // Trigger a REAL rate-limit error through request() (comment has no retry
    // wrapper, so the thrown message is inspectable directly).
    installApi({
      ...userRoutes("andrew", "critters"),
      "POST /repos/andrew/critters/issues/42/comments": {
        status: 403,
        body: { message: "API rate limit exceeded" },
        headers: { "x-ratelimit-remaining": "0", "retry-after": "60" },
      },
    });
    const tracker = new GitHubTracker("tok", ["andrew/critters"]);
    await tracker.init();
    const err = await tracker.comment("andrew/critters#42", "x").catch((e: unknown) => e);
    const message = err instanceof Error ? err.message : String(err);
    expect(/\d/.test(message)).toBe(false);
    expect(isPermanentTrackerError(message)).toBe(false);
  });
});

// ── findIssueByIdentifier ────────────────────────────────────────────────────

describe("findIssueByIdentifier", () => {
  it("returns reverse-mapped status in field mode; '' when unset", async () => {
    installApi({
      ...orgRoutes("myorg", "api"),
      "GET /repos/myorg/api/issues/42": { body: withStatus(ghIssue(), "In progress") },
      "GET /repos/myorg/api/issues/43": { body: ghIssue({ number: 43 }) },
    });
    const tracker = await initOrgTracker(["myorg/api"], { statusMap: { "In Progress": "In progress" } });

    const issue = await tracker.findIssueByIdentifier("myorg/api#42");
    expect(issue?.statusName).toBe("In Progress"); // reverse-mapped to internal name
    expect(issue?.groupId).toBe("myorg/api");

    const unset = await tracker.findIssueByIdentifier("myorg/api#43");
    expect(unset?.statusName).toBe("");
    expect(unset?.statusType).toBeUndefined();
  });

  it("label mode: alphabetically-first status:* label wins", async () => {
    installApi({
      ...userRoutes("andrew", "critters"),
      "GET /repos/andrew/critters/issues/42": {
        body: ghIssue({ labels: [{ name: "Critter" }, { name: "status:Beta" }, { name: "status:Alpha" }] }),
      },
    });
    const tracker = new GitHubTracker("tok", ["andrew/critters"]);
    await tracker.init();
    const issue = await tracker.findIssueByIdentifier("andrew/critters#42");
    expect(issue?.statusName).toBe("Alpha");
  });

  it("null for unparseable identifiers and unconfigured repos — with zero HTTP calls", async () => {
    installApi(userRoutes("andrew", "critters"));
    const tracker = new GitHubTracker("tok", ["andrew/critters"]);
    await tracker.init();
    mockFetchFn.mockClear();

    expect(await tracker.findIssueByIdentifier("PROJ-42")).toBeNull();
    expect(await tracker.findIssueByIdentifier("other/repo#42")).toBeNull();
    expect(await tracker.findIssueByIdentifier("andrew/critters")).toBeNull();
    expect(mockFetchFn.mock.calls).toHaveLength(0);
  });

  it("repo matching is case-insensitive; id is canonicalized to the configured casing", async () => {
    installApi({
      ...orgRoutes("myorg", "api"),
      "GET /repos/MyOrg/API/issues/42": { body: withStatus(ghIssue(), "Todo") },
    });
    const tracker = await initOrgTracker();
    const issue = await tracker.findIssueByIdentifier("MyOrg/API#42");
    // Configured casing ("myorg/api#42") — the dispatch dedup keys on this string.
    expect(issue?.id).toBe("myorg/api#42");
    expect(issue?.identifier).toBe("myorg/api#42");
    expect(issue?.groupId).toBe("myorg/api");
  });

  it("null on 404", async () => {
    installApi({
      ...userRoutes("andrew", "critters"),
      "GET /repos/andrew/critters/issues/99": { status: 404, body: { message: "Not Found" } },
    });
    const tracker = new GitHubTracker("tok", ["andrew/critters"]);
    await tracker.init();
    expect(await tracker.findIssueByIdentifier("andrew/critters#99")).toBeNull();
  });
});

// ── updateStatus ─────────────────────────────────────────────────────────────

describe("updateStatus", () => {
  it("field mode: POSTs (never PUTs) the field value by option name, with statusMap applied", async () => {
    installApi({
      ...orgRoutes("myorg", "api"),
      "POST /repos/myorg/api/issues/42/issue-field-values": { body: {} },
    });
    const tracker = await initOrgTracker(["myorg/api"], { statusMap: { "In Review": "In Review" } });
    await tracker.updateStatus("myorg/api#42", "In Review", "myorg/api");

    const posts = callsTo("/repos/myorg/api/issues/42/issue-field-values", "POST");
    expect(posts).toHaveLength(1);
    expect(callsTo("/repos/myorg/api/issues/42/issue-field-values", "PUT")).toHaveLength(0);
    expect(bodyOf(posts[0])).toEqual({ issue_field_values: [{ field_id: 123, value: "In Review" }] });
  });

  it("field mode: unknown option skips the write", async () => {
    installApi(orgRoutes("myorg", "api"));
    const tracker = await initOrgTracker();
    await tracker.updateStatus("myorg/api#42", "Nonexistent Status", "myorg/api");
    expect(callsTo("/repos/myorg/api/issues/42/issue-field-values", "POST")).toHaveLength(0);
  });

  it("field mode: stale field (404) resolves without throwing", async () => {
    installApi({
      ...orgRoutes("myorg", "api"),
      "POST /repos/myorg/api/issues/42/issue-field-values": { status: 404, body: { message: "Not Found" } },
    });
    const tracker = await initOrgTracker();
    await tracker.updateStatus("myorg/api#42", "Todo", "myorg/api"); // must resolve
  });

  it("label mode: creates label, adds target, removes other status:* labels (URL-encoded)", async () => {
    installApi({
      ...userRoutes("andrew", "critters"),
      "POST /repos/andrew/critters/labels": { status: 422, body: { message: "Validation Failed", errors: [{ code: "already_exists" }] } },
      "GET /repos/andrew/critters/issues/42/labels": { body: [{ name: "status:Todo" }, { name: "bug" }] },
      "POST /repos/andrew/critters/issues/42/labels": { body: {} },
      "DELETE /repos/andrew/critters/issues/42/labels/": { body: {} },
    });
    const tracker = new GitHubTracker("tok", ["andrew/critters"]);
    await tracker.init();
    await tracker.updateStatus("andrew/critters#42", "In Progress", "andrew/critters");

    const addCalls = callsTo("/repos/andrew/critters/issues/42/labels", "POST");
    expect(addCalls).toHaveLength(1);
    expect(bodyOf(addCalls[0])).toEqual({ labels: ["status:In Progress"] });

    const deletes = callsTo("/repos/andrew/critters/issues/42/labels/", "DELETE");
    expect(deletes).toHaveLength(1); // "bug" is not a status label — untouched
    expect(String(deletes[0][0])).toContain("status%3ATodo");
  });

  it("never throws, in either mode, at any step", async () => {
    // Field mode with everything 500ing
    installApi({
      ...orgRoutes("myorg", "api"),
      "POST /repos/myorg/api/issues/42/issue-field-values": { status: 500, body: {} },
    });
    const fieldTracker = await initOrgTracker();
    await fieldTracker.updateStatus("myorg/api#42", "Todo", "myorg/api");

    // Label mode with everything 500ing (label create, list, add, delete)
    installApi({
      ...userRoutes("andrew", "critters"),
      "POST /repos/andrew/critters/labels": { status: 500, body: {} },
      "GET /repos/andrew/critters/issues/42/labels": { status: 500, body: {} },
    });
    const labelTracker = new GitHubTracker("tok", ["andrew/critters"]);
    await labelTracker.init();
    await labelTracker.updateStatus("andrew/critters#42", "Todo", "andrew/critters");

    // Unparseable / unconfigured ids also no-op
    await labelTracker.updateStatus("PROJ-42", "Todo", "x");
    await labelTracker.updateStatus("other/repo#1", "Todo", "other/repo");
  });
});

// ── comment / getComments ────────────────────────────────────────────────────

describe("comments", () => {
  it("comment posts markdown body; getComments maps bodies", async () => {
    installApi({
      ...userRoutes("andrew", "critters"),
      "POST /repos/andrew/critters/issues/42/comments": { body: {} },
      "GET /repos/andrew/critters/issues/42/comments": { body: [{ body: "first" }, { body: "second" }] },
    });
    const tracker = new GitHubTracker("tok", ["andrew/critters"]);
    await tracker.init();

    await tracker.comment("andrew/critters#42", "hello **world**");
    expect(bodyOf(callsTo("/repos/andrew/critters/issues/42/comments", "POST")[0])).toEqual({ body: "hello **world**" });

    const comments = await tracker.getComments("andrew/critters#42");
    expect(comments).toEqual(["first", "second"]);
    expect(String(callsTo("/repos/andrew/critters/issues/42/comments", "GET")[0][0])).toContain("per_page=100");
  });
});

// ── attachments (unsupported — must be cheap no-ops) ─────────────────────────

describe("attachments", () => {
  it("return null/[]/null with zero HTTP calls", async () => {
    installApi(userRoutes("andrew", "critters"));
    const tracker = new GitHubTracker("tok", ["andrew/critters"]);
    await tracker.init();
    mockFetchFn.mockClear();

    expect(await tracker.uploadAttachment("andrew/critters#42", "f.txt", Buffer.from("x"), "text/plain")).toBeNull();
    expect(await tracker.getAttachments("andrew/critters#42")).toEqual([]);
    expect(await tracker.fetchAttachmentContent("https://example.com/x")).toBeNull();
    expect(mockFetchFn.mock.calls).toHaveLength(0);
  });
});

// ── ensureStatus / ensureLabel / removeLabel / createIssue / listTeams ───────

describe("provisioning", () => {
  it("ensureStatus field mode: existing option is a no-op; missing option PATCHes resend-verbatim + append and updates the cache", async () => {
    installApi({
      ...orgRoutes("myorg", "api"),
      "PATCH /orgs/myorg/issue-fields/123": { body: {} },
    });
    const tracker = await initOrgTracker();

    await tracker.ensureStatus("myorg/api", "Todo"); // exists → no write
    expect(callsTo("/orgs/myorg/issue-fields/123", "PATCH")).toHaveLength(0);

    await tracker.ensureStatus("myorg/api", "Human Review", "started", "#F59E0B");
    const patches = callsTo("/orgs/myorg/issue-fields/123", "PATCH");
    expect(patches).toHaveLength(1);
    const options = (bodyOf(patches[0]).options as Array<Record<string, unknown>>);
    expect(options).toHaveLength(6);
    expect(options[0]).toMatchObject({ id: 1, name: "Todo" }); // existing resent with id
    expect(options[5]).toEqual({ name: "Human Review", color: "yellow" }); // appended

    await tracker.ensureStatus("myorg/api", "Human Review"); // cached now → no second PATCH
    expect(callsTo("/orgs/myorg/issue-fields/123", "PATCH")).toHaveLength(1);
  });

  it("ensureStatus field mode: 403 resolves without caching the option", async () => {
    installApi({
      ...orgRoutes("myorg", "api"),
      "PATCH /orgs/myorg/issue-fields/123": { status: 403, body: { message: "Forbidden" }, headers: { "x-ratelimit-remaining": "100" } },
    });
    const tracker = await initOrgTracker();
    await tracker.ensureStatus("myorg/api", "Human Review"); // must not throw
    await tracker.ensureStatus("myorg/api", "Human Review"); // not cached → retries the PATCH
    expect(callsTo("/orgs/myorg/issue-fields/123", "PATCH")).toHaveLength(2);
  });

  it("ensureStatus label mode: creates the status:* label, already_exists is fine", async () => {
    installApi({
      ...userRoutes("andrew", "critters"),
      "POST /repos/andrew/critters/labels": { status: 422, body: { message: "Validation Failed", errors: [{ code: "already_exists" }] } },
    });
    const tracker = new GitHubTracker("tok", ["andrew/critters"]);
    await tracker.init();
    await tracker.ensureStatus("andrew/critters", "In Progress");
    const creates = callsTo("/repos/andrew/critters/labels", "POST");
    expect(creates).toHaveLength(1);
    expect(bodyOf(creates[0]).name).toBe("status:In Progress");
  });

  it("ensureLabel: attempts every configured repo even when one fails", async () => {
    installApi({
      "GET /user": { body: { login: "octocat" } },
      "GET /repos/andrew/a": { body: { owner: { type: "User" } } },
      "GET /repos/andrew/b": { body: { owner: { type: "User" } } },
      "POST /repos/andrew/a/labels": { status: 500, body: {} },
      "POST /repos/andrew/b/labels": { body: { name: "Critter" } },
    });
    const tracker = new GitHubTracker("tok", ["andrew/a", "andrew/b"]);
    await tracker.init();
    await tracker.ensureLabel("Critter"); // must not throw
    expect(callsTo("/repos/andrew/b/labels", "POST")).toHaveLength(1);
  });

  it("removeLabel: URL-encodes, tolerates 404, throws on 500", async () => {
    installApi({
      ...userRoutes("andrew", "critters"),
      "DELETE /repos/andrew/critters/issues/42/labels/": { status: 404, body: {} },
    });
    const tracker = new GitHubTracker("tok", ["andrew/critters"]);
    await tracker.init();
    await tracker.removeLabel("andrew/critters#42", "Critter Review"); // 404 → ok
    expect(String(callsTo("/repos/andrew/critters/issues/42/labels/", "DELETE")[0][0])).toContain("Critter%20Review");

    installApi({
      "DELETE /repos/andrew/critters/issues/42/labels/": { status: 500, body: {} },
    });
    await expect(tracker.removeLabel("andrew/critters#42", "Critter")).rejects.toThrow("500");
  });

  it("createIssue: ensures labels then creates; rejects unconfigured repos", async () => {
    installApi({
      ...userRoutes("andrew", "critters"),
      "POST /repos/andrew/critters/labels": { status: 422, body: { errors: [{ code: "already_exists" }] } },
      "POST /repos/andrew/critters/issues": { body: { number: 7, html_url: "https://github.com/andrew/critters/issues/7" } },
    });
    const tracker = new GitHubTracker("tok", ["andrew/critters"]);
    await tracker.init();

    const created = await tracker.createIssue({ teamId: "andrew/critters", title: "T", description: "D", labelNames: ["Critter"] });
    expect(created).toEqual({ id: "andrew/critters#7", identifier: "andrew/critters#7", url: "https://github.com/andrew/critters/issues/7" });
    expect(bodyOf(callsTo("/repos/andrew/critters/issues", "POST")[0])).toMatchObject({ title: "T", body: "D", labels: ["Critter"] });

    await expect(tracker.createIssue({ teamId: "other/repo", title: "T", description: "D", labelNames: [] })).rejects.toThrow("unconfigured repo");
  });

  it("listTeams maps configured repos", async () => {
    installApi({
      "GET /user": { body: { login: "octocat" } },
      "GET /repos/andrew/a": { body: { owner: { type: "User" } } },
      "GET /repos/andrew/b": { body: { owner: { type: "User" } } },
    });
    const tracker = new GitHubTracker("tok", ["andrew/a", "andrew/b"]);
    await tracker.init();
    expect(await tracker.listTeams()).toEqual([
      { id: "andrew/a", name: "a", key: "andrew/a" },
      { id: "andrew/b", name: "b", key: "andrew/b" },
    ]);
  });
});

// ── parseGitHubIdentifier ────────────────────────────────────────────────────

describe("parseGitHubIdentifier", () => {
  it("parses owner/repo#N", () => {
    expect(parseGitHubIdentifier("myorg/api#42")).toEqual({ owner: "myorg", repo: "api", number: 42 });
    expect(parseGitHubIdentifier("a.b/c-d_e#7")).toEqual({ owner: "a.b", repo: "c-d_e", number: 7 });
  });

  it("rejects everything else", () => {
    for (const bad of ["PROJ-42", "owner/repo", "owner/repo#x", "", "a/b/c#1", "owner/repo#"]) {
      expect(parseGitHubIdentifier(bad)).toBeNull();
    }
  });
});
