import { type FSWatcher, watch } from "node:fs";
import { loadConfig } from "./config.js";
import { log, logError } from "./logger.js";
import type { Config } from "./types.js";

export class ConfigWatcher {
	private watcher: FSWatcher | null = null;
	private debounceTimer: Timer | null = null;
	private configPath: string;
	private onReload: (newConfig: Config) => void;

	constructor(configPath: string, onReload: (newConfig: Config) => void) {
		this.configPath = configPath;
		this.onReload = onReload;
	}

	start(): void {
		try {
			this.watcher = watch(this.configPath, () => {
				if (this.debounceTimer) {
					clearTimeout(this.debounceTimer);
				}
				this.debounceTimer = setTimeout(() => {
					this.reload();
				}, 500);
			});
			log(`Watching config file for changes: ${this.configPath}`);
		} catch (err) {
			logError(`Failed to watch config file: ${err}`);
		}
	}

	stop(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
	}

	private reload(): void {
		try {
			const newConfig = loadConfig(this.configPath);
			this.onReload(newConfig);
		} catch (err) {
			logError(`Config reload failed (keeping current config): ${err}`);
		}
	}
}

export function diffConfigs(oldConfig: Config, newConfig: Config): string {
	const changes: string[] = [];

	// Poll interval
	if (oldConfig.pollIntervalSeconds !== newConfig.pollIntervalSeconds) {
		changes.push(`poll interval ${oldConfig.pollIntervalSeconds}s → ${newConfig.pollIntervalSeconds}s`);
	}

	// Provider
	if (oldConfig.provider !== newConfig.provider) {
		changes.push(`default provider ${oldConfig.provider} → ${newConfig.provider}`);
	}

	// Critter types
	const oldTypeNames = new Set(oldConfig.critterTypes.map((ct) => ct.name));
	const newTypeNames = new Set(newConfig.critterTypes.map((ct) => ct.name));

	for (const name of newTypeNames) {
		if (!oldTypeNames.has(name)) {
			changes.push(`added type '${name}'`);
		}
	}
	for (const name of oldTypeNames) {
		if (!newTypeNames.has(name)) {
			changes.push(`removed type '${name}'`);
		}
	}

	// Per-type changes
	for (const newType of newConfig.critterTypes) {
		const oldType = oldConfig.critterTypes.find((ct) => ct.name === newType.name);
		if (!oldType) continue;

		if (oldType.concurrency !== newType.concurrency) {
			changes.push(`updated concurrency for '${newType.name}' (${oldType.concurrency} → ${newType.concurrency})`);
		}
		if (oldType.timeoutMinutes !== newType.timeoutMinutes) {
			changes.push(`updated timeout for '${newType.name}' (${oldType.timeoutMinutes}min → ${newType.timeoutMinutes}min)`);
		}
		// Model changes
		for (const [i, phase] of newType.phases.entries()) {
			const oldPhase = oldType.phases[i];
			if (oldPhase && oldPhase.model !== phase.model) {
				changes.push(`updated model for '${newType.name}.${phase.name}' (${oldPhase.model} → ${phase.model})`);
			}
		}
	}

	// Default allowed tools
	const oldTools = JSON.stringify(oldConfig.defaultAllowedTools);
	const newTools = JSON.stringify(newConfig.defaultAllowedTools);
	if (oldTools !== newTools) {
		changes.push("updated defaultAllowedTools");
	}

	// Repos
	const oldRepos = JSON.stringify(oldConfig.repos);
	const newRepos = JSON.stringify(newConfig.repos);
	if (oldRepos !== newRepos) {
		changes.push("updated repos");
	}

	// Team repos
	const oldTeamRepos = JSON.stringify(oldConfig.teamRepos);
	const newTeamRepos = JSON.stringify(newConfig.teamRepos);
	if (oldTeamRepos !== newTeamRepos) {
		changes.push("updated teamRepos");
	}

	// JSON logs
	if (oldConfig.jsonLogs !== newConfig.jsonLogs) {
		changes.push(`jsonLogs ${oldConfig.jsonLogs ?? false} → ${newConfig.jsonLogs ?? false}`);
	}

	// Hooks
	const oldHooks = JSON.stringify(oldConfig.hooks ?? {});
	const newHooks = JSON.stringify(newConfig.hooks ?? {});
	if (oldHooks !== newHooks) {
		changes.push("updated hooks");
	}

	if (changes.length === 0) {
		return "Config reloaded (no effective changes)";
	}
	return `Config reloaded: ${changes.join(", ")}`;
}
