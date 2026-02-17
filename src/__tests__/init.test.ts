import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import { mergeConfig } from "../init.js";

const DEFAULT_CONFIG = `pollIntervalSeconds: 120
concurrency: 2
timeoutMinutes: 30
workDir: /tmp/critters-work
triggerLabel: "Critter"
maxPlanningTurns: 50
maxExecutionTurns: 75
tmuxSession: critters
planningModel: opus
executionModel: opus

defaultAllowedTools:
  - "Read"
  - "Write"
  - "Edit"
  - "Glob"
  - "Grep"
  - "Bash(git:*)"
  - "Bash(gh:*)"
  - "Bash(bun:*)"
  - "Bash(npm:*)"
  - "Bash(npx:*)"
  - "Bash(node:*)"
  - "Bash(tsc:*)"
  - "Bash(ls:*)"
  - "Bash(mkdir:*)"
  - "Bash(cat:*)"

repos:

teamRepos:

reviewTriggerLabel: "Critter Review"
reviewModel: opus
reviewConcurrency: 2
reviewTimeoutMinutes: 15
maxReviewTurns: 30
`;

describe("mergeConfig", () => {
  test("fresh/empty config gets all defaults", () => {
    const { merged, added } = mergeConfig("", DEFAULT_CONFIG);
    const parsed = parseYaml(merged) as Record<string, unknown>;
    const defaults = parseYaml(DEFAULT_CONFIG) as Record<string, unknown>;

    for (const key of Object.keys(defaults)) {
      expect(key in parsed).toBe(true);
      expect(added).toContain(key);
    }
    expect(added.length).toBe(Object.keys(defaults).length);
  });

  test("re-init with missing fields adds them while preserving existing values", () => {
    const existing = `pollIntervalSeconds: 60\nconcurrency: 4\n`;
    const { merged, added } = mergeConfig(existing, DEFAULT_CONFIG);
    const parsed = parseYaml(merged) as Record<string, unknown>;
    const defaults = parseYaml(DEFAULT_CONFIG) as Record<string, unknown>;

    // Existing values are preserved
    expect(parsed.pollIntervalSeconds).toBe(60);
    expect(parsed.concurrency).toBe(4);

    // All other default keys were added
    expect(added).not.toContain("pollIntervalSeconds");
    expect(added).not.toContain("concurrency");
    for (const key of Object.keys(defaults)) {
      if (key !== "pollIntervalSeconds" && key !== "concurrency") {
        expect(added).toContain(key);
        expect(parsed[key]).toEqual(defaults[key]);
      }
    }
  });

  test("re-init when config is already complete adds nothing", () => {
    // Build an existing config that has every key from defaults
    const defaults = parseYaml(DEFAULT_CONFIG) as Record<string, unknown>;
    const fullExisting = Object.entries(defaults)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n");

    const { added } = mergeConfig(fullExisting, DEFAULT_CONFIG);
    expect(added).toHaveLength(0);
  });

  test("user values are never overwritten", () => {
    const existing = `concurrency: 10\n`;
    const { merged } = mergeConfig(existing, DEFAULT_CONFIG);
    const parsed = parseYaml(merged) as Record<string, unknown>;
    expect(parsed.concurrency).toBe(10);
  });

  test("nested objects added only if absent, user-populated repos preserved", () => {
    const existing = `repos:\n  "my-project":\n    url: "git@github.com:org/repo.git"\n`;
    const { merged, added } = mergeConfig(existing, DEFAULT_CONFIG);
    const parsed = parseYaml(merged) as Record<string, unknown>;

    // repos is untouched since it was already present
    expect(added).not.toContain("repos");
    const repos = parsed.repos as Record<string, unknown>;
    expect(repos["my-project"]).toBeDefined();

    // teamRepos was absent, so it should be added
    expect(added).toContain("teamRepos");
  });

  test("array fields added if absent, not merged element-by-element", () => {
    const existing = `defaultAllowedTools:\n  - "Read"\n  - "CustomTool"\n`;
    const { merged, added } = mergeConfig(existing, DEFAULT_CONFIG);
    const parsed = parseYaml(merged) as Record<string, unknown>;

    // User's list is preserved as-is
    expect(parsed.defaultAllowedTools).toEqual(["Read", "CustomTool"]);
    expect(added).not.toContain("defaultAllowedTools");
  });

  test("handles null/empty YAML file gracefully", () => {
    const defaults = parseYaml(DEFAULT_CONFIG) as Record<string, unknown>;

    for (const input of ["", "   ", "---"]) {
      const { merged, added } = mergeConfig(input, DEFAULT_CONFIG);
      const parsed = parseYaml(merged) as Record<string, unknown>;
      expect(added.length).toBe(Object.keys(defaults).length);
      for (const key of Object.keys(defaults)) {
        expect(key in parsed).toBe(true);
      }
    }
  });

  test("extra keys in existing config not in defaults are preserved", () => {
    const existing = `myCustomField: hello\nconcurrency: 2\n`;
    const { merged, added } = mergeConfig(existing, DEFAULT_CONFIG);
    const parsed = parseYaml(merged) as Record<string, unknown>;

    expect(parsed.myCustomField).toBe("hello");
    expect(added).not.toContain("myCustomField");
  });
});
