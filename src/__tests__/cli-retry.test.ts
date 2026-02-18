import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

// Track calls to Linear SDK methods
const mockUpdateIssue = mock(() => Promise.resolve({}));
const mockCreateComment = mock(() => Promise.resolve({}));
const mockIssues = mock(() => Promise.resolve({ nodes: [] as any[] }));

mock.module("@linear/sdk", () => ({
  LinearClient: function () {
    return {
      issues: mockIssues,
      updateIssue: mockUpdateIssue,
      createComment: mockCreateComment,
    };
  },
}));

// Ensure LINEAR_API_KEY is set so loadConfig() works (actual SDK is mocked above)
process.env.LINEAR_API_KEY = process.env.LINEAR_API_KEY || "test-key";

const { runRetry } = await import("../cli-retry.js");
const linear = await import("../linear.js");

// Helper to create a mock issue with configurable state and labels
function makeMockIssue(opts: {
  id?: string;
  identifier?: string;
  statusName: string;
  hasLabel?: boolean;
  teamName?: string;
  teamStates?: { name: string; id: string }[];
}) {
  const {
    id = "issue-1",
    identifier = "ACK-101",
    statusName,
    hasLabel = true,
    teamName = "Engineering",
    teamStates = [
      { name: "Todo", id: "todo-id" },
      { name: "In Progress", id: "ip-id" },
      { name: "Done", id: "done-id" },
      { name: "Critter Failed", id: "cf-id" },
      { name: "Human Review", id: "hr-id" },
      { name: "In Review", id: "ir-id" },
    ],
  } = opts;

  return {
    id,
    identifier,
    state: Promise.resolve({ name: statusName }),
    labels: () =>
      Promise.resolve({
        nodes: hasLabel ? [{ name: "Critter" }] : [],
      }),
    team: Promise.resolve({
      id: "team-1",
      name: teamName,
      states: () => Promise.resolve({ nodes: teamStates }),
    }),
  };
}

// Spy on process.exit to capture exit codes without actually exiting
let exitSpy: ReturnType<typeof spyOn>;
let consoleErrorSpy: ReturnType<typeof spyOn>;
let consoleLogSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  mockIssues.mockReset();
  mockUpdateIssue.mockReset();
  mockCreateComment.mockReset();

  exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });
  consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
  consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});

  // Re-init linear client for each test
  linear.initLinear({ linearApiKey: "test-key" } as any);
});

describe("runRetry", () => {
  test("retries from Critter Failed", async () => {
    const issue = makeMockIssue({ statusName: "Critter Failed" });
    mockIssues.mockResolvedValueOnce({ nodes: [issue] });

    await runRetry("ACK-101", false);

    expect(mockUpdateIssue).toHaveBeenCalledWith("issue-1", {
      stateId: "todo-id",
    });
    expect(mockCreateComment).toHaveBeenCalledWith({
      issueId: "issue-1",
      body: "Retry triggered via CLI",
    });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Retried ACK-101"),
    );
  });

  test("refuses issue without Critter label", async () => {
    const issue = makeMockIssue({
      statusName: "Critter Failed",
      hasLabel: false,
    });
    mockIssues.mockResolvedValueOnce({ nodes: [issue] });

    await expect(runRetry("ACK-101", false)).rejects.toThrow(
      "process.exit called",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing "Critter" label'),
    );
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  test("refuses In Progress issue", async () => {
    const issue = makeMockIssue({ statusName: "In Progress" });
    mockIssues.mockResolvedValueOnce({ nodes: [issue] });

    await expect(runRetry("ACK-101", false)).rejects.toThrow(
      "process.exit called",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("currently being worked on"),
    );
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  test("refuses In Review issue", async () => {
    const issue = makeMockIssue({ statusName: "In Review" });
    mockIssues.mockResolvedValueOnce({ nodes: [issue] });

    await expect(runRetry("ACK-101", false)).rejects.toThrow(
      "process.exit called",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("currently being worked on"),
    );
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  test("refuses Done issue without force", async () => {
    const issue = makeMockIssue({ statusName: "Done" });
    mockIssues.mockResolvedValueOnce({ nodes: [issue] });

    await expect(runRetry("ACK-101", false)).rejects.toThrow(
      "process.exit called",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("already completed"),
    );
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  test("refuses Human Review without force", async () => {
    const issue = makeMockIssue({ statusName: "Human Review" });
    mockIssues.mockResolvedValueOnce({ nodes: [issue] });

    await expect(runRetry("ACK-101", false)).rejects.toThrow(
      "process.exit called",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("flagged for human review"),
    );
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  test("force overrides Human Review", async () => {
    const issue = makeMockIssue({ statusName: "Human Review" });
    mockIssues.mockResolvedValueOnce({ nodes: [issue] });

    await runRetry("ACK-101", true);

    expect(mockUpdateIssue).toHaveBeenCalledWith("issue-1", {
      stateId: "todo-id",
    });
    expect(mockCreateComment).toHaveBeenCalled();
  });

  test("force overrides Done", async () => {
    const issue = makeMockIssue({ statusName: "Done" });
    mockIssues.mockResolvedValueOnce({ nodes: [issue] });

    await runRetry("ACK-101", true);

    expect(mockUpdateIssue).toHaveBeenCalledWith("issue-1", {
      stateId: "todo-id",
    });
    expect(mockCreateComment).toHaveBeenCalled();
  });

  test("force does NOT override In Progress", async () => {
    const issue = makeMockIssue({ statusName: "In Progress" });
    mockIssues.mockResolvedValueOnce({ nodes: [issue] });

    await expect(runRetry("ACK-101", true)).rejects.toThrow(
      "process.exit called",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("currently being worked on"),
    );
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  test("issue not found", async () => {
    mockIssues.mockResolvedValueOnce({ nodes: [] });

    await expect(runRetry("ACK-999", false)).rejects.toThrow(
      "process.exit called",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Issue ACK-999 not found"),
    );
  });

  test("Todo is a no-op", async () => {
    const issue = makeMockIssue({ statusName: "Todo" });
    mockIssues.mockResolvedValueOnce({ nodes: [issue] });

    await runRetry("ACK-101", false);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("already in Todo"),
    );
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  test("throws error when Todo status not found in team", async () => {
    const issue = makeMockIssue({
      statusName: "Critter Failed",
      teamStates: [
        { name: "In Progress", id: "ip-id" },
        { name: "Done", id: "done-id" },
      ],
    });
    mockIssues.mockResolvedValueOnce({ nodes: [issue] });

    await expect(runRetry("ACK-101", false)).rejects.toThrow(
      'No "Todo" status found for team Engineering',
    );
  });
});
