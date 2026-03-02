import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Config } from "../types.js";

// Mock the @linear/sdk module before importing linear.ts
const mockClient = {
  issues: mock(() => Promise.resolve(createMockConnection([[]])))
};

mock.module("@linear/sdk", () => ({
  // biome-ignore lint/complexity/useArrowFunction: must be a regular function for `new` to work
  LinearClient: function () {
    return mockClient;
  },
}));

// Must import after mock.module
const { initLinear, findCritterIssues, findReviewIssues } = await import("../linear.js");
const logger = await import("../logger.js");

interface MockIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  team: Promise<{ id: string }>;
  project: Promise<{ id: string } | null>;
  inverseRelations: () => Promise<{ nodes: never[] }>;
}

function makeMockIssue(index: number): MockIssue {
  return {
    id: `issue-${index}`,
    identifier: `TEST-${index}`,
    title: `Issue ${index}`,
    description: `Description ${index}`,
    team: Promise.resolve({ id: "team-1" }),
    project: Promise.resolve(null),
    inverseRelations: () => Promise.resolve({ nodes: [] }),
  };
}

function createMockConnection(pages: MockIssue[][]) {
  let pageIndex = 0;
  const allNodes: MockIssue[] = [...pages[0]];

  const connection = {
    nodes: allNodes,
    pageInfo: {
      hasNextPage: pages.length > 1,
    },
    fetchNext: async () => {
      pageIndex++;
      if (pageIndex < pages.length) {
        allNodes.push(...pages[pageIndex]);
        connection.pageInfo.hasNextPage = pageIndex < pages.length - 1;
      }
      return connection;
    },
  };

  return connection;
}

beforeEach(() => {
  mockClient.issues.mockReset();
  initLinear({ linearApiKey: "test-key" } as Config);
});

describe("findCritterIssues pagination", () => {
  test("returns all issues from a single page", async () => {
    const page1 = [makeMockIssue(1), makeMockIssue(2)];
    mockClient.issues.mockResolvedValueOnce(createMockConnection([page1]));

    const tasks = await findCritterIssues("Critter");
    expect(tasks).toHaveLength(2);
    expect(tasks[0].identifier).toBe("TEST-1");
    expect(tasks[1].identifier).toBe("TEST-2");
  });

  test("paginates across multiple pages", async () => {
    const page1 = [makeMockIssue(1), makeMockIssue(2)];
    const page2 = [makeMockIssue(3)];
    mockClient.issues.mockResolvedValueOnce(createMockConnection([page1, page2]));

    const tasks = await findCritterIssues("Critter");
    expect(tasks).toHaveLength(3);
    expect(tasks[0].identifier).toBe("TEST-1");
    expect(tasks[1].identifier).toBe("TEST-2");
    expect(tasks[2].identifier).toBe("TEST-3");
  });

  test("returns empty array for no results", async () => {
    mockClient.issues.mockResolvedValueOnce(createMockConnection([[]]));

    const tasks = await findCritterIssues("Critter");
    expect(tasks).toHaveLength(0);
  });

  test("stops at safety cap and logs warning", async () => {
    const logSpy = spyOn(logger, "log");

    // Create pages that would exceed the 200-issue cap
    const pages: MockIssue[][] = [];
    for (let p = 0; p < 5; p++) {
      const page: MockIssue[] = [];
      for (let i = 0; i < 50; i++) {
        page.push(makeMockIssue(p * 50 + i));
      }
      pages.push(page);
    }
    // 5 pages of 50 = 250 total, but cap should stop at 200 (after 4 pages)
    mockClient.issues.mockResolvedValueOnce(createMockConnection(pages));

    const tasks = await findCritterIssues("Critter");
    expect(tasks.length).toBeLessThanOrEqual(200);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("hit pagination cap of 200")
    );
    logSpy.mockRestore();
  });
});

describe("findReviewIssues pagination", () => {
  test("returns all issues from a single page", async () => {
    const page1 = [makeMockIssue(1), makeMockIssue(2)];
    mockClient.issues.mockResolvedValueOnce(createMockConnection([page1]));

    const tasks = await findReviewIssues("Critter Review");
    expect(tasks).toHaveLength(2);
    expect(tasks[0].identifier).toBe("TEST-1");
    expect(tasks[1].identifier).toBe("TEST-2");
  });

  test("paginates across multiple pages", async () => {
    const page1 = [makeMockIssue(1)];
    const page2 = [makeMockIssue(2), makeMockIssue(3)];
    const page3 = [makeMockIssue(4)];
    mockClient.issues.mockResolvedValueOnce(createMockConnection([page1, page2, page3]));

    const tasks = await findReviewIssues("Critter Review");
    expect(tasks).toHaveLength(4);
    expect(tasks[3].identifier).toBe("TEST-4");
  });

  test("returns empty array for no results", async () => {
    mockClient.issues.mockResolvedValueOnce(createMockConnection([[]]));

    const tasks = await findReviewIssues("Critter Review");
    expect(tasks).toHaveLength(0);
  });
});
