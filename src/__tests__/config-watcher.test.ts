import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { ConfigWatcher, diffConfigs } from "../config-watcher.js";
import type { CritterTypeConfig } from "../critter-type.js";
import type { Config } from "../types.js";
import { createTempDir } from "./helpers.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
	return {
		pollIntervalSeconds: 120,
		concurrency: 2,
		timeoutMinutes: 30,
		workDir: "/tmp/critters-work",
		triggerLabel: "Critter",
		maxPlanningTurns: 50,
		maxExecutionTurns: 75,
		defaultAllowedTools: ["Read", "Write", "Edit"],
		repos: {},
		teamRepos: {},
		tmuxSession: "critters",
		branchPrefix: "critter",
		noTmux: false,
		planningModel: "opus",
		executionModel: "opus",
		reviewTriggerLabel: "Critter Review",
		reviewModel: "opus",
		reviewConcurrency: 2,
		reviewTimeoutMinutes: 15,
		maxReviewTurns: 30,
		maxLogSizeMb: 10,
		healthPort: 3847,
		metricsRetentionDays: 90,
		provider: "linear",
		critterTypes: [],
		...overrides,
	};
}

function makeType(overrides: Partial<CritterTypeConfig> = {}): CritterTypeConfig {
	return {
		name: "create",
		trigger: { label: "Critter", status: "Todo" },
		repo: { clone: true, branch: true },
		phases: [{ name: "planning", prompt: "builtin:planning", model: "opus", maxTurns: 50, tools: "readonly" }],
		outcomes: { success: { status: "In Review" }, failure: { status: "Critter Failed" } },
		concurrency: 2,
		timeoutMinutes: 30,
		...overrides,
	};
}

describe("diffConfigs", () => {
	test("reports no changes for identical configs", () => {
		const config = makeConfig({ critterTypes: [makeType()] });
		const result = diffConfigs(config, config);
		expect(result).toBe("Config reloaded (no effective changes)");
	});

	test("reports poll interval change", () => {
		const oldConfig = makeConfig({ pollIntervalSeconds: 120 });
		const newConfig = makeConfig({ pollIntervalSeconds: 60 });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("poll interval 120s → 60s");
	});

	test("reports added critter type", () => {
		const oldConfig = makeConfig({ critterTypes: [makeType()] });
		const newConfig = makeConfig({
			critterTypes: [makeType(), makeType({ name: "audit" })],
		});
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("added type 'audit'");
	});

	test("reports removed critter type", () => {
		const oldConfig = makeConfig({
			critterTypes: [makeType(), makeType({ name: "audit" })],
		});
		const newConfig = makeConfig({ critterTypes: [makeType()] });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("removed type 'audit'");
	});

	test("reports concurrency change for a type", () => {
		const oldConfig = makeConfig({ critterTypes: [makeType({ concurrency: 2 })] });
		const newConfig = makeConfig({ critterTypes: [makeType({ concurrency: 5 })] });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("updated concurrency for 'create' (2 → 5)");
	});

	test("reports timeout change for a type", () => {
		const oldConfig = makeConfig({ critterTypes: [makeType({ timeoutMinutes: 30 })] });
		const newConfig = makeConfig({ critterTypes: [makeType({ timeoutMinutes: 60 })] });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("updated timeout for 'create' (30min → 60min)");
	});

	test("reports model change for a phase", () => {
		const oldType = makeType({ phases: [{ name: "planning", prompt: "builtin:planning", model: "opus", maxTurns: 50, tools: "readonly" }] });
		const newType = makeType({ phases: [{ name: "planning", prompt: "builtin:planning", model: "sonnet", maxTurns: 50, tools: "readonly" }] });
		const result = diffConfigs(makeConfig({ critterTypes: [oldType] }), makeConfig({ critterTypes: [newType] }));
		expect(result).toContain("updated model for 'create.planning' (opus → sonnet)");
	});

	test("reports provider change", () => {
		const oldConfig = makeConfig({ provider: "linear" });
		const newConfig = makeConfig({ provider: "jira" });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("default provider linear → jira");
	});

	test("reports defaultAllowedTools change", () => {
		const oldConfig = makeConfig({ defaultAllowedTools: ["Read"] });
		const newConfig = makeConfig({ defaultAllowedTools: ["Read", "Write"] });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("updated defaultAllowedTools");
	});

	test("reports repos change", () => {
		const oldConfig = makeConfig({ repos: {} });
		const newConfig = makeConfig({ repos: { proj1: { url: "git@github.com:org/repo.git" } } });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("updated repos");
	});

	test("reports hooks change", () => {
		const oldConfig = makeConfig({ hooks: undefined });
		const newConfig = makeConfig({ hooks: { onTaskStarted: "echo hello" } });
		const result = diffConfigs(oldConfig, newConfig);
		expect(result).toContain("updated hooks");
	});

	test("reports multiple changes together", () => {
		const oldConfig = makeConfig({
			pollIntervalSeconds: 120,
			critterTypes: [makeType({ concurrency: 2 })],
		});
		const newConfig = makeConfig({
			pollIntervalSeconds: 60,
			critterTypes: [makeType({ concurrency: 5 })],
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
