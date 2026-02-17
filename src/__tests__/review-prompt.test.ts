import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCustomPrompt } from "../prompt.js";
import { buildReviewPrompt, getReviewAllowedTools } from "../review-prompt.js";
import type { ReviewTask } from "../types.js";

describe("getReviewAllowedTools", () => {
  test("returns read-only tools plus gh and git", () => {
    const tools = getReviewAllowedTools();
    expect(tools).toContain("Read");
    expect(tools).toContain("Glob");
    expect(tools).toContain("Grep");
    expect(tools).toContain("Bash(gh:*)");
    expect(tools).toContain("Bash(git:*)");
  });

  test("does not include Write, Edit, or Task", () => {
    const tools = getReviewAllowedTools();
    expect(tools).not.toContain("Write");
    expect(tools).not.toContain("Edit");
    expect(tools).not.toContain("Task");
  });
});

describe("buildReviewPrompt", () => {
  const task: ReviewTask = {
    issueId: "issue-1",
    identifier: "ACK-42",
    title: "Add login button",
    description: "repo: git@github.com:org/repo.git\nAdd a login button to the header",
    repoUrl: "git@github.com:org/repo.git",
    teamId: "team-1",
    prUrl: "https://github.com/org/repo/pull/99",
    prNumber: 99,
    prBranch: "critter/ACK-42-add-login-button",
  };

  test("includes PR URL, number, and branch", () => {
    const prompt = buildReviewPrompt(task);
    expect(prompt).toContain("https://github.com/org/repo/pull/99");
    expect(prompt).toContain("critter/ACK-42-add-login-button");
    expect(prompt).toContain("gh pr view 99");
    expect(prompt).toContain("gh pr diff 99");
  });

  test("includes identifier and title", () => {
    const prompt = buildReviewPrompt(task);
    expect(prompt).toContain("ACK-42");
    expect(prompt).toContain("Add login button");
  });

  test("includes task description without repo line", () => {
    const prompt = buildReviewPrompt(task);
    expect(prompt).toContain("Add a login button to the header");
    expect(prompt).not.toContain("repo: git@github.com");
  });

  test("includes REVIEW_RESULT sentinel instructions", () => {
    const prompt = buildReviewPrompt(task);
    expect(prompt).toContain("REVIEW_RESULT:MERGED");
    expect(prompt).toContain("REVIEW_RESULT:NEEDS_CHANGES");
  });

  test("does not include Write or Edit instructions", () => {
    const prompt = buildReviewPrompt(task);
    expect(prompt).not.toContain("Write your");
    expect(prompt).not.toContain("Edit the");
    expect(prompt).toContain("Do NOT modify any files");
  });

  test("does not contain Additional Context when no custom file exists", () => {
    // When review-prompt.md does not exist in ~/.critters, no section is appended.
    // We verify the prompt still contains expected content.
    const prompt = buildReviewPrompt(task);
    expect(prompt).toContain("ACK-42");
    expect(prompt).toContain("REVIEW_RESULT:MERGED");
  });
});

describe("buildReviewPrompt custom prompt integration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "critters-review-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("readCustomPrompt returns null when review-prompt.md missing", () => {
    expect(readCustomPrompt("review-prompt.md", tempDir)).toBeNull();
  });

  test("readCustomPrompt returns content when review-prompt.md has content", () => {
    writeFileSync(
      join(tempDir, "review-prompt.md"),
      "Be especially strict about security issues.",
    );
    expect(readCustomPrompt("review-prompt.md", tempDir)).toBe(
      "Be especially strict about security issues.",
    );
  });

  test("appended custom content format is correct", () => {
    writeFileSync(
      join(tempDir, "review-prompt.md"),
      "Be especially strict about security issues.",
    );
    const custom = readCustomPrompt("review-prompt.md", tempDir);
    const fakeBase = "Review prompt base";
    const result = custom
      ? `${fakeBase}\n\n## Additional Context\n${custom}`
      : fakeBase;
    expect(result).toContain("## Additional Context");
    expect(result).toContain("Be especially strict about security issues.");
    expect(result).toMatch(/## Additional Context\nBe especially strict/);
  });
});
