#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { loadConfig } from "./config.js";
import { runInit } from "./init.js";
import { ensureCritterFailedStatus, ensureLabel, initLinear, loadTeamStatuses } from "./linear.js";
import { initFileLogging, log, logError } from "./logger.js";
import { checkPrerequisites } from "./prerequisites.js";
import { Spawner } from "./spawner.js";
import { checkForUpdate } from "./updater.js";
import { runCommand } from "./utils.js";
import { VERSION } from "./version.js";
import { Watcher } from "./watcher.js";

// ── Subcommand routing ──────────────────────────────────────────────────────

const subcommand = Bun.argv[2];

if (subcommand === "version") {
  console.log(`Critters v${VERSION}`);
  process.exit(0);
}

if (subcommand === "help") {
  console.log(`Critters v${VERSION}

Usage: critters [command] [flags]

Commands:
  (none)      Start the daemon
  version     Show version
  update      Check for and apply updates
  init        Interactive config setup (~/.critters/)
  help        Show this help

Flags:
  --no-tmux       Run without tmux (log to file instead)
  --skip-update   Skip auto-update check on startup
  --config PATH   Use a custom config file`);
  process.exit(0);
}

if (subcommand === "update") {
  await checkForUpdate(VERSION, { force: true });
  process.exit(0);
}

if (subcommand === "init") {
  await runInit();
  process.exit(0);
}

if (subcommand && !subcommand.startsWith("--")) {
  console.error(`Unknown command: ${subcommand}\nRun 'critters help' for usage.`);
  process.exit(1);
}

// ── Daemon ──────────────────────────────────────────────────────────────────

async function main() {
  const noTmux = Bun.argv.includes("--no-tmux");
  const skipUpdate = Bun.argv.includes("--skip-update");

  // Auto-launch inside tmux if not already there
  if (!noTmux && !process.env.TMUX) {
    const esc = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
    const args = process.argv.slice(1).filter((a) => !a.startsWith("/$bunfs/"));
    const cmd = [process.execPath, ...args].map(esc).join(" ");
    const session = "critters";

    const result = spawnSync("tmux", ["new-session", "-A", "-s", session, cmd], { stdio: "inherit" });
    process.exit(result.status ?? 0);
  }

  // ── Normal init ─────────────────────────────────────────────────────────
  if (noTmux) {
    process.on("SIGHUP", () => {});
    process.on("SIGPIPE", () => {});
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

  log(`Critters v${VERSION} starting...`);

  if (!skipUpdate && VERSION !== "dev") {
    await checkForUpdate(VERSION);
  }

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
    // Enable pane titles in the tmux session
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
