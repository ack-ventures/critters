import { describe, expect, test } from "bun:test";
import {
  cleanLinearMarkdown,
  parseRepoUrl,
  resolveRepoUrl,
  stripRepoLine,
} from "../prompt.js";
import type { Config, CritterTask } from "../types.js";
import { compareSemver } from "../updater.js";
import {
  branchName,
  formatDuration,
  formatPhaseStats,
  formatTokenCount,
  slugify,
  tailLines,
} from "../utils.js";

// ---------------------------------------------------------------------------
// src/utils.ts
// ---------------------------------------------------------------------------

describe("src/utils.ts", () => {
  describe("slugify", () => {
    test("empty string", () => {
      expect(slugify("")).toBe("");
    });

    test("simple text", () => {
      expect(slugify("Hello World")).toBe("hello-world");
    });

    test("special characters", () => {
      expect(slugify("foo@bar#baz!")).toBe("foo-bar-baz");
    });

    test("consecutive special chars", () => {
      expect(slugify("foo---bar")).toBe("foo-bar");
    });

    test("leading/trailing hyphens", () => {
      expect(slugify("--hello--")).toBe("hello");
    });

    test("leading special chars", () => {
      expect(slugify("!!!test")).toBe("test");
    });

    test("trailing special chars", () => {
      expect(slugify("test!!!")).toBe("test");
    });

    test("long string (>50 chars)", () => {
      expect(slugify("a".repeat(60))).toBe("a".repeat(50));
    });

    test("unicode characters", () => {
      expect(slugify("café résumé")).toBe("caf-r-sum");
    });

    test("numbers preserved", () => {
      expect(slugify("v2-release-3")).toBe("v2-release-3");
    });

    test("only special chars", () => {
      expect(slugify("@#$%")).toBe("");
    });
  });

  describe("branchName", () => {
    test("basic formatting", () => {
      expect(branchName("ACK-1", "My Feature")).toBe(
        "critter/ACK-1-my-feature",
      );
    });

    test("with special chars in title", () => {
      expect(branchName("ACK-2", "Fix: bug #123")).toBe(
        "critter/ACK-2-fix-bug-123",
      );
    });

    test("empty title", () => {
      expect(branchName("ACK-3", "")).toBe("critter/ACK-3-");
    });
  });

  describe("formatDuration", () => {
    test("zero", () => {
      expect(formatDuration(0)).toBe("0s");
    });

    test("sub-second (rounds to 0)", () => {
      expect(formatDuration(499)).toBe("0s");
    });

    test("seconds only", () => {
      expect(formatDuration(5000)).toBe("5s");
    });

    test("exactly 59 seconds", () => {
      expect(formatDuration(59000)).toBe("59s");
    });

    test("exactly 1 minute", () => {
      expect(formatDuration(60000)).toBe("1m 0s");
    });

    test("minutes and seconds", () => {
      expect(formatDuration(90000)).toBe("1m 30s");
    });

    test("exactly 59m 59s", () => {
      expect(formatDuration(3599000)).toBe("59m 59s");
    });

    test("exactly 1 hour", () => {
      expect(formatDuration(3600000)).toBe("1h 0m");
    });

    test("hours and minutes", () => {
      expect(formatDuration(5400000)).toBe("1h 30m");
    });

    test("rounding at boundary", () => {
      expect(formatDuration(59500)).toBe("1m 0s");
    });
  });

  describe("formatTokenCount", () => {
    test("small number", () => {
      expect(formatTokenCount(42)).toBe("42");
    });

    test("zero", () => {
      expect(formatTokenCount(0)).toBe("0");
    });

    test("just below 1000", () => {
      expect(formatTokenCount(999)).toBe("999");
    });

    test("exactly 1000", () => {
      expect(formatTokenCount(1000)).toBe("1k");
    });

    test("thousands", () => {
      expect(formatTokenCount(1500)).toBe("2k");
    });

    test("large thousands", () => {
      expect(formatTokenCount(50000)).toBe("50k");
    });

    test("just below 1M", () => {
      expect(formatTokenCount(999999)).toBe("1000k");
    });

    test("exactly 1M", () => {
      expect(formatTokenCount(1000000)).toBe("1.0M");
    });

    test("millions with decimal", () => {
      expect(formatTokenCount(1500000)).toBe("1.5M");
    });

    test("large millions", () => {
      expect(formatTokenCount(25700000)).toBe("25.7M");
    });
  });

  describe("formatPhaseStats", () => {
    test("null numTurns", () => {
      expect(formatPhaseStats({ numTurns: undefined })).toBe("");
    });

    test("numTurns is null (explicit)", () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing runtime null handling
      expect(formatPhaseStats({ numTurns: null as any })).toBe("");
    });

    test("all fields present", () => {
      expect(
        formatPhaseStats({
          numTurns: 10,
          inputTokens: 5000,
          outputTokens: 2000,
          cacheReadTokens: 3000,
          costUsd: 0.15,
        }),
      ).toBe(" (10 turns, 5k in / 2k out / 3k cached, $0.15)");
    });

    test("only numTurns", () => {
      expect(formatPhaseStats({ numTurns: 5 })).toBe(" (5 turns)");
    });

    test("numTurns + cost only", () => {
      expect(formatPhaseStats({ numTurns: 3, costUsd: 1.5 })).toBe(
        " (3 turns, $1.50)",
      );
    });

    test("numTurns + input only", () => {
      expect(formatPhaseStats({ numTurns: 7, inputTokens: 1500000 })).toBe(
        " (7 turns, 1.5M in)",
      );
    });

    test("missing some token fields", () => {
      expect(
        formatPhaseStats({ numTurns: 2, inputTokens: 500, outputTokens: 200 }),
      ).toBe(" (2 turns, 500 in / 200 out)");
    });
  });

  describe("tailLines", () => {
    test("more lines than N", () => {
      expect(tailLines("a\nb\nc\nd\ne", 3)).toBe("c\nd\ne");
    });

    test("fewer lines than N", () => {
      expect(tailLines("a\nb", 5)).toBe("a\nb");
    });

    test("empty string", () => {
      expect(tailLines("", 3)).toBe("");
    });

    test("single line", () => {
      expect(tailLines("hello", 3)).toBe("hello");
    });

    test("N = 0", () => {
      // slice(-0) is slice(0) in JS, so returns the full array
      expect(tailLines("a\nb\nc", 0)).toBe("a\nb\nc");
    });

    test("exact match (N equals line count)", () => {
      expect(tailLines("a\nb\nc", 3)).toBe("a\nb\nc");
    });

    test("trailing newline", () => {
      // "a\nb\n" splits to ["a","b",""], last 2 → ["b",""] → "b\n"
      expect(tailLines("a\nb\n", 2)).toBe("b\n");
    });
  });
});

// ---------------------------------------------------------------------------
// src/prompt.ts
// ---------------------------------------------------------------------------

describe("src/prompt.ts", () => {
  describe("cleanLinearMarkdown", () => {
    test("does not match without angle brackets", () => {
      expect(
        cleanLinearMarkdown("[git@github.com](mailto:git@github.com)"),
      ).toBe("[git@github.com](mailto:git@github.com)");
    });

    test("converts Linear format with angle brackets", () => {
      expect(
        cleanLinearMarkdown("[git@github.com](<mailto:git@github.com>)"),
      ).toBe("git@github.com");
    });

    test("no-op on plain text", () => {
      expect(cleanLinearMarkdown("just plain text")).toBe("just plain text");
    });

    test("multiple mailto links", () => {
      expect(
        cleanLinearMarkdown(
          "[a@b.com](<mailto:a@b.com>) and [c@d.com](<mailto:c@d.com>)",
        ),
      ).toBe("a@b.com and c@d.com");
    });

    test("preserves other markdown", () => {
      expect(cleanLinearMarkdown("[link](https://example.com)")).toBe(
        "[link](https://example.com)",
      );
    });

    test("empty string", () => {
      expect(cleanLinearMarkdown("")).toBe("");
    });
  });

  describe("parseRepoUrl", () => {
    test("extracts SSH URL", () => {
      expect(parseRepoUrl("repo: git@github.com:org/repo.git")).toBe(
        "git@github.com:org/repo.git",
      );
    });

    test("extracts HTTPS URL", () => {
      expect(parseRepoUrl("repo: https://github.com/org/repo.git")).toBe(
        "https://github.com/org/repo.git",
      );
    });

    test("returns null if missing", () => {
      expect(parseRepoUrl("no repo line here")).toBeNull();
    });

    test("handles Linear markdown mangling", () => {
      expect(
        parseRepoUrl(
          "repo: [git@github.com](<mailto:git@github.com>):org/repo.git",
        ),
      ).toBe("git@github.com:org/repo.git");
    });

    test("case-insensitive prefix", () => {
      expect(parseRepoUrl("Repo: git@github.com:org/repo.git")).toBe(
        "git@github.com:org/repo.git",
      );
    });

    test("trims whitespace", () => {
      expect(parseRepoUrl("repo:   git@github.com:org/repo.git  ")).toBe(
        "git@github.com:org/repo.git",
      );
    });

    test("multiline description", () => {
      expect(
        parseRepoUrl(
          "Some task\nrepo: git@github.com:org/repo.git\nMore text",
        ),
      ).toBe("git@github.com:org/repo.git");
    });

    test("empty string", () => {
      expect(parseRepoUrl("")).toBeNull();
    });
  });

  describe("stripRepoLine", () => {
    test("removes repo line", () => {
      expect(
        stripRepoLine(
          "Some task\nrepo: git@github.com:org/repo.git\nMore text",
        ),
      ).toBe("Some task\n\nMore text");
    });

    test("no repo line (no-op)", () => {
      expect(stripRepoLine("just a description")).toBe("just a description");
    });

    test("only repo line", () => {
      expect(stripRepoLine("repo: git@github.com:org/repo.git")).toBe("");
    });

    test("handles Linear markdown", () => {
      expect(
        stripRepoLine(
          "task\nrepo: [git@github.com](<mailto:git@github.com>):org/repo.git",
        ),
      ).toBe("task");
    });
  });

  describe("resolveRepoUrl", () => {
    const baseTask: CritterTask = {
      issueId: "issue-1",
      identifier: "ACK-1",
      title: "Test",
      description: "",
      repoUrl: "",
      teamId: "team-1",
    };

    const baseConfig: Config = {
      pollIntervalSeconds: 120,
      concurrency: 2,
      timeoutMinutes: 30,
      workDir: "/tmp",
      triggerLabel: "Critter",
      maxPlanningTurns: 50,
      maxExecutionTurns: 50,
      defaultAllowedTools: [],
      repos: {},
      teamRepos: {},
      tmuxSession: "critters",
      noTmux: false,
      planningModel: "opus",
      executionModel: "opus",
      reviewTriggerLabel: "Critter Review",
      reviewModel: "opus",
      reviewConcurrency: 2,
      reviewTimeoutMinutes: 15,
      maxReviewTurns: 30,
      healthPort: 3847,
      linearApiKey: "test",
    };

    test("from description (highest priority)", () => {
      const task = {
        ...baseTask,
        description: "repo: git@github.com:org/repo.git",
      };
      expect(resolveRepoUrl(task, baseConfig)).toBe(
        "git@github.com:org/repo.git",
      );
    });

    test("from project config (2nd priority)", () => {
      const task = { ...baseTask, projectId: "proj-1" };
      const config = {
        ...baseConfig,
        repos: { "proj-1": { url: "git@github.com:org/project-repo.git" } },
      };
      expect(resolveRepoUrl(task, config)).toBe(
        "git@github.com:org/project-repo.git",
      );
    });

    test("from team config (3rd priority)", () => {
      const task = { ...baseTask };
      const config = {
        ...baseConfig,
        teamRepos: { "team-1": "git@github.com:org/team-repo.git" },
      };
      expect(resolveRepoUrl(task, config)).toBe(
        "git@github.com:org/team-repo.git",
      );
    });

    test("returns null when nothing matches", () => {
      expect(resolveRepoUrl(baseTask, baseConfig)).toBeNull();
    });

    test("description takes priority over project config", () => {
      const task = {
        ...baseTask,
        description: "repo: git@github.com:org/desc-repo.git",
        projectId: "proj-1",
      };
      const config = {
        ...baseConfig,
        repos: { "proj-1": { url: "git@github.com:org/project-repo.git" } },
      };
      expect(resolveRepoUrl(task, config)).toBe(
        "git@github.com:org/desc-repo.git",
      );
    });

    test("project config takes priority over team config", () => {
      const task = { ...baseTask, projectId: "proj-1" };
      const config = {
        ...baseConfig,
        repos: { "proj-1": { url: "git@github.com:org/project-repo.git" } },
        teamRepos: { "team-1": "git@github.com:org/team-repo.git" },
      };
      expect(resolveRepoUrl(task, config)).toBe(
        "git@github.com:org/project-repo.git",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// src/updater.ts
// ---------------------------------------------------------------------------

describe("src/updater.ts", () => {
  describe("compareSemver", () => {
    test("equal versions", () => {
      expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    });

    test("major difference (a > b)", () => {
      expect(compareSemver("2.0.0", "1.0.0")).toBeGreaterThan(0);
    });

    test("major difference (a < b)", () => {
      expect(compareSemver("1.0.0", "2.0.0")).toBeLessThan(0);
    });

    test("minor difference", () => {
      expect(compareSemver("1.2.0", "1.1.0")).toBeGreaterThan(0);
    });

    test("patch difference", () => {
      expect(compareSemver("1.2.3", "1.2.4")).toBeLessThan(0);
    });

    test("missing segments treated as 0", () => {
      expect(compareSemver("1.2", "1.2.0")).toBe(0);
    });

    test("single segment", () => {
      expect(compareSemver("2", "1")).toBeGreaterThan(0);
    });

    test("mixed missing segments", () => {
      expect(compareSemver("1.0", "1.0.1")).toBeLessThan(0);
    });
  });
});
