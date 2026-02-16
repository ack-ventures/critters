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
