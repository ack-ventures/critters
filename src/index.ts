#!/usr/bin/env bun

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

  const { version } = await Bun.file(new URL("../package.json", import.meta.url)).json();
  log(`Critters v${version} starting...`);

  // Verify required CLI tools are available
  await checkPrerequisites();

  // Load config
  const config = loadConfig();
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
