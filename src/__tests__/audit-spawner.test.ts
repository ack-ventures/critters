import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeCritterIdentifiersFromPanes, parsePaneList } from "../cli/spawn.js";
import { createConfigReloadHandler, type DaemonContext } from "../config-reload.js";
import { ConfigWatcher } from "../config-watcher.js";
import { createBranch, shallowClone } from "../git.js";
import { salvagePartialProgress } from "../task-salvage.js";
import type { IssueTracker, TrackerTask } from "../tracker/types.js";
import type { Config } from "../types.js";
import { UnifiedSpawner } from "../unified-spawner.js";
import { makeTestConfig, makeTestCritterType } from "./helpers.js";

// ───────────────────────────── B6 ─────────────────────────────
// salvagePartialProgress must push commits even when a PR already exists.

describe("B6 — salvage pushes commits when a PR already exists", () => {
  let bareRepo: string;
  let tempDirs: string[];
  let binDir: string;
  let savedPath: string | undefined;

  beforeEach(() => {
    tempDirs = [];
    bareRepo = mkdtempSync(join(tmpdir(), "critters-audit-bare-"));
    tempDirs.push(bareRepo);
    execSync("git init --bare -b main", { cwd: bareRepo, stdio: "ignore" });

    const seedDir = mkdtempSync(join(tmpdir(), "critters-audit-seed-"));
    tempDirs.push(seedDir);
    execSync(`git clone ${bareRepo} ${seedDir}/work`, { stdio: "ignore" });
    execSync("git checkout -b main", { cwd: `${seedDir}/work`, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: `${seedDir}/work`, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: `${seedDir}/work`, stdio: "ignore" });
    writeFileSync(`${seedDir}/work/README.md`, "init");
    execSync("git add -A && git commit -m 'init'", { cwd: `${seedDir}/work`, stdio: "ignore" });
    execSync("git push -u origin main", { cwd: `${seedDir}/work`, stdio: "ignore" });
    execSync("git symbolic-ref HEAD refs/heads/main", { cwd: bareRepo, stdio: "ignore" });

    // Fake `gh` on PATH so `gh pr list` reports an existing PR.
    binDir = mkdtempSync(join(tmpdir(), "critters-audit-bin-"));
    tempDirs.push(binDir);
    const ghPath = join(binDir, "gh");
    writeFileSync(
      ghPath,
      `#!/bin/bash
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  echo '[{"url":"https://github.com/org/repo/pull/1"}]'
  exit 0
fi
exit 0
`,
    );
    chmodSync(ghPath, 0o755);
    savedPath = process.env.PATH;
    process.env.PATH = `${binDir}:${savedPath ?? ""}`;
  });

  afterEach(() => {
    process.env.PATH = savedPath;
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  test("pushes unpushed commits to the existing PR branch before returning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "critters-audit-clone-"));
    tempDirs.push(dir);
    const workDir = join(dir, "repo");
    await shallowClone(bareRepo, workDir, "TEST-1");
    execSync("git config user.email test@test.com", { cwd: workDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: workDir, stdio: "ignore" });

    const branch = "critter/TEST-1-pr-exists";
    await createBranch(workDir, branch, "TEST-1");
    // Commit locally but DO NOT push — simulates a resumed attempt that
    // committed new work after the PR already existed.
    writeFileSync(join(workDir, "resumed.txt"), "resumed work");
    execSync("git add -A && git commit -m 'resumed work'", { cwd: workDir, stdio: "ignore" });

    const result = await salvagePartialProgress(workDir, branch, "TEST-1", "PR exists");

    // Reports the existing PR url and that the branch was pushed.
    expect(result.prUrl).toBe("https://github.com/org/repo/pull/1");
    expect(result.branchPushed).toBe(true);

    // The unpushed commit must now be on the remote (old code skipped the push).
    const remoteBranches = execSync("git branch", { cwd: bareRepo, encoding: "utf-8" });
    expect(remoteBranches).toContain(branch);
    const remoteLog = execSync(`git log ${branch} --oneline`, { cwd: bareRepo, encoding: "utf-8" });
    expect(remoteLog).toContain("resumed work");
  });
});

// ───────────────────────────── B8 ─────────────────────────────
// Config reload must revert the grouped immutable-field copies the runtime reads.

describe("B8 — config reload reverts grouped immutable fields", () => {
  function makeCtx(oldConfig: Config): DaemonContext {
    const tracker = { init: async () => {} } as unknown as IssueTracker;
    return {
      config: oldConfig,
      trackers: new Map([["linear", tracker]]),
      watcher: { updateConfig: () => {} },
      spawner: { updateConfig: () => {} },
      slackNotifier: {},
      circuitBreakers: new Map([["linear", { updateOptions: () => {} }]]),
      healthContext: { trackers: new Map(), critterTypes: [], defaultProvider: "", repos: {}, teamRepos: {} },
      webhookConfig: { critterTypes: [] },
      autoUpdater: null,
      jsonLogsCli: false,
      ensureLabelsAndStatuses: async () => {},
      updateRefs: () => {},
    } as unknown as DaemonContext;
  }

  test("reverts both flat and grouped workDir / tmuxSession / metricsRetentionDays", async () => {
    const oldConfig = makeTestConfig({
      workDir: "/orig/work",
      tmuxSession: "orig-session",
      metricsRetentionDays: 90,
    });
    const newConfig = makeTestConfig({
      workDir: "/changed/work",
      tmuxSession: "changed-session",
      metricsRetentionDays: 7,
    });

    const handler = createConfigReloadHandler(makeCtx(oldConfig));
    handler(newConfig);

    // Grouped copies (read live by the runtime) must be reverted — this is the
    // bug: old code only reverted the flat copies below.
    expect(newConfig.daemon.workDir).toBe("/orig/work");
    expect(newConfig.daemon.tmuxSession).toBe("orig-session");
    expect(newConfig.limits.metricsRetentionDays).toBe(90);

    // Flat copies reverted too.
    expect(newConfig.workDir).toBe("/orig/work");
    expect(newConfig.tmuxSession).toBe("orig-session");
    expect(newConfig.metricsRetentionDays).toBe(90);

    // Let the fire-and-forget apply IIFE settle.
    await new Promise((r) => setTimeout(r, 0));
  });
});

// ───────────────────────────── B9 ─────────────────────────────
// Pane-title identifier capture must handle keys containing digits (e.g. Jira ABC2-123).

describe("B9 — pane-title regex matches digit-containing issue keys", () => {
  test("parses ABC2-123 from a pane title", () => {
    const line = "%3 4242 node ABC2-123: Fix the thing / exec";
    const [pane] = parsePaneList(line);
    expect(pane.identifier).toBe("ABC2-123");
  });

  test("still parses all-letter keys", () => {
    const line = "%1 1111 node ACK-12: Do a thing / plan";
    const [pane] = parsePaneList(line);
    expect(pane.identifier).toBe("ACK-12");
  });

  test("digit-containing key counts as an active critter (recovery protection)", () => {
    const panes = parsePaneList("%5 5555 node ABC2-123: Title / review");
    const active = activeCritterIdentifiersFromPanes(panes);
    expect(active.has("ABC2-123")).toBe(true);
  });
});

// ───────────────────────────── B7 ─────────────────────────────
// Every runTask invocation (including retried attempts) must (re)register the
// task in activeCritterMap. The registration now lives at the top of runTask.

describe("B7 — runTask re-registers the task in activeCritterMap", () => {
  let workBase: string;

  beforeEach(() => {
    workBase = mkdtempSync(join(tmpdir(), "critters-audit-b7-"));
  });

  afterEach(() => {
    rmSync(workBase, { recursive: true, force: true });
  });

  function makeTracker(onUpdateStatus: () => void): IssueTracker {
    return {
      provider: "linear",
      init: async () => {},
      findIssues: async () => [],
      findIssueByIdentifier: async () => null,
      updateStatus: async () => { onUpdateStatus(); },
      comment: async () => {},
      getComments: async () => [],
      uploadAttachment: async () => null,
      getAttachments: async () => [],
      fetchAttachmentContent: async () => null,
      ensureStatus: async () => {},
      ensureLabel: async () => {},
      removeLabel: async () => {},
      createIssue: async () => ({ id: "x", identifier: "X-1", url: "" }),
      listTeams: async () => [],
    } as unknown as IssueTracker;
  }

  test("each runTask call registers the active critter (observed during the run)", async () => {
    const captured: string[][] = [];

    // A type with no phases and a success outcome that flips status: applyOutcome
    // calls tracker.updateStatus while the task is still "running", letting us
    // observe activeCritterMap mid-flight without spawning a CLI.
    const critterType = makeTestCritterType({
      name: "custom",
      repo: { clone: false, branch: false },
      phases: [],
      outcomes: { success: { status: "Done" }, failure: { status: "Failed" } },
      quietComments: true,
    });
    const config = makeTestConfig({ workDir: workBase, critterTypes: [critterType] });

    let spawner: UnifiedSpawner;
    const tracker = makeTracker(() => {
      captured.push(spawner.getActiveDetails().map((d) => d.identifier));
    });
    spawner = new UnifiedSpawner(config, new Map([["linear", tracker]]));

    const task: TrackerTask = {
      id: "issue-1",
      identifier: "ACK-777",
      title: "Re-register me",
      description: "",
      repoUrl: "git@github.com:org/repo.git",
      labels: [],
    } as unknown as TrackerTask;

    // Call runTask twice to mimic an initial attempt + a retried attempt.
    // Both must register the task (old code registered only in processQueue).
    const r1 = await (spawner as unknown as { runTask: (t: TrackerTask, c: typeof critterType) => Promise<{ success: boolean }> }).runTask(task, critterType);
    const r2 = await (spawner as unknown as { runTask: (t: TrackerTask, c: typeof critterType) => Promise<{ success: boolean }> }).runTask(task, critterType);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(captured.length).toBe(2);
    expect(captured[0]).toContain("ACK-777");
    expect(captured[1]).toContain("ACK-777");
    // Cleaned up after each attempt.
    expect(spawner.getActiveDetails()).toHaveLength(0);
  });
});

// ───────────────────────────── Config watcher rename survival ─────────────────────────────
// ConfigWatcher watches the parent directory (not the file inode) so that an
// atomic, inode-replacing save (write temp + rename over the path) still fires
// onReload. The existing config-watcher.test.ts only exercises a plain
// in-place overwrite, which does NOT replace the inode and therefore would
// still pass against a naive file-handle watcher. This covers the rename case.

describe("ConfigWatcher — survives inode-replacing atomic rename", () => {
  let tempDir: string;
  let savedKey: string | undefined;

  const baseYaml = `
pollIntervalSeconds: 120
concurrency: 2
timeoutMinutes: 30
workDir: /tmp/critters-rename-test
defaultAllowedTools:
  - "Read"
  - "Write"
`;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "critters-audit-rename-"));
    savedKey = process.env.LINEAR_API_KEY;
    process.env.LINEAR_API_KEY = "test-key";
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.LINEAR_API_KEY = savedKey;
    } else {
      delete process.env.LINEAR_API_KEY;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("calls onReload after the config is replaced via temp-file + rename", async () => {
    const configPath = join(tempDir, "config.yaml");
    writeFileSync(configPath, baseYaml, "utf-8");

    const reloadedConfigs: Config[] = [];
    const watcher = new ConfigWatcher(configPath, (config) => {
      reloadedConfigs.push(config);
    });
    watcher.start();
    // Give fs.watch a moment to arm before we mutate the directory; on macOS
    // (FSEvents) an event fired in the same tick as registration can be missed.
    await new Promise((r) => setTimeout(r, 150));

    // Atomic save: write the new content to a sibling temp file, then rename it
    // over the config path. This replaces the inode — a naive fs.watch on the
    // file handle would stop firing, but the parent-dir watch survives.
    const tmpPath = join(tempDir, "config.yaml.tmp");
    const newYaml = baseYaml.replace("concurrency: 2", "concurrency: 4");
    writeFileSync(tmpPath, newYaml, "utf-8");
    renameSync(tmpPath, configPath);

    // Poll for the debounced reload (500ms debounce + FSEvents delivery
    // latency). Polling rather than a single fixed sleep keeps this from
    // flaking on slow event delivery. NOTE: fs.watch rename semantics are
    // inherently platform-dependent; the arm delay above plus this generous
    // polling window are what make this deterministic in CI.
    for (let i = 0; i < 30 && reloadedConfigs.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }

    watcher.stop();

    expect(reloadedConfigs.length).toBeGreaterThan(0);
    expect(reloadedConfigs[reloadedConfigs.length - 1].concurrency).toBe(4);
  });
});
