import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { ConfigWatcher, diffConfigs } from "../config-watcher.js";
import type { CritterTypeConfig } from "../critter-type.js";
import type { Config } from "../types.js";
import { createTempDir, makeTestConfig, makeTestCritterType } from "./helpers.js";

describe("diffConfigs", () => {
	test("reports no changes for identical configs", () => {
		const config = makeTestConfig({ critterTypes: [makeTestCritterType()] });
		const result = diffConfigs(config, config);
		expect(result).toBe("Config reloaded (no effective changes)");
	});

	test("reports poll interval change", () => {
		const oldConfig = makeTestConfig({ pollIntervalSeconds: 120 });
		const newConfig = makeTestConfig({ pollIntervalSeconds: 60 });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("poll interval 120s → 60s");
	});

	test("reports added critter type", () => {
		const oldConfig = makeTestConfig({ critterTypes: [makeTestCritterType()] });
		const newConfig = makeTestConfig({
			critterTypes: [makeTestCritterType(), makeTestCritterType({ name: "audit" })],
		});
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("added type 'audit'");
	});

	test("reports removed critter type", () => {
		const oldConfig = makeTestConfig({
			critterTypes: [makeTestCritterType(), makeTestCritterType({ name: "audit" })],
		});
		const newConfig = makeTestConfig({ critterTypes: [makeTestCritterType()] });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("removed type 'audit'");
	});

	test("reports concurrency change for a type", () => {
		const oldConfig = makeTestConfig({ critterTypes: [makeTestCritterType({ concurrency: 2 })] });
		const newConfig = makeTestConfig({ critterTypes: [makeTestCritterType({ concurrency: 5 })] });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("updated concurrency for 'create' (2 → 5)");
	});

	test("reports timeout change for a type", () => {
		const oldConfig = makeTestConfig({ critterTypes: [makeTestCritterType({ timeoutMinutes: 30 })] });
		const newConfig = makeTestConfig({ critterTypes: [makeTestCritterType({ timeoutMinutes: 60 })] });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("updated timeout for 'create' (30min → 60min)");
	});

	test("reports model change for a phase", () => {
		const oldType = makeTestCritterType({ phases: [{ name: "planning", prompt: "builtin:planning", model: "opus", maxTurns: 50, tools: "readonly" }] });
		const newType = makeTestCritterType({ phases: [{ name: "planning", prompt: "builtin:planning", model: "sonnet", maxTurns: 50, tools: "readonly" }] });
		const result = diffConfigs(makeTestConfig({ critterTypes: [oldType] }), makeTestConfig({ critterTypes: [newType] }));
		expect(result).toContain("updated model for 'create.planning' (opus → sonnet)");
	});

	test("reports provider change", () => {
		const oldConfig = makeTestConfig({ provider: "linear" });
		const newConfig = makeTestConfig({ provider: "jira" });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("default provider linear → jira");
	});

	test("reports defaultAllowedTools change", () => {
		const oldConfig = makeTestConfig({ defaultAllowedTools: ["Read"] });
		const newConfig = makeTestConfig({ defaultAllowedTools: ["Read", "Write"] });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("updated defaultAllowedTools");
	});

	test("reports repos change", () => {
		const oldConfig = makeTestConfig({ repos: {} });
		const newConfig = makeTestConfig({ repos: { proj1: { url: "git@github.com:org/repo.git" } } });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("updated repos");
	});

	test("reports jsonLogs change", () => {
		const oldConfig = makeTestConfig({ jsonLogs: undefined });
		const newConfig = makeTestConfig({ jsonLogs: true });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("jsonLogs");
	});

	test("reports hooks change", () => {
		const oldConfig = makeTestConfig({ hooks: undefined });
		const newConfig = makeTestConfig({ hooks: { onTaskStarted: "echo hello" } });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("updated hooks");
	});

	test("reports multiple changes together", () => {
		const oldConfig = makeTestConfig({
			pollIntervalSeconds: 120,
			critterTypes: [makeTestCritterType({ concurrency: 2 })],
		});
		const newConfig = makeTestConfig({
			pollIntervalSeconds: 60,
			critterTypes: [makeTestCritterType({ concurrency: 5 })],
		});
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("poll interval 120s → 60s");
		expect(result).toContain("updated concurrency for 'create' (2 → 5)");
	});
});

describe("ConfigWatcher", () => {
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

	test("calls onReload when config file changes", async () => {
		// Write a valid config file
		const configPath = `${tempDir}/config.yaml`;
		const yaml = `
pollIntervalSeconds: 120
concurrency: 2
timeoutMinutes: 30
workDir: /tmp/critters-watcher-test
defaultAllowedTools:
  - "Read"
  - "Write"
`;
		writeFileSync(configPath, yaml, "utf-8");

		// Save and set required env var
		const savedKey = process.env.LINEAR_API_KEY;
		process.env.LINEAR_API_KEY = "test-key";

		const reloadedConfigs: Config[] = [];
		const watcher = new ConfigWatcher(configPath, (config) => {
			reloadedConfigs.push(config);
		});
		watcher.start();

		// Modify the config file
		const newYaml = yaml.replace("concurrency: 2", "concurrency: 4");
		writeFileSync(configPath, newYaml, "utf-8");

		// Wait for debounce (500ms) + buffer
		await new Promise((r) => setTimeout(r, 800));

		watcher.stop();

		// Restore env
		if (savedKey !== undefined) {
			process.env.LINEAR_API_KEY = savedKey;
		} else {
			delete process.env.LINEAR_API_KEY;
		}

		expect(reloadedConfigs.length).toBeGreaterThan(0);
		expect(reloadedConfigs[0].concurrency).toBe(4);
	});

	test("does not call onReload for invalid config", async () => {
		const configPath = `${tempDir}/config.yaml`;
		const yaml = `
pollIntervalSeconds: 120
concurrency: 2
timeoutMinutes: 30
workDir: /tmp/critters-watcher-test
defaultAllowedTools:
  - "Read"
  - "Write"
`;
		writeFileSync(configPath, yaml, "utf-8");

		const savedKey = process.env.LINEAR_API_KEY;
		process.env.LINEAR_API_KEY = "test-key";

		let reloadCount = 0;
		const watcher = new ConfigWatcher(configPath, () => {
			reloadCount++;
		});
		watcher.start();

		// Write invalid config (pollIntervalSeconds < 5 triggers validation error)
		const invalidYaml = yaml.replace("pollIntervalSeconds: 120", "pollIntervalSeconds: 1");
		writeFileSync(configPath, invalidYaml, "utf-8");

		await new Promise((r) => setTimeout(r, 800));

		watcher.stop();

		if (savedKey !== undefined) {
			process.env.LINEAR_API_KEY = savedKey;
		} else {
			delete process.env.LINEAR_API_KEY;
		}

		expect(reloadCount).toBe(0);
	});

	test("stop() cleans up watcher", () => {
		const configPath = `${tempDir}/config.yaml`;
		writeFileSync(configPath, "concurrency: 2", "utf-8");

		const watcher = new ConfigWatcher(configPath, () => {});
		watcher.start();
		watcher.stop();
		// Should not throw when stopped twice
		watcher.stop();
	});
});
