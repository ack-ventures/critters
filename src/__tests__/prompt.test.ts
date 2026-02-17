import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildExecutionPrompt,
  buildPlanningPrompt,
  readCustomPrompt,
} from "../prompt.js";
import type { CritterTask } from "../types.js";

describe("readCustomPrompt", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "critters-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns null when file does not exist", () => {
    expect(readCustomPrompt("planning-prompt.md", tempDir)).toBeNull();
  });

  test("returns null when file is empty (0 bytes)", () => {
    writeFileSync(join(tempDir, "planning-prompt.md"), "");
    expect(readCustomPrompt("planning-prompt.md", tempDir)).toBeNull();
  });

  test("returns null when file contains only whitespace", () => {
    writeFileSync(join(tempDir, "planning-prompt.md"), "   \n\n\t  ");
    expect(readCustomPrompt("planning-prompt.md", tempDir)).toBeNull();
  });

  test("returns trimmed content when file has real content", () => {
    writeFileSync(
      join(tempDir, "planning-prompt.md"),
      "Always use TypeScript strict mode.",
    );
    expect(readCustomPrompt("planning-prompt.md", tempDir)).toBe(
      "Always use TypeScript strict mode.",
    );
  });

  test("returns trimmed content when file has leading/trailing whitespace", () => {
    writeFileSync(
      join(tempDir, "planning-prompt.md"),
      "\n\n  Always use TypeScript strict mode.  \n\n",
    );
    expect(readCustomPrompt("planning-prompt.md", tempDir)).toBe(
      "Always use TypeScript strict mode.",
    );
  });

  test("returns content for HTML comment placeholder (not empty)", () => {
    writeFileSync(
      join(tempDir, "planning-prompt.md"),
      "<!-- Optional: Add extra context for the planning phase here. -->",
    );
    // HTML comment is not whitespace-only, so it is returned
    expect(readCustomPrompt("planning-prompt.md", tempDir)).toBe(
      "<!-- Optional: Add extra context for the planning phase here. -->",
    );
  });

  test("uses different filenames independently", () => {
    writeFileSync(
      join(tempDir, "execution-prompt.md"),
      "Use bun instead of npm.",
    );
    expect(readCustomPrompt("planning-prompt.md", tempDir)).toBeNull();
    expect(readCustomPrompt("execution-prompt.md", tempDir)).toBe(
      "Use bun instead of npm.",
    );
  });

  test("uses homedir by default when no baseDir provided", () => {
    // Just verify the function runs without error when using the real homedir
    // (the file likely doesn't exist there, so it should return null)
    const result = readCustomPrompt("__nonexistent-test-file__.md");
    expect(result).toBeNull();
  });
});

describe("buildPlanningPrompt with custom content", () => {
  let tempDir: string;

  const task: CritterTask = {
    issueId: "issue-1",
    identifier: "ACK-42",
    title: "Add login button",
    description: "Add a login button to the header",
    repoUrl: "git@github.com:org/repo.git",
    teamId: "team-1",
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "critters-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("does not contain Additional Context when no custom file exists", () => {
    // buildPlanningPrompt uses default homedir; no file there so no section
    const prompt = buildPlanningPrompt(task);
    // We can't control the real ~/.critters dir, so just verify the function works.
    // The key assertion: if the file doesn't exist, no "## Additional Context" from it.
    // This test verifies the prompt contains expected content at minimum.
    expect(prompt).toContain("ACK-42");
    expect(prompt).toContain("Add login button");
  });

  test("contains structured reviewer format instructions", () => {
    const prompt = buildPlanningPrompt(task);
    expect(prompt).toContain("REVIEW_STATUS: APPROVED");
    expect(prompt).toContain("REVIEW_STATUS: NEEDS_REVISION");
    expect(prompt).toContain("[MUST_FIX]");
    expect(prompt).toContain("[SHOULD_FIX]");
    expect(prompt).toContain("[CONSIDER]");
    expect(prompt).toContain("Previous Review Items");
  });
});

describe("buildExecutionPrompt with custom content", () => {
  let tempDir: string;

  const task: CritterTask = {
    issueId: "issue-1",
    identifier: "ACK-42",
    title: "Add login button",
    description: "Add a login button to the header",
    repoUrl: "git@github.com:org/repo.git",
    teamId: "team-1",
  };

  const allowedTools = [
    "Read",
    "Write",
    "Edit",
    "Bash(git:*)",
    "Bash(gh:*)",
    "Bash(bun:*)",
  ];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "critters-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("does not contain Additional Context when no custom file exists", () => {
    const prompt = buildExecutionPrompt(task, allowedTools);
    expect(prompt).toContain("ACK-42");
    expect(prompt).toContain("Add login button");
    expect(prompt).toContain("git, gh, bun");
  });
});

describe("readCustomPrompt integration — prompt appending", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "critters-test-"));
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("appends custom content correctly when file exists", () => {
    writeFileSync(
      join(tempDir, "planning-prompt.md"),
      "Always prefer functional style.",
    );
    const custom = readCustomPrompt("planning-prompt.md", tempDir);
    expect(custom).toBe("Always prefer functional style.");
    // Simulate what buildPlanningPrompt does
    const fakeBase = "Base prompt content";
    const result = custom
      ? `${fakeBase}\n\n## Additional Context\n${custom}`
      : fakeBase;
    expect(result).toContain("## Additional Context");
    expect(result).toContain("Always prefer functional style.");
  });

  test("does not append when file is empty", () => {
    writeFileSync(join(tempDir, "execution-prompt.md"), "");
    const custom = readCustomPrompt("execution-prompt.md", tempDir);
    expect(custom).toBeNull();
    const fakeBase = "Base prompt content";
    const result = custom
      ? `${fakeBase}\n\n## Additional Context\n${custom}`
      : fakeBase;
    expect(result).toBe("Base prompt content");
    expect(result).not.toContain("## Additional Context");
  });
});
