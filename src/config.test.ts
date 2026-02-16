import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "./config.js";

const tmpDir = "/tmp/critters-config-test";

function writeYaml(filename: string, content: string): string {
  const path = `${tmpDir}/${filename}`;
  writeFileSync(path, content, "utf-8");
  return path;
}

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true });
  // loadConfig reads LINEAR_API_KEY from env
  process.env.LINEAR_API_KEY = "test-key";
});

describe("validateWorkDir", () => {
  test("rejects root directory", () => {
    const path = writeYaml("root.yaml", "workDir: /\n");
    expect(() => loadConfig(path)).toThrow("must not be the root directory");
  });

  test("rejects root with trailing slashes", () => {
    const path = writeYaml("root-slash.yaml", "workDir: ///\n");
    expect(() => loadConfig(path)).toThrow("must not be the root directory");
  });

  test("rejects /Users/andrew (home directory)", () => {
    const path = writeYaml("home.yaml", "workDir: /Users/andrew\n");
    expect(() => loadConfig(path)).toThrow("must not be a home directory");
  });

  test("rejects /home/deploy (home directory)", () => {
    const path = writeYaml("home-linux.yaml", "workDir: /home/deploy\n");
    expect(() => loadConfig(path)).toThrow("must not be a home directory");
  });

  test("rejects /Users (home parent)", () => {
    const path = writeYaml("users.yaml", "workDir: /Users\n");
    expect(() => loadConfig(path)).toThrow("must not be a home directory");
  });

  test("rejects /etc/critters (system dir even with critters in name)", () => {
    const path = writeYaml("etc.yaml", "workDir: /etc/critters\n");
    expect(() => loadConfig(path)).toThrow("must not be inside system directory /etc");
  });

  test("rejects /var/lib/something", () => {
    const path = writeYaml("var.yaml", "workDir: /var/lib/something\n");
    expect(() => loadConfig(path)).toThrow("must not be inside system directory /var");
  });

  test("rejects /opt/something", () => {
    const path = writeYaml("opt.yaml", "workDir: /opt/something\n");
    expect(() => loadConfig(path)).toThrow("must not be inside system directory /opt");
  });

  test("rejects /usr/local/bin", () => {
    const path = writeYaml("usr.yaml", "workDir: /usr/local/bin\n");
    expect(() => loadConfig(path)).toThrow("must not be inside system directory /usr");
  });

  test("rejects path not under /tmp and without critters", () => {
    const path = writeYaml("random.yaml", "workDir: /data/my-workspace\n");
    expect(() => loadConfig(path)).toThrow(
      'must be under /tmp/ or contain "critters" in the path',
    );
  });

  test("accepts /tmp/critters-work", () => {
    const path = writeYaml("tmp.yaml", "workDir: /tmp/critters-work\n");
    const config = loadConfig(path);
    expect(config.workDir).toBe("/tmp/critters-work");
  });

  test("accepts /private/tmp/critters-work (macOS)", () => {
    const path = writeYaml("private-tmp.yaml", "workDir: /private/tmp/critters-work\n");
    const config = loadConfig(path);
    expect(config.workDir).toBe("/private/tmp/critters-work");
  });

  test("accepts /data/critters-workspace (contains critters)", () => {
    const path = writeYaml("critters-path.yaml", "workDir: /data/critters-workspace\n");
    const config = loadConfig(path);
    expect(config.workDir).toBe("/data/critters-workspace");
  });

  test("default workDir (/tmp/critters-work) passes validation", () => {
    const path = writeYaml("default.yaml", "concurrency: 2\n");
    const config = loadConfig(path);
    expect(config.workDir).toBe("/tmp/critters-work");
  });
});

describe("validateRepoUrls", () => {
  test("valid SSH URL accepted in repos", () => {
    const path = writeYaml(
      "repo-ssh.yaml",
      `repos:\n  "proj-1":\n    url: "git@github.com:org/repo.git"\n`,
    );
    const config = loadConfig(path);
    expect(config.repos["proj-1"].url).toBe("git@github.com:org/repo.git");
  });

  test("valid HTTPS URL accepted in repos", () => {
    const path = writeYaml(
      "repo-https.yaml",
      `repos:\n  "proj-2":\n    url: "https://github.com/org/repo.git"\n`,
    );
    const config = loadConfig(path);
    expect(config.repos["proj-2"].url).toBe("https://github.com/org/repo.git");
  });

  test("invalid URL rejected (missing .git suffix)", () => {
    const path = writeYaml(
      "repo-no-git.yaml",
      `repos:\n  "proj-3":\n    url: "git@github.com:org/repo"\n`,
    );
    expect(() => loadConfig(path)).toThrow("Invalid git URL for repo");
  });

  test("invalid URL rejected (plain HTTP without .git)", () => {
    const path = writeYaml(
      "repo-http.yaml",
      `repos:\n  "proj-4":\n    url: "http://example.com/repo"\n`,
    );
    expect(() => loadConfig(path)).toThrow("Invalid git URL for repo");
  });

  test("invalid URL rejected (random string)", () => {
    const path = writeYaml(
      "repo-random.yaml",
      `repos:\n  "proj-5":\n    url: "not-a-url"\n`,
    );
    expect(() => loadConfig(path)).toThrow("Invalid git URL for repo");
  });

  test("teamRepos valid SSH URL accepted", () => {
    const path = writeYaml(
      "team-ssh.yaml",
      `teamRepos:\n  "team-1": "git@github.com:org/repo.git"\n`,
    );
    const config = loadConfig(path);
    expect(config.teamRepos["team-1"]).toBe("git@github.com:org/repo.git");
  });

  test("teamRepos invalid URL rejected", () => {
    const path = writeYaml(
      "team-invalid.yaml",
      `teamRepos:\n  "team-2": "not-a-url"\n`,
    );
    expect(() => loadConfig(path)).toThrow("Invalid git URL for teamRepo");
  });

  test("empty repos and teamRepos passes validation", () => {
    const path = writeYaml("repo-empty.yaml", "concurrency: 2\n");
    const config = loadConfig(path);
    expect(Object.keys(config.repos)).toHaveLength(0);
    expect(Object.keys(config.teamRepos)).toHaveLength(0);
  });
});
