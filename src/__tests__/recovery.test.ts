import { describe, expect, mock, test } from "bun:test";
import type { CritterTypeConfig, TriggerConfig } from "../critter-type.js";
import { recoverOrphanedIssues } from "../recovery.js";
import type { IssueTracker, TrackerTask } from "../tracker/types.js";
import type { ActiveCritterDetail, Config, QueuedCritterDetail } from "../types.js";
import type { UnifiedSpawner } from "../unified-spawner.js";

function createMockTracker(overrides?: Partial<IssueTracker>): IssueTracker {
  return {
    provider: "linear",
    init: async () => {},
    findIssues: async () => [],
    findIssueByIdentifier: async () => null,
    updateStatus: async () => {},
    comment: async () => {},
    getComments: async () => [],
    uploadAttachment: async () => null,
    getAttachments: async () => [],
    fetchAttachmentContent: async () => null,
    ensureStatus: async () => {},
    ensureLabel: async () => {},
    removeLabel: async () => {},
    createIssue: async () => ({ id: "new-id", identifier: "ACK-999", url: "https://linear.app/test/ACK-999" }),
    listTeams: async () => [{ id: "team1", name: "Team Alpha", key: "TA" }],
    ...overrides,
  };
}

function createMockSpawner(
  active: ActiveCritterDetail[] = [],
  queued: QueuedCritterDetail[] = [],
): UnifiedSpawner {
  return {
    getActiveDetails: () => active,
    getQueuedDetails: () => queued,
  } as unknown as UnifiedSpawner;
}

function createMockConfig(critterTypes: CritterTypeConfig[]): Config {
  return {
    provider: "linear",
    critterTypes,
  } as unknown as Config;
}

function createCritterType(overrides?: Partial<CritterTypeConfig>): CritterTypeConfig {
  return {
    name: "create",
    trigger: { label: "Critter", status: "Todo", statusType: "unstarted" },
    repo: { clone: true, branch: true },
    phases: [{ name: "execution", prompt: "builtin:execution", model: "opus", maxTurns: 75, tools: "default" }],
    outcomes: { success: { status: "In Review" }, failure: { status: "Critter Failed" } },
    concurrency: 2,
    timeoutMinutes: 30,
    claimStatus: "In Progress",
    ...overrides,
  };
}

function createTrackerTask(overrides?: Partial<TrackerTask>): TrackerTask {
  return {
    id: "issue-1",
    identifier: "ACK-100",
    title: "Test issue",
    description: "A test issue",
    repoUrl: "git@github.com:org/repo.git",
    group: "Team Alpha",
    groupId: "team1",
    labels: ["Critter"],
    ...overrides,
  };
}

describe("recoverOrphanedIssues", () => {
  test("recovers orphaned issue by reverting status to trigger.status", async () => {
    const updateStatus = mock(async () => {});
    const orphanedIssue = createTrackerTask();
    const tracker = createMockTracker({
      findIssues: async () => [orphanedIssue],
      updateStatus,
    });
    const trackers = new Map([["linear", tracker]]);
    const config = createMockConfig([createCritterType()]);
    const spawner = createMockSpawner();

    await recoverOrphanedIssues(config, trackers, spawner);

    expect(updateStatus).toHaveBeenCalledTimes(1);
    expect(updateStatus).toHaveBeenCalledWith("issue-1", "Todo", "team1", "ACK-100");
  });

  test("skips active critter", async () => {
    const updateStatus = mock(async () => {});
    const orphanedIssue = createTrackerTask();
    const tracker = createMockTracker({
      findIssues: async () => [orphanedIssue],
      updateStatus,
    });
    const trackers = new Map([["linear", tracker]]);
    const config = createMockConfig([createCritterType()]);
    const spawner = createMockSpawner([
      {
        identifier: "ACK-100",
        title: "Test issue",
        phase: "exec",
        repo: "org/repo",
        branch: "critter/ACK-100-test",
        startedAt: Date.now(),
      },
    ]);

    await recoverOrphanedIssues(config, trackers, spawner);

    expect(updateStatus).not.toHaveBeenCalled();
  });

  test("skips queued critter", async () => {
    const updateStatus = mock(async () => {});
    const orphanedIssue = createTrackerTask();
    const tracker = createMockTracker({
      findIssues: async () => [orphanedIssue],
      updateStatus,
    });
    const trackers = new Map([["linear", tracker]]);
    const config = createMockConfig([createCritterType()]);
    const spawner = createMockSpawner([], [
      {
        identifier: "ACK-100",
        title: "Test issue",
        critterType: "create",
        repo: "org/repo",
        enqueuedAt: Date.now(),
      },
    ]);

    await recoverOrphanedIssues(config, trackers, spawner);

    expect(updateStatus).not.toHaveBeenCalled();
  });

  test("skips critter with live startup pane", async () => {
    const updateStatus = mock(async () => {});
    const orphanedIssue = createTrackerTask();
    const tracker = createMockTracker({
      findIssues: async () => [orphanedIssue],
      updateStatus,
    });
    const trackers = new Map([["linear", tracker]]);
    const config = createMockConfig([createCritterType()]);
    const spawner = createMockSpawner();

    await recoverOrphanedIssues(config, trackers, spawner, new Set(["ACK-100"]));

    expect(updateStatus).not.toHaveBeenCalled();
  });

  test("skips types without claimStatus", async () => {
    const findIssues = mock(async () => []);
    const tracker = createMockTracker({ findIssues });
    const trackers = new Map([["linear", tracker]]);
    const config = createMockConfig([
      createCritterType({ name: "review", claimStatus: undefined }),
    ]);
    const spawner = createMockSpawner();

    await recoverOrphanedIssues(config, trackers, spawner);

    expect(findIssues).not.toHaveBeenCalled();
  });

  test("skips when claimStatus equals trigger.status", async () => {
    const findIssues = mock(async () => []);
    const tracker = createMockTracker({ findIssues });
    const trackers = new Map([["linear", tracker]]);
    const config = createMockConfig([
      createCritterType({
        trigger: { label: "Critter", status: "In Progress" },
        claimStatus: "In Progress",
      }),
    ]);
    const spawner = createMockSpawner();

    await recoverOrphanedIssues(config, trackers, spawner);

    expect(findIssues).not.toHaveBeenCalled();
  });

  test("handles tracker API failure gracefully", async () => {
    const tracker = createMockTracker({
      findIssues: async () => { throw new Error("API timeout"); },
    });
    const trackers = new Map([["linear", tracker]]);
    const config = createMockConfig([createCritterType()]);
    const spawner = createMockSpawner();

    // Should not throw
    await recoverOrphanedIssues(config, trackers, spawner);
  });

  test("recovers across multiple types in parallel", async () => {
    const updateStatus = mock(async () => {});
    const issue1 = createTrackerTask({ id: "issue-1", identifier: "ACK-100" });
    const issue2 = createTrackerTask({ id: "issue-2", identifier: "ACK-200" });

    const tracker = createMockTracker({
      findIssues: mock(async (trigger) => {
        if (trigger.label === "Critter") return [issue1];
        if (trigger.label === "Audit") return [issue2];
        return [];
      }),
      updateStatus,
    });
    const trackers = new Map([["linear", tracker]]);

    const type1 = createCritterType({ name: "create", trigger: { label: "Critter", status: "Todo" }, claimStatus: "In Progress" });
    const type2 = createCritterType({ name: "audit", trigger: { label: "Audit", status: "Backlog" }, claimStatus: "Auditing" });
    const config = createMockConfig([type1, type2]);
    const spawner = createMockSpawner();

    await recoverOrphanedIssues(config, trackers, spawner);

    expect(updateStatus).toHaveBeenCalledTimes(2);
  });

  test("deduplicates across types sharing claimStatus", async () => {
    const updateStatus = mock(async () => {});
    const sharedIssue = createTrackerTask({ id: "issue-1", identifier: "ACK-100" });

    const tracker = createMockTracker({
      findIssues: async () => [sharedIssue],
      updateStatus,
    });
    const trackers = new Map([["linear", tracker]]);

    const type1 = createCritterType({ name: "create", trigger: { label: "Critter", status: "Todo" }, claimStatus: "In Progress" });
    const type2 = createCritterType({ name: "create2", trigger: { label: "Critter2", status: "Todo" }, claimStatus: "In Progress" });
    const config = createMockConfig([type1, type2]);
    const spawner = createMockSpawner();

    await recoverOrphanedIssues(config, trackers, spawner);

    // Same issue ID returned by both types — updateStatus should only be called once
    expect(updateStatus).toHaveBeenCalledTimes(1);
  });

  test("uses correct trigger fields: claimStatus as status, same label, same assignee, no statusType", async () => {
    const findIssues = mock<(trigger: TriggerConfig) => Promise<TrackerTask[]>>(
      async () => [],
    );
    const tracker = createMockTracker({ findIssues });
    const trackers = new Map([["linear", tracker]]);
    const config = createMockConfig([
      createCritterType({
        trigger: { label: "MyLabel", status: "Todo", statusType: "unstarted", assignee: "me@example.com" },
        claimStatus: "In Progress",
      }),
    ]);
    const spawner = createMockSpawner();

    await recoverOrphanedIssues(config, trackers, spawner);

    expect(findIssues).toHaveBeenCalledTimes(1);
    const triggerArg = findIssues.mock.calls[0]?.[0];
    expect(triggerArg).toEqual({
      label: "MyLabel",
      status: "In Progress",
      assignee: "me@example.com",
    });
    // Ensure statusType is NOT present
    expect(triggerArg).not.toHaveProperty("statusType");
  });
});
