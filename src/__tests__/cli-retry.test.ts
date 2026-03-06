import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { IssueTracker, IssueTrackerIssue } from "../tracker/types.js";

// Mock tracker
const mockFindIssueByIdentifier = mock<() => Promise<IssueTrackerIssue | null>>(() => Promise.resolve(null));
const mockUpdateStatus = mock(() => Promise.resolve());
const mockComment = mock(() => Promise.resolve());

const mockTracker: IssueTracker = {
  provider: "linear",
  init: mock(() => Promise.resolve()),
  findIssues: mock(() => Promise.resolve([])),
  findIssueByIdentifier: mockFindIssueByIdentifier,
  updateStatus: mockUpdateStatus,
  comment: mockComment,
  getComments: mock(() => Promise.resolve([])),
  uploadAttachment: mock(() => Promise.resolve(null)),
  ensureStatus: mock(() => Promise.resolve()),
  ensureLabel: mock(() => Promise.resolve()),
};

// Mock createTracker to return our mock
mock.module("../tracker/index.js", () => ({
  createTracker: () => mockTracker,
}));

// Ensure LINEAR_API_KEY is set so loadConfig() works
process.env.LINEAR_API_KEY = process.env.LINEAR_API_KEY || "test-key";

const { runRetry } = await import("../cli-retry.js");

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
