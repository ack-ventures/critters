import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { ClaudeCodeAdapter } from "../cli/claude.js";
import { CodexAdapter } from "../cli/codex.js";
import { GenericPhaseRunner } from "../runner/generic.js";
import { ReviewPhaseRunner } from "../runner/review.js";
import type { PhaseContext } from "../runner/types.js";
import type { TrackerTask } from "../tracker/types.js";
import { createTempDir } from "./helpers.js";

// spawnForPhase actually drives tmux/CLI subprocesses — stub it so the runners
// reach their result-handling logic without spawning anything.
const spawnResult = { exitCode: 0, stdout: "", stderr: "", timedOut: false };
mock.module("../cli/spawn.js", () => ({
  spawnForPhase: () => Promise.resolve(spawnResult),
}));

function makeTask(overrides?: Partial<TrackerTask>): TrackerTask {
  return {
    id: "issue-1",
    identifier: "ACK-1",
    title: "Test task",
    description: "Do the thing",
    repoUrl: "https://github.com/acme/repo",
    group: "Eng",
    groupId: "team-1",
    labels: [],
    ...overrides,
  };
}

function makeReviewCtx(workDir: string, adapter: ClaudeCodeAdapter, task: TrackerTask): PhaseContext {
  return {
    task,
    workDir,
    branch: "feature-branch",
    repoConfig: null,
    phase: { name: "review", prompt: "builtin:review", model: "opus", maxTurns: 10, tools: "review" },
    cliAdapter: adapter,
  } as unknown as PhaseContext;
}

describe("ReviewPhaseRunner merged-confirmation gate", () => {
  let tempDir: string;
  let cleanup: () => void;
  let binDir: string;
  let origPath: string | undefined;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.path;
    cleanup = tmp.cleanup;
    binDir = `${tempDir}/bin`;
    mkdirSync(binDir);
    origPath = process.env.PATH;
  });

  afterEach(() => {
    if (origPath !== undefined) process.env.PATH = origPath;
    cleanup();
  });

  // Writes fake `gh` + `git` onto PATH. `gh pr view ... state` always reports the
  // given PR state; headRefName/feedback queries return stable stub data; git
  // fetch/checkout succeed.
  function shadowGh(prState: string): void {
    writeFileSync(
      `${binDir}/gh`,
      [
        "#!/bin/sh",
        'for a in "$@"; do',
        "  case \"$a\" in",
        `    state) echo "${prState}"; exit 0;;`,
        '    headRefName) echo "feature-branch"; exit 0;;',
        "    comments,reviews) echo '{\"comments\":[],\"reviews\":[]}'; exit 0;;",
        "  esac",
        "done",
        'echo ""; exit 0',
      ].join("\n"),
    );
    writeFileSync(`${binDir}/git`, ["#!/bin/sh", "exit 0"].join("\n"));
    chmodSync(`${binDir}/gh`, 0o755);
    chmodSync(`${binDir}/git`, 0o755);
    process.env.PATH = `${binDir}:${origPath ?? ""}`;
  }

  test("downgrades a claimed MERGED decision to unknown when the PR is not actually merged", async () => {
    shadowGh("OPEN");
    const adapter = new ClaudeCodeAdapter();
    // Simulate the agent emitting a hallucinated REVIEW_RESULT:MERGED sentinel.
    adapter.extractReviewDecision = () => ({ decision: "merged" });

    const task = makeTask({ prNumber: 7, prUrl: "https://github.com/acme/repo/pull/7" });
    const result = await new ReviewPhaseRunner().run(makeReviewCtx(tempDir, adapter, task));

    // The gate must NOT trust the sentinel: PR state is OPEN, so it downgrades.
    expect(result.data.reviewDecision).toBe("unknown");
  });

  test("keeps a MERGED decision when GitHub confirms the PR is merged", async () => {
    // Stateful gh: the first `state` query (the early already-merged check) reports
    // OPEN so the run proceeds; the second `state` query (the confirmation gate)
    // reports MERGED, simulating the agent having merged the PR during review.
    const countFile = `${tempDir}/gh-count`;
    writeFileSync(
      `${binDir}/gh`,
      [
        "#!/bin/sh",
        `COUNT_FILE="${countFile}"`,
        'for a in "$@"; do',
        "  case \"$a\" in",
        "    state)",
        '      n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)',
        "      n=$((n+1))",
        '      echo "$n" > "$COUNT_FILE"',
        '      if [ "$n" -ge 2 ]; then echo "MERGED"; else echo "OPEN"; fi',
        "      exit 0;;",
        '    headRefName) echo "feature-branch"; exit 0;;',
        "    comments,reviews) echo '{\"comments\":[],\"reviews\":[]}'; exit 0;;",
        "  esac",
        "done",
        'echo ""; exit 0',
      ].join("\n"),
    );
    writeFileSync(`${binDir}/git`, ["#!/bin/sh", "exit 0"].join("\n"));
    chmodSync(`${binDir}/gh`, 0o755);
    chmodSync(`${binDir}/git`, 0o755);
    process.env.PATH = `${binDir}:${origPath ?? ""}`;

    const adapter = new ClaudeCodeAdapter();
    adapter.extractReviewDecision = () => ({ decision: "merged" });

    const task = makeTask({ prNumber: 7, prBranch: "feature-branch" });
    const result = await new ReviewPhaseRunner().run(makeReviewCtx(tempDir, adapter, task));

    expect(result.data.reviewDecision).toBe("merged");
  });

  test("throws loudly when the PR branch cannot be resolved", async () => {
    // gh exits non-zero for every call → headRefName resolution fails.
    writeFileSync(`${binDir}/gh`, ["#!/bin/sh", "exit 1"].join("\n"));
    chmodSync(`${binDir}/gh`, 0o755);
    process.env.PATH = `${binDir}:${origPath ?? ""}`;
    const adapter = new ClaudeCodeAdapter();

    // prNumber set but no prBranch → must resolve the branch, which fails.
    const task = makeTask({ prNumber: 9 });
    await expect(new ReviewPhaseRunner().run(makeReviewCtx(tempDir, adapter, task))).rejects.toThrow(
      /Failed to resolve PR branch/,
    );
  });
});

describe("GenericPhaseRunner empty-report fallback", () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.path;
    cleanup = tmp.cleanup;
    writeFileSync(`${tempDir}/prompt.md`, "Do the task");
  });

  afterEach(() => cleanup());

  function makeGenericCtx(adapter: ClaudeCodeAdapter): PhaseContext {
    return {
      task: makeTask(),
      config: {} as unknown,
      workDir: tempDir,
      branch: "feature-branch",
      repoConfig: null,
      phase: { name: "custom", prompt: `${tempDir}/prompt.md`, model: "opus", maxTurns: 10, tools: ["Read"] },
      cliAdapter: adapter,
    } as unknown as PhaseContext;
  }

  test("treats a whitespace-only .critter-report.md as missing and uses the stream-json fallback", async () => {
    writeFileSync(`${tempDir}/.critter-report.md`, "   \n\t\n");
    const adapter = new ClaudeCodeAdapter();
    adapter.extractFinalResponse = () => "FALLBACK TEXT";

    const result = await new GenericPhaseRunner().run(makeGenericCtx(adapter));
    expect(result.data.responseText).toBe("FALLBACK TEXT");
  });

  test("uses the report file when it has real content", async () => {
    // The non-empty path copies the report into the plans dir, which must exist.
    mkdirSync(`${tempDir}/critters/plans`, { recursive: true });
    writeFileSync(`${tempDir}/.critter-report.md`, "Real report body");
    const adapter = new ClaudeCodeAdapter();
    adapter.extractFinalResponse = () => "FALLBACK TEXT";

    const result = await new GenericPhaseRunner().run(makeGenericCtx(adapter));
    expect(result.data.responseText).toBe("Real report body");
  });
});

describe("CodexAdapter.extractFinalResponse IO resilience", () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.path;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  test("does not throw when reading lastMessageFile fails, falls through to log", () => {
    const adapter = new CodexAdapter();
    // A directory at the lastMessageFile path makes readFileSync throw EISDIR.
    const lastMessageFile = `${tempDir}/last.txt`;
    mkdirSync(lastMessageFile);
    const logFile = `${tempDir}/output.json`;
    writeFileSync(
      logFile,
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Final answer from log" } }),
    );

    expect(() => adapter.extractFinalResponse(logFile, lastMessageFile)).not.toThrow();
    expect(adapter.extractFinalResponse(logFile, lastMessageFile)).toBe("Final answer from log");
  });

  test("falls through to log when lastMessageFile is empty", () => {
    const adapter = new CodexAdapter();
    const lastMessageFile = `${tempDir}/last.txt`;
    writeFileSync(lastMessageFile, "   \n");
    const logFile = `${tempDir}/output.json`;
    writeFileSync(
      logFile,
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Log text" } }),
    );

    expect(adapter.extractFinalResponse(logFile, lastMessageFile)).toBe("Log text");
  });
});
