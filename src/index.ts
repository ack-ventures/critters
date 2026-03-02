#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { startHealthServer } from "./health.js";
import { runInit } from "./init.js";
import { runInitRepo } from "./init-repo.js";
import { initLinear } from "./linear.js";
import { initFileLogging, log, logError } from "./logger.js";
import { initMetrics } from "./metrics.js";
import { checkPrerequisites } from "./prerequisites.js";
import { runStatus } from "./status.js";
import { createTracker } from "./tracker/index.js";
import { UnifiedSpawner } from "./unified-spawner.js";
import { UnifiedWatcher } from "./unified-watcher.js";
import { checkForUpdate, fetchLatestVersion, getDisplayVersion } from "./updater.js";
import { formatDuration, runCommand, shellEscape } from "./utils.js";
import { VERSION } from "./version.js";

// ── Subcommand routing ──────────────────────────────────────────────────────

const subcommand = Bun.argv[2];

if (subcommand === "version") {
  await fetchLatestVersion();
  console.log(`Critters ${getDisplayVersion()}`);
  process.exit(0);
}

if (subcommand === "help") {
  await fetchLatestVersion();
  console.log(`Critters ${getDisplayVersion()}

Usage: critters [command] [flags]

Commands:
  (none)      Start the daemon
  retry       Retry a failed critter (reset to Todo)
  kickoff     Trigger an immediate poll cycle
  status      Show daemon status
  version     Show version
  update      Check for and apply updates
  init        Interactive config setup (~/.critters/)
  logs        Show logs for a critter run
  init-repo   Scaffold .critters.yaml in current repo
  help        Show this help

Flags:
  --dry-run       Poll once, show what would happen, and exit
  --no-tmux       Run without tmux (log to file instead)
  --skip-update   Skip auto-update check on startup
  --config PATH   Use a custom config file

Logs flags:
  --phase planning|execution|review  Show specific phase (default: most recent)
  --follow, -f                       Tail mode (stream new output)`);
  process.exit(0);
}

if (subcommand === "update") {
  await checkForUpdate(VERSION, { force: true });
  process.exit(0);
}

if (subcommand === "status") {
  await runStatus();
  process.exit(0);
}

if (subcommand === "init") {
  await runInit();
  process.exit(0);
}

if (subcommand === "logs") {
  const { runLogs } = await import("./logs.js");
  await runLogs(Bun.argv.slice(3));
  process.exit(0);
}

if (subcommand === "retry") {
  const identifier = Bun.argv[3];
  if (!identifier) {
    console.error("Usage: critters retry <issue-identifier> [--force]\n\nExample: critters retry ACK-101");
    process.exit(1);
  }
  const force = Bun.argv.includes("--force");
  const { runRetry } = await import("./cli-retry.js");
  await runRetry(identifier, force);
  process.exit(0);
}

if (subcommand === "init-repo") {
  await runInitRepo();
  process.exit(0);
}

if (subcommand === "kickoff") {
  const { runKickoff } = await import("./cli-kickoff.js");
  await runKickoff();
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
  const dryRun = Bun.argv.includes("--dry-run");

  // Auto-launch inside tmux if not already there
  if (!noTmux && !dryRun && !process.env.TMUX) {
    const args = process.argv.slice(1).filter((a) => !a.startsWith("/$bunfs/"));
    // Pass caller's PATH through so the re-launched binary inside tmux can
    // find tools like git, gh, claude even if the tmux server has a minimal PATH.
    const cmd = `env PATH=${shellEscape(process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin")} ${[process.execPath, ...args].map(shellEscape).join(" ")}`;
    const session = "critters";

    const result = spawnSync("tmux", ["new-session", "-A", "-s", session, cmd], { stdio: "inherit" });
    process.exit(result.status ?? 0);
  }

  // ── Normal init ─────────────────────────────────────────────────────────
  if (noTmux) {
    process.on("SIGHUP", () => {});
    process.on("SIGPIPE", () => {});
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

  // Load config (needed for both normal and dry-run modes)
  const configIdx = Bun.argv.indexOf("--config");
  const configPath = configIdx !== -1 && Bun.argv[configIdx + 1]
    ? Bun.argv[configIdx + 1]
    : undefined;
  const config = loadConfig(configPath);
  config.noTmux = noTmux || dryRun;

  // Fetch latest version for dev builds (non-blocking, cached for session)
  if (VERSION === "dev") {
    await fetchLatestVersion();
  }

  // Create issue tracker
  const tracker = createTracker({
    type: config.provider,
    apiKey: config.linearApiKey,
  });

  // Also init the legacy Linear module for backward compat (used by retry, etc.)
  initLinear(config);

  if (dryRun) {
    log(`Critters ${getDisplayVersion()} — dry run`);
    await tracker.init();

    const watcher = new UnifiedWatcher(config, tracker, null);
    const summary = await watcher.dryRunPoll();

    log("");
    log(`Dry run complete: ${summary.total} issues found, ${summary.wouldPickUp} would be picked up, ${summary.blocked} blocked, ${summary.skipped} skipped (no repo)`);
    process.exit(0);
  }

  log(`Critters ${getDisplayVersion()} starting...`);
  const startTime = Date.now();

  if (!noTmux) {
    console.log(`\x1b[1;36m━━━ Critters ${getDisplayVersion()} ━━━\x1b[0m`);
  }

  if (!skipUpdate && VERSION !== "dev") {
    await checkForUpdate(VERSION);
  }

  // Verify required CLI tools are available
  await checkPrerequisites();

  if (noTmux) {
    initFileLogging(config.maxLogSizeMb);
  }


  // Capture main pane ID so periodic title updates only affect this pane
  let mainPaneId: string | undefined;

  if (!noTmux) {
    const mainPaneResult = await runCommand("tmux", ["display-message", "-t", config.tmuxSession, "-p", "#{pane_id}"]);
    mainPaneId = mainPaneResult.stdout.trim();

    // Set main pane title (using captured pane ID)
    await runCommand("tmux", ["select-pane", "-t", mainPaneId, "-T", `Critters ${getDisplayVersion()}`]).catch(() => {});
    // Configure pane border styling (session-level settings, not pane-level)
    await runCommand("tmux", ["set", "-t", config.tmuxSession, "pane-border-status", "top"]).catch(() => {});
    await runCommand("tmux", ["set", "-t", config.tmuxSession, "pane-border-format", " #{pane_title} "]).catch(() => {});
    await runCommand("tmux", ["set", "-t", config.tmuxSession, "pane-border-style", "fg=colour240"]).catch(() => {});
    await runCommand("tmux", ["set", "-t", config.tmuxSession, "pane-active-border-style", "fg=colour39"]).catch(() => {});
  }

  // Log critter types
  const typesSummary = config.critterTypes.map((ct) => `${ct.name}(${ct.concurrency})`).join(", ");
  log(`Config loaded: types=[${typesSummary}], poll=${config.pollIntervalSeconds}s, noTmux=${noTmux}`);
  initMetrics();

  // Init tracker
  await tracker.init();

  // Ensure labels for all configured types
  for (const ct of config.critterTypes) {
    await tracker.ensureLabel(ct.trigger.label);
  }

  // Ensure required workflow statuses across all teams.
  // The tracker loaded team statuses during init(). We use the LinearTracker's
  // cache to find all team IDs and ensure the needed statuses.
  const { LinearTracker } = await import("./tracker/linear.js");
  if (tracker instanceof LinearTracker) {
    const teamCache = tracker.getTeamStatusCache();
    const teamIds = Object.keys(teamCache);

    // Collect all outcome statuses that need creation
    const statusesToEnsure = new Set<string>();
    for (const ct of config.critterTypes) {
      for (const outcome of Object.values(ct.outcomes)) {
        if (outcome.status) statusesToEnsure.add(outcome.status);
      }
    }

    for (const teamId of teamIds) {
      for (const statusName of statusesToEnsure) {
        const color = statusName.includes("Failed") ? "#EF4444"
          : statusName === "Human Review" ? "#F59E0B"
          : undefined;
        const type = statusName.includes("Failed") || statusName === "Human Review" ? "started" : undefined;
        if (color && type) {
          await tracker.ensureStatus(teamId, statusName, type, color);
        }
      }
    }
  }

  // Create unified spawner + cleanup stale work dirs
  const spawner = new UnifiedSpawner(config, tracker);
  spawner.cleanupStale();
  spawner.startPeriodicCleanup();
  log("Cleaned up stale work directories");

  let lastPollAt: string | null = null;
  const updatePollTime = () => { lastPollAt = new Date().toISOString(); };

  // Create unified watcher
  const watcher = new UnifiedWatcher(config, tracker, spawner, updatePollTime);

  // Start health server
  let healthServer: { stop: () => void } | null = null;
  if (config.healthPort !== 0) {
    const metricsPath = join(homedir(), ".critters", "metrics.jsonl");
    healthServer = startHealthServer(config.healthPort, () => ({
      activeCritters: spawner.getActiveCount("create"),
      queuedCritters: spawner.getQueueSize("create"),
      activeReviews: spawner.getActiveCount("review"),
      queuedReviews: spawner.getQueueSize("review"),
      lastPollAt,
    }), metricsPath, {
      triggerPoll: () => watcher.triggerPoll(),
      triggerReviewPoll: () => watcher.triggerPoll(), // unified watcher handles both
    });
  }

  // Periodic main pane title update with uptime + active count
  let titleInterval: ReturnType<typeof setInterval> | null = null;
  if (!noTmux) {
    titleInterval = setInterval(() => {
      const uptime = formatDuration(Date.now() - startTime);
      const active = spawner.getActiveCount();
      const title = `Critters ${getDisplayVersion()} | up ${uptime} | ${active} active`;
      runCommand("tmux", ["select-pane", "-t", mainPaneId!, "-T", title]).catch(() => {});
    }, 10_000);
    titleInterval.unref();
  }

  // Log type configs
  for (const ct of config.critterTypes) {
    log(`Type "${ct.name}": concurrency=${ct.concurrency}, timeout=${ct.timeoutMinutes}min, phases=${ct.phases.map((p) => p.name).join("→")}`);
  }

  // Signal handlers
  const shutdown = () => {
    log("Shutting down...");
    if (titleInterval) clearInterval(titleInterval);
    healthServer?.stop();
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
