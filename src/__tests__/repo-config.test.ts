import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadRepoConfig } from "../repo-config.js";
import { createTempDir } from "./helpers.js";

describe("loadRepoConfig", () => {
  test("returns null when .critters.yaml does not exist", () => {
    const { path, cleanup } = createTempDir();
    try {
      expect(loadRepoConfig(path)).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("returns null when .critters.yaml is empty", () => {
    const { path, cleanup } = createTempDir();
    try {
      writeFileSync(join(path, ".critters.yaml"), "");
      expect(loadRepoConfig(path)).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("returns null when .critters.yaml has invalid YAML", () => {
    const { path, cleanup } = createTempDir();
    try {
      writeFileSync(join(path, ".critters.yaml"), ":\n  - :\n  invalid:: yaml::: [[[");
      expect(loadRepoConfig(path)).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("returns parsed config with extraAllowedTools", () => {
    const { path, cleanup } = createTempDir();
    try {
      writeFileSync(
        join(path, ".critters.yaml"),
        'extraAllowedTools:\n  - "Bash(python:*)"\n  - "Bash(pip:*)"\n',
      );
      const config = loadRepoConfig(path);
      expect(config).not.toBeNull();
      expect(config?.extraAllowedTools).toEqual(["Bash(python:*)", "Bash(pip:*)"]);
    } finally {
      cleanup();
    }
  });

  test("returns parsed config with planningPrompt", () => {
    const { path, cleanup } = createTempDir();
    try {
      writeFileSync(
        join(path, ".critters.yaml"),
        "planningPrompt: |\n  Follow the patterns in src/utils/.\n",
      );
      const config = loadRepoConfig(path);
      expect(config).not.toBeNull();
      expect(config?.planningPrompt).toBe("Follow the patterns in src/utils/.\n");
    } finally {
      cleanup();
    }
  });

  test("returns parsed config with executionPrompt", () => {
    const { path, cleanup } = createTempDir();
    try {
      writeFileSync(
        join(path, ".critters.yaml"),
        "executionPrompt: |\n  Run npm test before committing.\n",
      );
      const config = loadRepoConfig(path);
      expect(config).not.toBeNull();
      expect(config?.executionPrompt).toBe("Run npm test before committing.\n");
    } finally {
      cleanup();
    }
  });

  test("returns parsed config with reviewPrompt", () => {
    const { path, cleanup } = createTempDir();
    try {
      writeFileSync(
        join(path, ".critters.yaml"),
        "reviewPrompt: |\n  Pay extra attention to SQL injection risks.\n",
      );
      const config = loadRepoConfig(path);
      expect(config).not.toBeNull();
      expect(config?.reviewPrompt).toBe("Pay extra attention to SQL injection risks.\n");
    } finally {
      cleanup();
    }
  });

  test("returns parsed config with all fields populated", () => {
    const { path, cleanup } = createTempDir();
    try {
      writeFileSync(
        join(path, ".critters.yaml"),
        `extraAllowedTools:
  - "Bash(python:*)"
planningPrompt: |
  Plan carefully.
executionPrompt: |
  Execute with care.
reviewPrompt: |
  Review thoroughly.
`,
      );
      const config = loadRepoConfig(path);
      expect(config).not.toBeNull();
      expect(config?.extraAllowedTools).toEqual(["Bash(python:*)"]);
      expect(config?.planningPrompt).toBe("Plan carefully.\n");
      expect(config?.executionPrompt).toBe("Execute with care.\n");
      expect(config?.reviewPrompt).toBe("Review thoroughly.\n");
    } finally {
      cleanup();
    }
  });

  test("returns config with only the fields that are present", () => {
    const { path, cleanup } = createTempDir();
    try {
      writeFileSync(
        join(path, ".critters.yaml"),
        "executionPrompt: Run tests first\n",
      );
      const config = loadRepoConfig(path);
      expect(config).not.toBeNull();
      expect(config?.executionPrompt).toBe("Run tests first");
      expect(config?.extraAllowedTools).toBeUndefined();
      expect(config?.planningPrompt).toBeUndefined();
      expect(config?.reviewPrompt).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});
