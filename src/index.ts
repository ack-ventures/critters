#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { startHealthServer } from "./health.js";
import { runInit } from "./init.js";
import { ensureCritterFailedStatus, ensureHumanReviewStatus, ensureLabel, initLinear, loadTeamStatuses } from "./linear.js";
import { initFileLogging, log, logError } from "./logger.js";
import { initMetrics } from "./metrics.js";
import { checkPrerequisites } from "./prerequisites.js";
import { ReviewSpawner } from "./review-spawner.js";
import { ReviewWatcher } from "./review-watcher.js";
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
    // Pass caller's PATH through so the re-launched binary inside tmux can
    // find tools like git, gh, claude even if the tmux server has a minimal PATH.
    const cmd = `env PATH=${esc(process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin")} ${[process.execPath, ...args].map(esc).join(" ")}`;
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
  initMetrics();

  // Init Linear client
  initLinear(config);
  log("Connected to Linear");

  // Auto-create labels
  await ensureLabel(config.triggerLabel);
  await ensureLabel(config.reviewTriggerLabel);

  // Load team statuses + ensure required workflow states exist
  let teamStatuses = await loadTeamStatuses();
  teamStatuses = await ensureCritterFailedStatus(teamStatuses);
  teamStatuses = await ensureHumanReviewStatus(teamStatuses);

  // Create spawner + cleanup stale work dirs
  const spawner = new Spawner(config, teamStatuses);
  spawner.cleanupStale();
  spawner.startPeriodicCleanup();
  log("Cleaned up stale work directories");

  // Create review spawner
  const reviewSpawner = new ReviewSpawner(config, teamStatuses);

  // Start health server
  let healthServer: { stop: () => void } | null = null;
  let lastPollAt: string | null = null;
  if (config.healthPort !== 0) {
    const metricsPath = join(homedir(), ".critters", "metrics.jsonl");
    healthServer = startHealthServer(config.healthPort, () => ({
      activeCritters: spawner.getActiveCount(),
      queuedCritters: spawner.getQueueSize(),
      activeReviews: reviewSpawner.getActiveCount(),
      queuedReviews: reviewSpawner.getQueueSize(),
      lastPollAt,
    }), metricsPath);
  }

  const updatePollTime = () => { lastPollAt = new Date().toISOString(); };

  // Create watchers
  const watcher = new Watcher(config, spawner, updatePollTime);
  const reviewWatcher = new ReviewWatcher(config, reviewSpawner, updatePollTime);

  log(`Review config: concurrency=${config.reviewConcurrency}, timeout=${config.reviewTimeoutMinutes}min, model=${config.reviewModel}`);

  // Signal handlers
  const shutdown = () => {
    log("Shutting down...");
    healthServer?.stop();
    watcher.stop();
    reviewWatcher.stop();
    // Give running tasks a moment to clean up
    setTimeout(() => {
      log("Exiting");
      process.exit(0);
    }, 6000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start watching (both run concurrently)
  await Promise.all([watcher.start(), reviewWatcher.start()]);
}

main().catch((err) => {
  logError(`Fatal: ${err}`);
  process.exit(1);
});
