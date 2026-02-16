#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { loadConfig } from "./config.js";
import { ensureCritterFailedStatus, ensureLabel, initLinear, loadTeamStatuses } from "./linear.js";
import { initFileLogging, log, logError } from "./logger.js";
import { checkPrerequisites } from "./prerequisites.js";
import { Spawner } from "./spawner.js";
import { runCommand } from "./utils.js";
import { Watcher } from "./watcher.js";

async function main() {
  // Parse CLI flags early so file logging captures all output
  const noTmux = Bun.argv.includes("--no-tmux");
  if (noTmux) {
    initFileLogging();
  }

  // Load ~/.critters/.env as fallback if CWD .env doesn't exist
  const cwdEnv = "./.env";
  const userEnv = `${homedir()}/.critters/.env`;
  if (!existsSync(cwdEnv) && existsSync(userEnv)) {
    const envContent = readFileSync(userEnv, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }

  let version = "unknown";
  try {
    const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
    version = pkg.version;
  } catch {
    // In compiled binary, import.meta.url won't resolve to the source tree
  }
  log(`Critters v${version} starting...`);

  // Verify required CLI tools are available
  await checkPrerequisites();

  // Load config
  const configIdx = Bun.argv.indexOf("--config");
  const configPath = configIdx !== -1 && Bun.argv[configIdx + 1]
    ? Bun.argv[configIdx + 1]
    : undefined;
  const config = loadConfig(configPath);
  config.noTmux = noTmux;

  if (!noTmux) {
    // Enable pane titles in the tmux session (best-effort — may fail if not running in tmux)
    await runCommand("tmux", ["set", "-t", config.tmuxSession, "pane-border-status", "top"]).catch(() => {});
    await runCommand("tmux", ["set", "-t", config.tmuxSession, "pane-border-format", "#{pane_title}"]).catch(() => {});
  }
  log(`Config loaded: concurrency=${config.concurrency}, timeout=${config.timeoutMinutes}min, poll=${config.pollIntervalSeconds}s, noTmux=${noTmux}`);

  // Init Linear client
  initLinear(config);
  log("Connected to Linear");

  // Auto-create label
  await ensureLabel(config.triggerLabel);

  // Load team statuses + ensure "Critter Failed" exists
  let teamStatuses = await loadTeamStatuses();
  teamStatuses = await ensureCritterFailedStatus(teamStatuses);

  // Create spawner + cleanup stale work dirs
  const spawner = new Spawner(config, teamStatuses);
  spawner.cleanupStale();
  spawner.startPeriodicCleanup();
  log("Cleaned up stale work directories");

  // Create watcher
  const watcher = new Watcher(config, spawner);

  // Signal handlers
  const shutdown = () => {
    log("Shutting down...");
    watcher.stop();
    // Give running tasks a moment to clean up
    setTimeout(() => {
      log("Exiting");
      process.exit(0);
    }, 6000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start watching
  await watcher.start();
}

main().catch((err) => {
  logError(`Fatal: ${err}`);
  process.exit(1);
});
