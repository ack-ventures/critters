import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { realpathSync, writeFileSync } from "node:fs";
import { loadConfig } from "../config.js";
import { createTempDir } from "./helpers.js";

let tempDir: string;
let cleanup: () => void;
let savedLinearApiKey: string | undefined;
let savedSlackWebhookUrl: string | undefined;

beforeEach(() => {
  const tmp = createTempDir();
  tempDir = tmp.path;
  cleanup = tmp.cleanup;

  savedLinearApiKey = process.env.LINEAR_API_KEY;
  savedSlackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
  process.env.LINEAR_API_KEY = "test-key";
  delete process.env.SLACK_WEBHOOK_URL;
});

afterEach(() => {
  cleanup();
  if (savedLinearApiKey !== undefined) {
    process.env.LINEAR_API_KEY = savedLinearApiKey;
  } else {
    delete process.env.LINEAR_API_KEY;
  }
  if (savedSlackWebhookUrl !== undefined) {
    process.env.SLACK_WEBHOOK_URL = savedSlackWebhookUrl;
  } else {
    delete process.env.SLACK_WEBHOOK_URL;
  }
});

function writeYaml(content: string): string {
  const path = `${tempDir}/config.yaml`;
  writeFileSync(path, content, "utf-8");
  return path;
}

describe("loadConfig", () => {
  test("loads a fully-specified config file", () => {
    const yaml = `
pollIntervalSeconds: 60
concurrency: 4
timeoutMinutes: 45
workDir: /tmp/critters-full-test
triggerLabel: "Bug"
maxPlanningTurns: 30
maxExecutionTurns: 100
maxLogSizeMb: 20
tmuxSession: "my-session"
defaultAllowedTools:
  - "Read"
  - "Write"
  - "Bash(git:*)"
repos:
  "proj-1":
    url: "git@github.com:org/repo-a.git"
    extraAllowedTools:
      - "Bash(python:*)"
teamRepos:
  "team-1": "git@github.com:org/default-repo.git"
`;
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    const config = loadConfig(writeYaml(yaml));

    expect(config.pollIntervalSeconds).toBe(60);
    expect(config.concurrency).toBe(4);
    expect(config.timeoutMinutes).toBe(45);
    expect(config.workDir).toBe(realpathSync("/tmp/critters-full-test"));
    expect(config.triggerLabel).toBe("Bug");
    expect(config.maxPlanningTurns).toBe(30);
    expect(config.maxExecutionTurns).toBe(100);
    expect(config.tmuxSession).toBe("my-session");
    expect(config.defaultAllowedTools).toEqual(["Read", "Write", "Bash(git:*)"]);
    expect(config.noTmux).toBe(false);
    expect(config.linearApiKey).toBe("test-key");
    expect(config.slackWebhookUrl).toBe("https://hooks.slack.com/test");
    expect(config.maxLogSizeMb).toBe(20);
    expect(config.repos["proj-1"].url).toBe("git@github.com:org/repo-a.git");
    expect(config.repos["proj-1"].extraAllowedTools).toEqual(["Bash(python:*)"]);
    expect(config.teamRepos["team-1"]).toBe("git@github.com:org/default-repo.git");
  });

  test("applies defaults for missing optional fields", () => {
    const yaml = `defaultAllowedTools:\n  - "Read"\n`;
    const config = loadConfig(writeYaml(yaml));

    expect(config.pollIntervalSeconds).toBe(30);
    expect(config.concurrency).toBe(2);
    expect(config.timeoutMinutes).toBe(30);
    expect(config.workDir).toBe(realpathSync("/tmp/critters-work"));
    expect(config.triggerLabel).toBe("Critter");
    expect(config.maxPlanningTurns).toBe(50);
    expect(config.maxExecutionTurns).toBe(75);
    expect(config.tmuxSession).toBe("critters");
    expect(config.noTmux).toBe(false);
    expect(config.repos).toEqual({});
    expect(config.teamRepos).toEqual({});
    expect(config.reviewTriggerLabel).toBe("Critter Review");
    expect(config.reviewModel).toBe("opus");
    expect(config.reviewConcurrency).toBe(2);
    expect(config.reviewTimeoutMinutes).toBe(15);
    expect(config.maxReviewTurns).toBe(30);
    expect(config.maxLogSizeMb).toBe(10);
    expect(config.healthPort).toBe(3847);
  });

  test("throws when config file does not exist", () => {
    expect(() => loadConfig(`${tempDir}/nonexistent.yaml`)).toThrow();
  });

  describe("CWD fallback resolution", () => {
    let origCwd: string;

    beforeEach(() => {
      origCwd = process.cwd();
    });

    afterEach(() => {
      process.chdir(origCwd);
    });

    test("resolves config from CWD when no explicit path given", () => {
      writeFileSync(
        `${tempDir}/critters.config.yaml`,
        `defaultAllowedTools:\n  - "Read"\ntriggerLabel: "FromCWD"\n`,
        "utf-8",
      );
      process.chdir(tempDir);
      const config = loadConfig();
      expect(config.triggerLabel).toBe("FromCWD");
    });
  });

  describe("repos map", () => {
    test("parses repos with url and extraAllowedTools", () => {
      const yaml = `
defaultAllowedTools:
  - "Read"
repos:
  "proj-1":
    url: "git@github.com:org/repo-a.git"
    extraAllowedTools:
      - "Bash(python:*)"
      - "Bash(pip:*)"
  "proj-2":
    url: "https://github.com/org/repo-b.git"
`;
      const config = loadConfig(writeYaml(yaml));

      expect(config.repos["proj-1"].url).toBe("git@github.com:org/repo-a.git");
      expect(config.repos["proj-1"].extraAllowedTools).toEqual([
        "Bash(python:*)",
        "Bash(pip:*)",
      ]);
      expect(config.repos["proj-2"].url).toBe("https://github.com/org/repo-b.git");
      expect(config.repos["proj-2"].extraAllowedTools).toEqual([]);
    });
  });

  describe("teamRepos map", () => {
    test("parses teamRepos entries", () => {
      const yaml = `
defaultAllowedTools:
  - "Read"
teamRepos:
  "team-1": "git@github.com:org/default-repo.git"
  "team-2": "https://github.com/org/other-repo.git"
`;
      const config = loadConfig(writeYaml(yaml));

      expect(config.teamRepos["team-1"]).toBe("git@github.com:org/default-repo.git");
      expect(config.teamRepos["team-2"]).toBe("https://github.com/org/other-repo.git");
      expect(Object.keys(config.teamRepos)).toHaveLength(2);
    });
  });

  describe("review config", () => {
    test("reads review config from YAML", () => {
      const yaml = `
defaultAllowedTools:
  - "Read"
reviewTriggerLabel: "Review Me"
reviewModel: sonnet
reviewConcurrency: 3
reviewTimeoutMinutes: 20
maxReviewTurns: 40
`;
      const config = loadConfig(writeYaml(yaml));
      expect(config.reviewTriggerLabel).toBe("Review Me");
      expect(config.reviewModel).toBe("sonnet");
      expect(config.reviewConcurrency).toBe(3);
      expect(config.reviewTimeoutMinutes).toBe(20);
      expect(config.maxReviewTurns).toBe(40);
    });

    test("throws when reviewConcurrency < 1", () => {
      const yaml = `defaultAllowedTools:\n  - "Read"\nreviewConcurrency: 0\n`;
      expect(() => loadConfig(writeYaml(yaml))).toThrow("reviewConcurrency must be >= 1");
    });

    test("throws when reviewTimeoutMinutes <= 0", () => {
      const yaml = `defaultAllowedTools:\n  - "Read"\nreviewTimeoutMinutes: 0\n`;
      expect(() => loadConfig(writeYaml(yaml))).toThrow("reviewTimeoutMinutes must be > 0");
    });

    test("throws when maxReviewTurns <= 0", () => {
      const yaml = `defaultAllowedTools:\n  - "Read"\nmaxReviewTurns: 0\n`;
      expect(() => loadConfig(writeYaml(yaml))).toThrow("maxReviewTurns must be > 0");
    });

    test("throws when maxLogSizeMb <= 0", () => {
      const yaml = `defaultAllowedTools:\n  - "Read"\nmaxLogSizeMb: 0\n`;
      expect(() => loadConfig(writeYaml(yaml))).toThrow("maxLogSizeMb must be > 0");
    });
  });

  describe("healthPort config", () => {
    test("defaults to 3847", () => {
      const yaml = `defaultAllowedTools:\n  - "Read"\n`;
      const config = loadConfig(writeYaml(yaml));
      expect(config.healthPort).toBe(3847);
    });

    test("reads healthPort from YAML", () => {
      const yaml = `defaultAllowedTools:\n  - "Read"\nhealthPort: 8080\n`;
      const config = loadConfig(writeYaml(yaml));
      expect(config.healthPort).toBe(8080);
    });

    test("allows 0 to disable", () => {
      const yaml = `defaultAllowedTools:\n  - "Read"\nhealthPort: 0\n`;
      const config = loadConfig(writeYaml(yaml));
      expect(config.healthPort).toBe(0);
    });

    test("throws when healthPort < 1024 (non-zero)", () => {
      const yaml = `defaultAllowedTools:\n  - "Read"\nhealthPort: 80\n`;
      expect(() => loadConfig(writeYaml(yaml))).toThrow("healthPort must be 0 (disabled) or 1024-65535");
    });

    test("throws when healthPort > 65535", () => {
      const yaml = `defaultAllowedTools:\n  - "Read"\nhealthPort: 70000\n`;
      expect(() => loadConfig(writeYaml(yaml))).toThrow("healthPort must be 0 (disabled) or 1024-65535");
    });
  });

  describe("environment variable handling", () => {
    test("reads LINEAR_API_KEY from environment", () => {
      process.env.LINEAR_API_KEY = "my-linear-key";
      const yaml = `defaultAllowedTools:\n  - "Read"\n`;
      const config = loadConfig(writeYaml(yaml));
      expect(config.linearApiKey).toBe("my-linear-key");
    });

    test("throws when LINEAR_API_KEY is not set and provider is linear", () => {
      delete process.env.LINEAR_API_KEY;
      const yaml = `defaultAllowedTools:\n  - "Read"\n`;
      expect(() => loadConfig(writeYaml(yaml))).toThrow("LINEAR_API_KEY not set");
    });

    test("reads SLACK_WEBHOOK_URL from environment", () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/webhook";
      const yaml = `defaultAllowedTools:\n  - "Read"\n`;
      const config = loadConfig(writeYaml(yaml));
      expect(config.slackWebhookUrl).toBe("https://hooks.slack.com/webhook");
    });

    test("slackWebhookUrl is undefined when SLACK_WEBHOOK_URL is not set", () => {
      delete process.env.SLACK_WEBHOOK_URL;
      const yaml = `defaultAllowedTools:\n  - "Read"\n`;
      const config = loadConfig(writeYaml(yaml));
      expect(config.slackWebhookUrl).toBeUndefined();
    });
  });

  describe("Jira provider config", () => {
    test("reads Jira env vars", () => {
      process.env.JIRA_HOST = "mycompany.atlassian.net";
      process.env.JIRA_EMAIL = "user@example.com";
      process.env.JIRA_API_TOKEN = "jira-token";
      const yaml = `
provider: jira
defaultAllowedTools:
  - "Read"
jiraStatusMap:
  "In Progress": "Working"
`;
      // Remove LINEAR_API_KEY since we're testing Jira-only
      delete process.env.LINEAR_API_KEY;
      const config = loadConfig(writeYaml(yaml));

      expect(config.provider).toBe("jira");
      expect(config.jiraHost).toBe("mycompany.atlassian.net");
      expect(config.jiraEmail).toBe("user@example.com");
      expect(config.jiraApiToken).toBe("jira-token");
      expect(config.jiraStatusMap).toEqual({ "In Progress": "Working" });

      // Restore
      delete process.env.JIRA_HOST;
      delete process.env.JIRA_EMAIL;
      delete process.env.JIRA_API_TOKEN;
      process.env.LINEAR_API_KEY = "test-key";
    });

    test("throws when Jira env vars missing for jira provider", () => {
      delete process.env.LINEAR_API_KEY;
      const yaml = `provider: jira\ndefaultAllowedTools:\n  - "Read"\n`;
      expect(() => loadConfig(writeYaml(yaml))).toThrow("JIRA_HOST");

      // Restore
      process.env.LINEAR_API_KEY = "test-key";
    });

    test("does not require LINEAR_API_KEY when only jira types configured", () => {
      delete process.env.LINEAR_API_KEY;
      process.env.JIRA_HOST = "mycompany.atlassian.net";
      process.env.JIRA_EMAIL = "user@example.com";
      process.env.JIRA_API_TOKEN = "jira-token";
      const yaml = `
provider: jira
defaultAllowedTools:
  - "Read"
`;
      const config = loadConfig(writeYaml(yaml));
      expect(config.provider).toBe("jira");
      expect(config.linearApiKey).toBeUndefined();

      // Restore
      delete process.env.JIRA_HOST;
      delete process.env.JIRA_EMAIL;
      delete process.env.JIRA_API_TOKEN;
      process.env.LINEAR_API_KEY = "test-key";
    });
  });
});
