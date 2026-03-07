#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveConfigPath } from "./config.js";
import { ConfigWatcher, diffConfigs } from "./config-watcher.js";
import type { CritterTypeConfig } from "./critter-type.js";
import { loadEnvFallback } from "./env.js";
import { resetMetadataCache, startHealthServer } from "./health.js";
import { runInit } from "./init.js";
import { runInitRepo } from "./init-repo.js";
import { enableJsonLogs, initFileLogging, log, logError } from "./logger.js";
import { initMetrics, pruneMetrics } from "./metrics.js";
import { checkPrerequisites } from "./prerequisites.js";
import { runStatus } from "./status.js";
import { createTracker } from "./tracker/index.js";
import type { IssueTracker } from "./tracker/types.js";
import type { TunnelHandle } from "./tunnel.js";
import type { Config } from "./types.js";
import { UnifiedSpawner } from "./unified-spawner.js";
import { UnifiedWatcher } from "./unified-watcher.js";
import { checkForUpdate, fetchLatestVersion, getDisplayVersion } from "./updater.js";
import { formatDuration, runCommand, shellEscape } from "./utils.js";
import { VERSION } from "./version.js";

// ── Subcommand routing ──────────────────────────────────────────────────────

const subcommand = Bun.argv[2];

if (subcommand === "version" || subcommand === "--version") {
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
  list-types  Show configured critter types
  logs        Show logs for a critter run
  tail        Live-stream output from all active critters
  init-repo   Scaffold .critters.yaml in current repo
  prompt-help Launch Claude to help design critter types and prompts
  clean       Clean up stale work directories (--branches for remote branches)
  validate    Validate config file without starting daemon
  help        Show this help

Flags:
  --dry-run       Poll once, show what would happen, and exit
  --no-tmux       Run without tmux (log to file instead)
  --skip-update   Skip auto-update check on startup
  --config PATH   Use a custom config file
  --type NAME     Filter to a specific critter type (use with --dry-run)
  --json-logs     Output structured JSON logs (one object per line)

Clean flags:
  --branches   Clean up stale critter branches from remotes
  --all        Remove all work directories (not just stale ones)
  --dry-run    Show what would be deleted without deleting

Logs flags:
  --phase planning|execution|review  Show specific phase (default: most recent)
  --follow, -f                       Tail mode (stream new output)

Tail flags:
  --type NAME  Filter to a specific critter type`);
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

if (subcommand === "validate") {
  const configIdx = Bun.argv.indexOf("--config");
  const configPath = configIdx !== -1 && Bun.argv[configIdx + 1]
    ? Bun.argv[configIdx + 1]
    : undefined;
  const { runValidate } = await import("./validate.js");
  await runValidate(configPath);
  process.exit(0);
}

if (subcommand === "kickoff") {
  const { runKickoff } = await import("./cli-kickoff.js");
  await runKickoff();
  process.exit(0);
}

if (subcommand === "prompt-help") {
  const { runPromptHelp } = await import("./prompt-help.js");
  await runPromptHelp();
  process.exit(0);
}

if (subcommand === "list-types") {
  const { runListTypes } = await import("./cli-list-types.js");
  const configIdx = Bun.argv.indexOf("--config");
  const configPath = configIdx !== -1 && Bun.argv[configIdx + 1] ? Bun.argv[configIdx + 1] : undefined;
  await runListTypes(configPath);
  process.exit(0);
}

if (subcommand === "clean") {
  const { runClean } = await import("./cli-clean.js");
  await runClean(Bun.argv.slice(3));
  process.exit(0);
}

if (subcommand === "tail") {
  const { tailCommand } = await import("./cli-tail.js");
  await tailCommand(Bun.argv.slice(3));
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
  const jsonLogs = Bun.argv.includes("--json-logs");

  if (jsonLogs) {
    enableJsonLogs();
  }
  const typeFilter = (() => {
    const idx = Bun.argv.indexOf("--type");
    return idx !== -1 && Bun.argv[idx + 1] ? Bun.argv[idx + 1] : undefined;
  })();

  if (typeFilter && !dryRun) {
    logError("--type can only be used with --dry-run");
    process.exit(1);
  }

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
  loadEnvFallback();

  // Load config (needed for both normal and dry-run modes)
  const configIdx = Bun.argv.indexOf("--config");
  const configPath = configIdx !== -1 && Bun.argv[configIdx + 1]
    ? Bun.argv[configIdx + 1]
    : undefined;
  let config = loadConfig(configPath);
  config.noTmux = noTmux || dryRun;

  // Fetch latest version for dev builds (non-blocking, cached for session)
  if (VERSION === "dev") {
    await fetchLatestVersion();
  }

  // Filter critter types if --type is specified (before creating trackers
  // so only the needed provider's tracker is instantiated)
  if (typeFilter) {
    const match = config.critterTypes.filter(
      (ct) => ct.name === typeFilter || ct.name.startsWith(typeFilter + ":")
    );
    if (match.length === 0) {
      const baseNames = [...new Set(config.critterTypes.map((ct) => ct.name.split(":")[0]))];
      const available = config.critterTypes.length === baseNames.length
        ? baseNames.join(", ")
        : baseNames.map((base) => {
            const variants = config.critterTypes
              .filter((ct) => ct.name === base || ct.name.startsWith(base + ":"))
              .map((ct) => ct.name);
            return variants.length > 1 ? `${base} (${variants.join(", ")})` : base;
          }).join(", ");
      logError(`Unknown type "${typeFilter}". Available types: ${available}`);
      process.exit(1);
    }
    config.critterTypes = match;
  }

  // Create issue trackers (one per unique provider)
  let trackers = createTrackers(config);

  if (dryRun) {
    log(`Critters ${getDisplayVersion()} — dry run${typeFilter ? ` (type: ${typeFilter})` : ""}`);
    for (const tracker of trackers.values()) {
      await tracker.init();
    }

    const watcher = new UnifiedWatcher(config, trackers, null);
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

  if (noTmux && !jsonLogs) {
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
  pruneMetrics(config.metricsRetentionDays);

  // Init all trackers
  for (const tracker of trackers.values()) {
    await tracker.init();
  }

  // Ensure labels and workflow statuses for each type via its provider's tracker
  await ensureLabelsAndStatuses(config, trackers);

  // Create unified spawner + cleanup stale work dirs
  const spawner = new UnifiedSpawner(config, trackers);
  spawner.cleanupStale();
  spawner.startPeriodicCleanup();
  log("Cleaned up stale work directories");

  let lastPollAt: string | null = null;
  const updatePollTime = () => { lastPollAt = new Date().toISOString(); };

  // Create unified watcher
  const watcher = new UnifiedWatcher(config, trackers, spawner, updatePollTime);

  // Start health server
  let healthServer: { stop: () => void } | null = null;
  const healthContext: {
    trackers: Map<string, IssueTracker>;
    critterTypes: CritterTypeConfig[];
    defaultProvider: string;
  } = {
    trackers,
    critterTypes: config.critterTypes,
    defaultProvider: config.provider,
  };
  if (config.healthPort !== 0) {
    const metricsPath = join(homedir(), ".critters", "metrics.jsonl");
    healthServer = startHealthServer(config.healthPort, () => ({
      activeCritters: spawner.getActiveCount("create"),
      queuedCritters: spawner.getQueueSize("create"),
      activeReviews: spawner.getActiveCount("review"),
      queuedReviews: spawner.getQueueSize("review"),
      perType: spawner.getPerTypeCounts(),
      lastPollAt,
      activeCritterDetails: spawner.getActiveDetails(),
    }), metricsPath, {
      triggerPoll: () => watcher.triggerPoll(),
      triggerReviewPoll: () => watcher.triggerPoll(), // unified watcher handles both
    }, config.workDir, config.dashboardToken, healthContext);
  }

  // Start tunnel if configured
  let tunnelHandle: TunnelHandle | null = null;
  if (config.tunnel?.enabled && config.healthPort !== 0) {
    const { startTunnel } = await import("./tunnel.js");
    tunnelHandle = await startTunnel(config.healthPort, config.tunnel);
    if (tunnelHandle) {
      log(`Tunnel active: ${tunnelHandle.url}`);
    }
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

  // Config hot-reload watcher
  const immutableFields = ["workDir", "healthPort", "tmuxSession", "dashboardToken"] as const;
  const resolvedPath = resolveConfigPath(configPath);
  const configWatcher = new ConfigWatcher(resolvedPath, (newConfig) => {
    // Preserve runtime flag
    newConfig.noTmux = config.noTmux;

    // Override immutable fields with current values, warn if changed
    for (const field of immutableFields) {
      if (newConfig[field] !== config[field]) {
        log(`Warning: '${field}' cannot be changed at runtime (ignoring ${JSON.stringify(config[field])} → ${JSON.stringify(newConfig[field])})`);
        (newConfig as unknown as Record<string, unknown>)[field] = config[field];
      }
    }

    // Tunnel config is immutable at runtime (ngrok is a long-lived subprocess)
    if (newConfig.tunnel?.enabled !== config.tunnel?.enabled) {
      log("Warning: 'tunnel.enabled' cannot be changed at runtime — restart the daemon to apply");
      newConfig.tunnel = config.tunnel;
    }

    // Check if new providers are needed
    const neededProviders = new Set<string>();
    for (const ct of newConfig.critterTypes) {
      neededProviders.add(ct.provider ?? newConfig.provider);
    }
    const newTrackers = new Map(trackers);
    const trackersToInit: IssueTracker[] = [];
    for (const provider of neededProviders) {
      if (!newTrackers.has(provider)) {
        const tracker = createTracker(
          provider === "jira"
            ? { type: "jira", host: newConfig.jiraHost, email: newConfig.jiraEmail, apiToken: newConfig.jiraApiToken, statusMap: newConfig.jiraStatusMap }
            : { type: "linear", apiKey: newConfig.linearApiKey },
        );
        newTrackers.set(provider, tracker);
        trackersToInit.push(tracker);
      }
    }

    // Compute diff before applying
    const summary = diffConfigs(config, newConfig);

    // Init new trackers and apply config
    (async () => {
      for (const tracker of trackersToInit) {
        await tracker.init();
      }
      watcher.updateConfig(newConfig, newTrackers);
      spawner.updateConfig(newConfig, newTrackers);
      trackers = newTrackers;
      config = newConfig;
      healthContext.trackers = newTrackers;
      healthContext.critterTypes = newConfig.critterTypes;
      healthContext.defaultProvider = newConfig.provider;
      resetMetadataCache();
      await ensureLabelsAndStatuses(config, trackers);
      log(summary);
    })().catch((err) => {
      logError(`Config reload apply failed: ${err}`);
    });
  });
  configWatcher.start();

  // Signal handlers
  const shutdown = () => {
    log("Shutting down...");
    tunnelHandle?.stop();
    configWatcher.stop();
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

function createTrackers(config: Config): Map<string, IssueTracker> {
  const trackers = new Map<string, IssueTracker>();
  const neededProviders = new Set<string>();
  for (const ct of config.critterTypes) {
    neededProviders.add(ct.provider ?? config.provider);
  }

  for (const provider of neededProviders) {
    switch (provider) {
      case "linear":
        trackers.set("linear", createTracker({
          type: "linear",
          apiKey: config.linearApiKey,
        }));
        break;
      case "jira":
        trackers.set("jira", createTracker({
          type: "jira",
          host: config.jiraHost,
          email: config.jiraEmail,
          apiToken: config.jiraApiToken,
          statusMap: config.jiraStatusMap,
        }));
        break;
    }
  }

  return trackers;
}

async function ensureLabelsAndStatuses(config: Config, trackers: Map<string, IssueTracker>): Promise<void> {
  // Group critter types by provider
  const typesByProvider = new Map<string, CritterTypeConfig[]>();
  for (const ct of config.critterTypes) {
    const provider = ct.provider ?? config.provider;
    if (!typesByProvider.has(provider)) {
      typesByProvider.set(provider, []);
    }
    typesByProvider.get(provider)!.push(ct);
  }

  for (const [provider, types] of typesByProvider) {
    const tracker = trackers.get(provider);
    if (!tracker) continue;

    // Ensure labels
    const labels = new Set(types.map((ct) => ct.trigger.label));
    for (const label of labels) {
      await tracker.ensureLabel(label);
    }

    // Ensure workflow statuses (Linear-specific — Jira manages these in workflows)
    const { LinearTracker } = await import("./tracker/linear.js");
    if (tracker instanceof LinearTracker) {
      const teamCache = tracker.getTeamStatusCache();
      const teamIds = Object.keys(teamCache);

      const statusesToEnsure = new Set<string>();
      for (const ct of types) {
        for (const outcome of Object.values(ct.outcomes)) {
          if (outcome.status) statusesToEnsure.add(outcome.status);
        }
      }

      const standardStatuses = new Set(["Done", "In Progress", "In Review", "Todo", "Backlog", "Canceled", "Cancelled"]);

      for (const teamId of teamIds) {
        for (const statusName of statusesToEnsure) {
          if (standardStatuses.has(statusName)) continue;
          if (teamCache[teamId]?.[statusName]) continue;

          const color = statusName.includes("Failed") ? "#EF4444"
            : statusName === "Human Review" ? "#F59E0B"
            : "#8B5CF6";
          await tracker.ensureStatus(teamId, statusName, "started", color);
        }
      }
    }
  }
}

main().catch((err) => {
  logError(`Fatal: ${err}`);
  process.exit(1);
});
