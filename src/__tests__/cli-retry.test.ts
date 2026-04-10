import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { IssueTracker, IssueTrackerIssue, TrackerTask } from "../tracker/types.js";

// Mock tracker
const mockFindIssueByIdentifier = mock<() => Promise<IssueTrackerIssue | null>>(() => Promise.resolve(null));
const mockFindIssues = mock<() => Promise<TrackerTask[]>>(() => Promise.resolve([]));
const mockUpdateStatus = mock(() => Promise.resolve());
const mockComment = mock(() => Promise.resolve());

const mockTracker: IssueTracker = {
  provider: "linear",
  init: mock(() => Promise.resolve()),
  findIssues: mockFindIssues,
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

// Mock createTracker to return our mock
mock.module("../tracker/index.js", () => ({
  createTracker: () => mockTracker,
}));

// Ensure LINEAR_API_KEY is set so loadConfig() works
process.env.LINEAR_API_KEY = process.env.LINEAR_API_KEY || "test-key";

const { runRetry, runRetryAllFailed, parseDuration } = await import("../cli-retry.js");

function makeIssue(opts: {
  id?: string;
  identifier?: string;
  statusName: string;
  hasLabel?: boolean;
  groupId?: string;
}): IssueTrackerIssue {
  return {
    id: opts.id ?? "issue-1",
    identifier: opts.identifier ?? "ACK-101",
    statusName: opts.statusName,
    labels: opts.hasLabel === false ? [] : ["Critter"],
    groupId: opts.groupId ?? "team-1",
  };
}

let consoleErrorSpy: ReturnType<typeof spyOn>;
let consoleLogSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  mockFindIssueByIdentifier.mockReset();
  mockFindIssues.mockReset();
  mockFindIssues.mockResolvedValue([]);
  mockUpdateStatus.mockReset();
  mockComment.mockReset();

  spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });
  consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
  consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
});

describe("runRetry", () => {
  test("retries from Critter Failed", async () => {
    mockFindIssueByIdentifier.mockResolvedValueOnce(makeIssue({ statusName: "Critter Failed" }));

    await runRetry("ACK-101", false);

    expect(mockUpdateStatus).toHaveBeenCalledWith("issue-1", "Todo", "team-1");
    expect(mockComment).toHaveBeenCalledWith("issue-1", "Retry triggered via CLI");
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Retried ACK-101"),
    );
  });

  test("refuses issue without Critter label", async () => {
    mockFindIssueByIdentifier.mockResolvedValueOnce(
      makeIssue({ statusName: "Critter Failed", hasLabel: false }),
    );

    await expect(runRetry("ACK-101", false)).rejects.toThrow("process.exit called");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("isn't a critter task"),
    );
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  test("refuses In Progress issue", async () => {
    mockFindIssueByIdentifier.mockResolvedValueOnce(makeIssue({ statusName: "In Progress" }));

    await expect(runRetry("ACK-101", false)).rejects.toThrow("process.exit called");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("currently being worked on"),
    );
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  test("refuses In Review issue", async () => {
    mockFindIssueByIdentifier.mockResolvedValueOnce(makeIssue({ statusName: "In Review" }));

    await expect(runRetry("ACK-101", false)).rejects.toThrow("process.exit called");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("currently being worked on"),
    );
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  test("refuses Done issue without force", async () => {
    mockFindIssueByIdentifier.mockResolvedValueOnce(makeIssue({ statusName: "Done" }));

    await expect(runRetry("ACK-101", false)).rejects.toThrow("process.exit called");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("already completed"),
    );
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  test("refuses Human Review without force", async () => {
    mockFindIssueByIdentifier.mockResolvedValueOnce(makeIssue({ statusName: "Human Review" }));

    await expect(runRetry("ACK-101", false)).rejects.toThrow("process.exit called");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("flagged for human review"),
    );
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  test("force overrides Human Review", async () => {
    mockFindIssueByIdentifier.mockResolvedValueOnce(makeIssue({ statusName: "Human Review" }));

    await runRetry("ACK-101", true);

    expect(mockUpdateStatus).toHaveBeenCalledWith("issue-1", "Todo", "team-1");
    expect(mockComment).toHaveBeenCalled();
  });

  test("force overrides Done", async () => {
    mockFindIssueByIdentifier.mockResolvedValueOnce(makeIssue({ statusName: "Done" }));

    await runRetry("ACK-101", true);

    expect(mockUpdateStatus).toHaveBeenCalledWith("issue-1", "Todo", "team-1");
    expect(mockComment).toHaveBeenCalled();
  });

  test("force does NOT override In Progress", async () => {
    mockFindIssueByIdentifier.mockResolvedValueOnce(makeIssue({ statusName: "In Progress" }));

    await expect(runRetry("ACK-101", true)).rejects.toThrow("process.exit called");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("currently being worked on"),
    );
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  test("issue not found", async () => {
    mockFindIssueByIdentifier.mockResolvedValueOnce(null);

    await expect(runRetry("ACK-999", false)).rejects.toThrow("process.exit called");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Issue ACK-999 not found"),
    );
  });

  test("Todo is a no-op", async () => {
    mockFindIssueByIdentifier.mockResolvedValueOnce(makeIssue({ statusName: "Todo" }));

    await runRetry("ACK-101", false);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("already in Todo"),
    );
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });
});

function makeTrackerTask(opts?: {
  id?: string;
  identifier?: string;
  title?: string;
  updatedAt?: Date;
}): TrackerTask {
  return {
    id: opts?.id ?? "task-1",
    identifier: opts?.identifier ?? "ACK-101",
    title: opts?.title ?? "Test task",
    description: "",
    repoUrl: "",
    group: "Team",
    groupId: "team-1",
    labels: ["Critter"],
    updatedAt: opts?.updatedAt ?? new Date(),
  };
}

describe("parseDuration", () => {
  test("parses hours", () => {
    expect(parseDuration("24h")).toBe(24 * 3600000);
  });

  test("parses days", () => {
    expect(parseDuration("3d")).toBe(3 * 86400000);
  });

  test("parses weeks", () => {
    expect(parseDuration("1w")).toBe(604800000);
  });

  test("returns null for invalid format", () => {
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("24m")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });
});

describe("runRetryAllFailed", () => {
  test("finds and retries all failed issues", async () => {
    const task1 = makeTrackerTask({ id: "t1", identifier: "ACK-101", title: "Task one" });
    const task2 = makeTrackerTask({ id: "t2", identifier: "ACK-102", title: "Task two" });
    mockFindIssues.mockResolvedValueOnce([task1, task2]);

    await runRetryAllFailed({ dryRun: false });

    expect(mockUpdateStatus).toHaveBeenCalledTimes(2);
    expect(mockUpdateStatus).toHaveBeenCalledWith("t1", "Todo", "team-1");
    expect(mockUpdateStatus).toHaveBeenCalledWith("t2", "Todo", "team-1");
    expect(mockComment).toHaveBeenCalledTimes(2);
    expect(mockComment).toHaveBeenCalledWith("t1", "Bulk retry triggered via CLI");
    expect(mockComment).toHaveBeenCalledWith("t2", "Bulk retry triggered via CLI");
  });

  test("dry run doesn't mutate", async () => {
    const task1 = makeTrackerTask({ id: "t1", identifier: "ACK-101" });
    mockFindIssues.mockResolvedValueOnce([task1]);

    await runRetryAllFailed({ dryRun: true });

    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockComment).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith("Dry run — no changes made.");
  });

  test("--since filters by updatedAt", async () => {
    const recent = makeTrackerTask({
      id: "t1",
      identifier: "ACK-101",
      updatedAt: new Date(Date.now() - 3600000), // 1 hour ago
    });
    const old = makeTrackerTask({
      id: "t2",
      identifier: "ACK-102",
      updatedAt: new Date(Date.now() - 86400000 * 5), // 5 days ago
    });
    mockFindIssues.mockResolvedValueOnce([recent, old]);

    await runRetryAllFailed({ dryRun: false, since: "24h" });

    expect(mockUpdateStatus).toHaveBeenCalledTimes(1);
    expect(mockUpdateStatus).toHaveBeenCalledWith("t1", "Todo", "team-1");
  });

  test("no failed issues found", async () => {
    mockFindIssues.mockResolvedValueOnce([]);

    await runRetryAllFailed({ dryRun: false });

    expect(consoleLogSpy).toHaveBeenCalledWith("No failed critters found.");
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  test("individual failure doesn't stop batch", async () => {
    const task1 = makeTrackerTask({ id: "t1", identifier: "ACK-101" });
    const task2 = makeTrackerTask({ id: "t2", identifier: "ACK-102" });
    mockFindIssues.mockResolvedValueOnce([task1, task2]);
    mockUpdateStatus.mockRejectedValueOnce(new Error("API error"));
    mockUpdateStatus.mockResolvedValueOnce(undefined);

    await runRetryAllFailed({ dryRun: false });

    expect(mockUpdateStatus).toHaveBeenCalledTimes(2);
    expect(consoleLogSpy).toHaveBeenCalledWith("Retried 1/2 critters.");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to retry ACK-101"),
    );
  });

  test("invalid --since format", async () => {
    await expect(runRetryAllFailed({ dryRun: false, since: "bad" })).rejects.toThrow("process.exit called");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid --since format'),
    );
  });

  test("includes issues without updatedAt when --since is set", async () => {
    const noDate = makeTrackerTask({ id: "t1", identifier: "ACK-101" });
    delete (noDate as unknown as Record<string, unknown>).updatedAt;
    mockFindIssues.mockResolvedValueOnce([noDate]);

    await runRetryAllFailed({ dryRun: false, since: "24h" });

    expect(mockUpdateStatus).toHaveBeenCalledTimes(1);
    expect(mockUpdateStatus).toHaveBeenCalledWith("t1", "Todo", "team-1");
  });

  test("deduplicates across types by provider+identifier", async () => {
    // findIssues will be called once per critter type — default config has create + review
    // Both might return the same issue. Ensure it's only retried once.
    const task = makeTrackerTask({ id: "t1", identifier: "ACK-101" });
    mockFindIssues.mockResolvedValue([task]);

    await runRetryAllFailed({ dryRun: false });

    // Should be deduped to 1 regardless of how many types matched
    expect(mockUpdateStatus).toHaveBeenCalledTimes(1);
  });
});
