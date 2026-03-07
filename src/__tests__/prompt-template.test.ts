import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildPromptVars,
  getBuiltinPhaseName,
  isBuiltinPhase,
  resolvePrompt,
  resolveSkills,
  resolveTools,
} from "../prompt-template.js";
import type { TrackerTask } from "../tracker/types.js";
import type { Config } from "../types.js";
import { createTempDir } from "./helpers.js";

let tempDir: string;
let cleanup: () => void;

beforeEach(() => {
  const tmp = createTempDir();
  tempDir = tmp.path;
  cleanup = tmp.cleanup;
});

afterEach(() => {
  cleanup();
});

describe("resolvePrompt", () => {
  test("returns null for builtin: prompts", () => {
    expect(resolvePrompt("builtin:planning", {})).toBeNull();
    expect(resolvePrompt("builtin:execution", {})).toBeNull();
    expect(resolvePrompt("builtin:review", {})).toBeNull();
  });

  test("loads file and substitutes variables", () => {
    const promptFile = join(tempDir, "test.md");
    writeFileSync(promptFile, "Working on {{identifier}}: {{title}}\nRepo: {{repoUrl}}");

    const result = resolvePrompt(promptFile, {
      identifier: "ACK-42",
      title: "Fix the bug",
      repoUrl: "git@github.com:org/repo.git",
    });

    expect(result).toBe("Working on ACK-42: Fix the bug\nRepo: git@github.com:org/repo.git");
  });

  test("replaces multiple occurrences of same variable", () => {
    const promptFile = join(tempDir, "multi.md");
    writeFileSync(promptFile, "{{identifier}} is {{identifier}}");

    const result = resolvePrompt(promptFile, { identifier: "ACK-1" });
    expect(result).toBe("ACK-1 is ACK-1");
  });

  test("leaves unmatched placeholders as-is", () => {
    const promptFile = join(tempDir, "unmatched.md");
    writeFileSync(promptFile, "Hello {{name}} and {{unknown}}");

    const result = resolvePrompt(promptFile, { name: "World" });
    expect(result).toBe("Hello World and {{unknown}}");
  });

  test("throws for missing file", () => {
    expect(() => resolvePrompt("/tmp/nonexistent-prompt-file.md", {})).toThrow("Prompt file not found");
  });

  test("handles empty variables", () => {
    const promptFile = join(tempDir, "empty.md");
    writeFileSync(promptFile, "No vars here");

    const result = resolvePrompt(promptFile, {});
    expect(result).toBe("No vars here");
  });
});

describe("buildPromptVars", () => {
  test("builds vars from TrackerTask", () => {
    const task: TrackerTask = {
      id: "uuid-123",
      identifier: "ACK-42",
      title: "Fix the bug",
      description: "There's a bug in the login flow",
      repoUrl: "git@github.com:org/repo.git",
      group: "Engineering",
      groupId: "team-1",
      labels: ["Critter"],
    };

    const vars = buildPromptVars(task, "/tmp/work", "critter/ACK-42-fix-the-bug");

    expect(vars.identifier).toBe("ACK-42");
    expect(vars.title).toBe("Fix the bug");
    expect(vars.description).toBe("There's a bug in the login flow");
    expect(vars.repoUrl).toBe("git@github.com:org/repo.git");
    expect(vars.workDir).toBe("/tmp/work");
    expect(vars.branch).toBe("critter/ACK-42-fix-the-bug");
    expect(vars.group).toBe("Engineering");
    expect(vars.groupId).toBe("team-1");
  });
});

describe("resolveTools", () => {
  const config = {
    defaultAllowedTools: ["Read", "Write", "Glob"],
    repos: {},
  } as Config;

  const task: TrackerTask = {
    id: "uuid",
    identifier: "ACK-1",
    title: "Test",
    description: "",
    repoUrl: "",
    group: "Eng",
    groupId: "team-1",
    labels: [],
  };

  test("'readonly' returns planning tools", () => {
    const tools = resolveTools("readonly", config, task, null);
    expect(tools).toContain("Read");
    expect(tools).toContain("Glob");
    expect(tools).toContain("Grep");
    expect(tools).not.toContain("Edit"); // planning is read-only
  });

  test("'review' returns review tools", () => {
    const tools = resolveTools("review", config, task, null);
    expect(tools).toContain("Read");
    expect(tools).toContain("Glob");
    expect(tools).toContain("Grep");
    expect(tools).toContain("Bash(gh:*)");
  });

  test("explicit array is passed through", () => {
    const tools = resolveTools(["Read", "Grep", "Bash(python:*)"], config, task, null);
    expect(tools).toEqual(["Read", "Grep", "Bash(python:*)"]);
  });

  test("explicit array merges with repo config extras", () => {
    const tools = resolveTools(
      ["Read", "Grep"],
      config,
      task,
      { extraAllowedTools: ["Bash(poetry:*)"] },
    );
    expect(tools).toContain("Read");
    expect(tools).toContain("Grep");
    expect(tools).toContain("Bash(poetry:*)");
  });

  test("explicit array deduplicates", () => {
    const tools = resolveTools(
      ["Read", "Grep"],
      config,
      task,
      { extraAllowedTools: ["Read", "Bash(poetry:*)"] },
    );
    const readCount = tools.filter((t) => t === "Read").length;
    expect(readCount).toBe(1);
  });

  test("throws for unknown preset", () => {
    expect(() => resolveTools("nonexistent" as any, config, task, null)).toThrow("Unknown tools preset");
  });
});

describe("resolveSkills", () => {
  test("returns empty string for undefined skills", () => {
    expect(resolveSkills(undefined, {})).toBe("");
  });

  test("returns empty string for empty skills array", () => {
    expect(resolveSkills([], {})).toBe("");
  });

  test("resolves a single skill file with separator", () => {
    const skillFile = join(tempDir, "my-skill.md");
    writeFileSync(skillFile, "Always use TypeScript strict mode.");

    const result = resolveSkills([skillFile], {});
    expect(result).toContain("## Skill: my-skill");
    expect(result).toContain("Always use TypeScript strict mode.");
    expect(result).toContain("---");
  });

  test("resolves multiple skills in order", () => {
    const skill1 = join(tempDir, "first.md");
    const skill2 = join(tempDir, "second.md");
    writeFileSync(skill1, "First skill content");
    writeFileSync(skill2, "Second skill content");

    const result = resolveSkills([skill1, skill2], {});
    const firstIdx = result.indexOf("First skill content");
    const secondIdx = result.indexOf("Second skill content");
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(-1);
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(result).toContain("## Skill: first");
    expect(result).toContain("## Skill: second");
  });

  test("applies {{var}} substitution in skills", () => {
    const skillFile = join(tempDir, "vars.md");
    writeFileSync(skillFile, "Working on {{identifier}} in {{workDir}}");

    const result = resolveSkills([skillFile], {
      identifier: "ACK-99",
      workDir: "/tmp/work",
    });
    expect(result).toContain("Working on ACK-99 in /tmp/work");
  });

  test("throws for missing skill file", () => {
    expect(() => resolveSkills(["/tmp/nonexistent-skill.md"], {})).toThrow(
      "Skill file not found",
    );
  });

  test("strips extension from skill name", () => {
    const skillFile = join(tempDir, "output-format.md");
    writeFileSync(skillFile, "Format output as JSON.");

    const result = resolveSkills([skillFile], {});
    expect(result).toContain("## Skill: output-format");
    expect(result).not.toContain("output-format.md");
  });
});

describe("isBuiltinPhase / getBuiltinPhaseName", () => {
  test("identifies builtin phases", () => {
    expect(isBuiltinPhase({ name: "p", prompt: "builtin:planning", model: "opus", maxTurns: 10, tools: "readonly" })).toBe(true);
    expect(isBuiltinPhase({ name: "e", prompt: "builtin:execution", model: "opus", maxTurns: 10, tools: "default" })).toBe(true);
    expect(isBuiltinPhase({ name: "r", prompt: "builtin:review", model: "opus", maxTurns: 10, tools: "review" })).toBe(true);
  });

  test("identifies non-builtin phases", () => {
    expect(isBuiltinPhase({ name: "x", prompt: "~/.critters/prompts/audit.md", model: "opus", maxTurns: 10, tools: "default" })).toBe(false);
    expect(isBuiltinPhase({ name: "x", prompt: "/absolute/path.md", model: "opus", maxTurns: 10, tools: "default" })).toBe(false);
  });

  test("extracts builtin phase name", () => {
    expect(getBuiltinPhaseName({ name: "p", prompt: "builtin:planning", model: "opus", maxTurns: 10, tools: "readonly" })).toBe("planning");
    expect(getBuiltinPhaseName({ name: "e", prompt: "builtin:execution", model: "opus", maxTurns: 10, tools: "default" })).toBe("execution");
    expect(getBuiltinPhaseName({ name: "r", prompt: "builtin:review", model: "opus", maxTurns: 10, tools: "review" })).toBe("review");
  });

  test("returns null for non-builtin", () => {
    expect(getBuiltinPhaseName({ name: "x", prompt: "/path/to/file.md", model: "opus", maxTurns: 10, tools: "default" })).toBeNull();
  });
});
