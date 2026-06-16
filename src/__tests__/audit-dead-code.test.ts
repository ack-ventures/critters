import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CliAdapter } from "../cli/types.js";
import * as enums from "../enums.js";
import type { PerRepoConfig } from "../repo-config.js";
import { buildReviewPrompt } from "../review-prompt.js";
import type { ReviewTask } from "../types.js";

// These tests pin the dead-code removals from the audit so the symbols/files
// cannot silently reappear.

describe("enums dead constant removal", () => {
  test("keeps the enums that are actually used", () => {
    expect(enums.ToolPreset).toBeDefined();
    expect(enums.BuiltinPhase).toBeDefined();
    expect(enums.ReviewDecision).toBeDefined();
    expect(enums.BuiltinPhase.Planning).toBe("planning");
    expect(enums.ReviewDecision.Merged).toBe("merged");
  });

  test("removes the dead constants", () => {
    const keys = Object.keys(enums);
    expect(keys).not.toContain("BuiltinPrompt");
    expect(keys).not.toContain("Provider");
    expect(keys).not.toContain("Enrichment");
    expect(keys).not.toContain("Outcome");
  });
});

describe("legacy dashboard pages removed", () => {
  const srcDir = join(import.meta.dir, "..");

  test("issue-page and log-page source files no longer exist", () => {
    expect(existsSync(join(srcDir, "dashboard/issue-page.ts"))).toBe(false);
    expect(existsSync(join(srcDir, "dashboard/log-page.ts"))).toBe(false);
  });
});

describe("legacy module-level linear API removed", () => {
  test("src/linear.ts no longer exists", () => {
    expect(existsSync(join(import.meta.dir, "..", "linear.ts"))).toBe(false);
  });
});

describe("buildReviewPrompt simplified signature", () => {
  const task: ReviewTask = {
    issueId: "issue-1",
    identifier: "ACK-42",
    title: "Add login button",
    description: "repo: git@github.com:org/repo.git\nAdd a login button",
    repoUrl: "git@github.com:org/repo.git",
    teamId: "team-1",
    prUrl: "https://github.com/org/repo/pull/99",
    prNumber: 99,
    prBranch: "critter/ACK-42",
  };

  test("uses adapter guidance and repo config in 3-arg form", () => {
    const adapter = {
      name: "fake",
      binary: "fake-cli",
      promptGuidance: () => "## Custom Guidance From Adapter",
      capabilities: { toolRestrictions: false },
    } as unknown as CliAdapter;
    const repoConfig = { reviewPrompt: "Repo specific reviewer note" } as PerRepoConfig;

    const prompt = buildReviewPrompt(task, adapter, repoConfig);
    expect(prompt).toContain("## Custom Guidance From Adapter");
    expect(prompt).toContain("Repo specific reviewer note");
    // toolRestrictions:false selects the relaxed guidance wording.
    expect(prompt).toContain("even if the CLI sandbox technically allows more");
  });

  test("falls back to default guidance with no adapter (1-arg form)", () => {
    const prompt = buildReviewPrompt(task);
    expect(prompt).toContain("## Reading Large Files");
    expect(prompt).toContain("Only the requested read-only review tools");
  });
});

describe("init does not lock stdin at import time", () => {
  test("stdin stream is not locked after importing init", async () => {
    await import("../init.js");
    // The reader is now acquired lazily inside readLine(), so simply importing
    // the module must not leave stdin permanently locked.
    expect(Bun.stdin.stream().locked).toBe(false);
  });
});
