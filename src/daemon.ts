import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startAutoUpdater } from "./auto-updater.js";
import { createCircuitBreakers } from "./circuit-breaker-factory.js";
import { loadConfig, resolveConfigPath } from "./config.js";
import { createConfigReloadHandler } from "./config-reload.js";
import { ConfigWatcher } from "./config-watcher.js";
import type { CritterTypeConfig } from "./critter-type.js";
import { loadEnvFallback } from "./env.js";
import { checkDiskSpace } from "./git.js";
import { startHealthServer } from "./health.js";
import { enableJsonLogs, formatError, initFileLogging, log, logError } from "./logger.js";
import { initMetrics, pruneMetrics } from "./metrics.js";
import { checkPrerequisites } from "./prerequisites.js";
import { recoverOrphanedIssues } from "./recovery.js";
import { SlackNotifier } from "./slack.js";
import { createTracker } from "./tracker/index.js";
import { buildProviderConfig } from "./tracker/provider-config.js";
import type { IssueTracker } from "./tracker/types.js";
import type { TunnelHandle } from "./tunnel.js";
import type { Config } from "./types.js";
import { UnifiedSpawner } from "./unified-spawner.js";
import { UnifiedWatcher } from "./unified-watcher.js";
import { checkForUpdate, fetchLatestVersion, getDisplayVersion } from "./updater.js";
import { formatDuration, runCommand, shellEscape } from "./utils.js";
import { VERSION } from "./version.js";

export async function startDaemon(): Promise<void> {
  process.on("unhandledRejection", (reason) => {
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : formatError(reason);
    logError(`Unhandled rejection: ${detail}`);
  });

  process.on("uncaughtException", (err) => {
    logError(`Uncaught exception: ${err.stack ?? err.message}`);
  });

  const noTmux = Bun.argv.includes("--no-tmux");
  const noWatch = Bun.argv.includes("--no-watch");
  const skipUpdate = Bun.argv.includes("--skip-update");
  const dryRun = Bun.argv.includes("--dry-run");
  const jsonLogs = Bun.argv.includes("--json-logs");

  if (jsonLogs) {
    enableJsonLogs();
  }

  // --daemonized is an internal flag to prevent the child from forking again
  const daemonized = Bun.argv.includes("--daemonized");

  // Daemonize when --no-tmux is used (unless dry-run or already daemonized)
  if (noTmux && !dryRun && !daemonized) {
    const pidDir = join(homedir(), ".critters");
    mkdirSync(pidDir, { recursive: true });

    const args = Bun.argv.slice(1).filter((a) => !a.startsWith("/$bunfs/"));
    args.push("--daemonized");

    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();

    writeFileSync(join(pidDir, "critters.pid"), String(child.pid));

    console.log(`Critters daemon started (PID ${child.pid}), logging to ~/.critters/critters.log`);
    process.exit(0);
  }

  // Clean up stale PID file on startup (only relevant for --no-tmux mode)
  const pidFile = join(homedir(), ".critters", "critters.pid");
  if (noTmux && existsSync(pidFile)) {
    try {
      const oldPid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
      if (!Number.isNaN(oldPid) && oldPid !== process.pid) {
        try {
          process.kill(oldPid, 0); // Check if process exists
          // Process exists — another daemon may be running
          logError(`Another critters daemon may be running (PID ${oldPid}). Remove ${pidFile} if this is stale.`);
          process.exit(1);
        } catch {
          // Process doesn't exist — stale PID file, clean it up
          unlinkSync(pidFile);
        }
      }
    } catch {
      // PID file unreadable, remove it
      try { unlinkSync(pidFile); } catch {}
    }

    // Write our own PID file
    mkdirSync(join(homedir(), ".critters"), { recursive: true });
    writeFileSync(pidFile, String(process.pid));
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
    const { spawnSync } = await import("node:child_process");
    const args = process.argv.slice(1).filter((a) => !a.startsWith("/$bunfs/"));
    // Pass caller's PATH through so the re-launched binary inside tmux can
    // find tools like git, gh, claude even if the tmux server has a minimal PATH.
    const cmd = `env PATH=${shellEscape(process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin")} ${[process.execPath, ...args].map(shellEscape).join(" ")}`;
    const session = "critters";

    // Kill stale session if it exists — `tmux new-session -A` would just
    // attach to the old (dead) session and ignore the command.
    spawnSync("tmux", ["kill-session", "-t", session], { stdio: "ignore" });

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
  config.daemon.noTmux = noTmux || dryRun;

  // Apply jsonLogs from config (CLI flag takes precedence, already set above)
  if (!jsonLogs && config.daemon.jsonLogs) {
    enableJsonLogs();
  }

  // Fetch latest version for dev builds (non-blocking, cached for session)
  if (VERSION === "dev") {
    await fetchLatestVersion();
  }

  // Filter critter types if --type is specified (before creating trackers
  // so only the needed provider's tracker is instantiated)
  if (typeFilter) {
    const match = config.critterTypes.filter(
      (ct) => ct.name === typeFilter || ct.name.startsWith(`${typeFilter}:`)
    );
    if (match.length === 0) {
      const baseNames = [...new Set(config.critterTypes.map((ct) => ct.name.split(":")[0]))];
      const available = config.critterTypes.length === baseNames.length
        ? baseNames.join(", ")
        : baseNames.map((base) => {
            const variants = config.critterTypes
              .filter((ct) => ct.name === base || ct.name.startsWith(`${base}:`))
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

  log(`Critters ${getDisplayVersion()} starting (${config.critterTypes.length} type${config.critterTypes.length === 1 ? "" : "s"})...`);
  if (existsSync("/.dockerenv")) {
    log("Running inside Docker container");
  }
  const startTime = Date.now();

  if (!noTmux) {
    console.log(`\x1b[1;36m━━━ Critters ${getDisplayVersion()} ━━━\x1b[0m`);
  }

  if (!skipUpdate && VERSION !== "dev") {
    await checkForUpdate(VERSION);
  }

  // Verify required CLI tools are available
  await checkPrerequisites(config);

  // Check disk space at startup (warning only)
  try {
    checkDiskSpace(config.daemon.workDir, config.limits.minDiskSpaceMb * 2);
  } catch {
    log(`Warning: Low disk space on ${config.daemon.workDir} — below ${config.limits.minDiskSpaceMb * 2}MB (2x minDiskSpaceMb). Critters may fail to clone repos.`);
  }

  initFileLogging(config.limits.maxLogSizeMb);


  // Capture main pane ID so periodic title updates only affect this pane
  let mainPaneId: string | undefined;

  if (!noTmux) {
    const mainPaneResult = await runCommand("tmux", ["display-message", "-t", config.daemon.tmuxSession, "-p", "#{pane_id}"]);
    mainPaneId = mainPaneResult.stdout.trim();

    // Set main pane title (using captured pane ID)
    await runCommand("tmux", ["select-pane", "-t", mainPaneId, "-T", `Critters ${getDisplayVersion()}`]).catch(() => {});
    // Configure pane border styling (session-level settings, not pane-level)
    await runCommand("tmux", ["set", "-t", config.daemon.tmuxSession, "pane-border-status", "top"]).catch(() => {});
    await runCommand("tmux", ["set", "-t", config.daemon.tmuxSession, "pane-border-format", " #{pane_title} "]).catch(() => {});
    await runCommand("tmux", ["set", "-t", config.daemon.tmuxSession, "pane-border-style", "fg=colour240"]).catch(() => {});
    await runCommand("tmux", ["set", "-t", config.daemon.tmuxSession, "pane-active-border-style", "fg=colour39"]).catch(() => {});
  }

  // Log critter types
  const typesSummary = config.critterTypes.map((ct) => `${ct.name}(${ct.concurrency})`).join(", ");
  log(`Config loaded: types=[${typesSummary}], poll=${config.polling.intervalSeconds}s, noTmux=${noTmux}`);
  initMetrics();
  pruneMetrics(config.limits.metricsRetentionDays);

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

  // Clean up stale tmux panes from previous daemon runs
  if (!noTmux) {
    const { cleanupStalePanes, killStalePanes, listActiveCritterPaneIdentifiers } = await import("./claude.js");
    const activePaneIdentifiers = await listActiveCritterPaneIdentifiers(config.daemon.tmuxSession, mainPaneId);
    const stalePanes = await cleanupStalePanes(config.daemon.tmuxSession, spawner.getActiveWorkDirs(), mainPaneId, activePaneIdentifiers);
    if (stalePanes.length > 0) {
      const result = await killStalePanes(config.daemon.tmuxSession, stalePanes);
      log(`Cleaned up ${result.killed} stale tmux pane(s)`);
      for (const pane of stalePanes) log(`  Killed pane ${pane.paneId}: ${pane.title} (${pane.reason})`);
    }
    // Recover orphaned in-progress issues before starting the poll loop. Live
    // critter panes are treated as active startup evidence.
    await recoverOrphanedIssues(config, trackers, spawner, activePaneIdentifiers);
  } else {
    // Recover orphaned in-progress issues before starting the poll loop.
    await recoverOrphanedIssues(config, trackers, spawner);
  }

  // Create circuit breakers (one per provider)
  let slackNotifier = new SlackNotifier({
    webhookUrl: config.slack.webhookUrl,
    botToken: config.slack.botToken,
    channel: config.slack.channel,
  });
  const circuitBreakers = createCircuitBreakers(trackers, config, slackNotifier);

  let lastPollAt: string | null = null;
  const updatePollTime = () => { lastPollAt = new Date().toISOString(); };

  // Create unified watcher
  const watcher = new UnifiedWatcher(config, trackers, spawner, updatePollTime, circuitBreakers);

  // Start health server
  const webhookConfig = {
    linearWebhookSecret: config.linear.webhookSecret,
    jiraWebhookSecret: config.jira.webhookSecret,
    githubWebhookSecret: config.github.webhookSecret,
    githubRepos: config.github.repos,
    critterTypes: config.critterTypes,
  };
  let healthServer: { port: number; stop: () => void } | null = null;
  let tunnelHandle: TunnelHandle | null = null;
  const healthContext: {
    trackers: Map<string, IssueTracker>;
    critterTypes: CritterTypeConfig[];
    defaultProvider: string;
    repos: Record<string, { url: string; extraAllowedTools?: string[] }>;
    teamRepos: Record<string, string>;
    hooks: Record<string, string>;
    getTunnelUrl: () => string | null;
  } = {
    trackers,
    critterTypes: config.critterTypes,
    defaultProvider: config.provider,
    repos: config.repos,
    teamRepos: config.teamRepos,
    hooks: (config.hooks ?? {}) as Record<string, string>,
    getTunnelUrl: () => tunnelHandle?.url ?? null,
  };
  // Start auto-updater
  const autoUpdater = startAutoUpdater(config, spawner, slackNotifier, restartDaemon);

  function restartDaemon(): void {
    log("Restarting daemon...");

    try {
      // Clean up resources
      autoUpdater?.stop();
      tunnelHandle?.stop();
      configWatcher?.stop();
      if (titleInterval) clearInterval(titleInterval);
      healthServer?.stop();
      watcher.stop();

      // Re-exec: filter out Bun virtual paths (/$bunfs/) from argv
      const args = process.argv.slice(1).filter((a) => !a.startsWith("/$bunfs/"));

      if (process.env.TMUX_PANE) {
        // In tmux: use respawn-pane to atomically restart in the same pane.
        // Without this, the parent exit causes tmux to close the pane,
        // killing the child process before it can start.
        const cmd = [process.execPath, ...args].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
        Bun.spawnSync(["tmux", "respawn-pane", "-k", "-t", process.env.TMUX_PANE, cmd]);
        // respawn-pane tells the tmux server to kill us and restart —
        // exit cleanly in case SIGTERM hasn't arrived yet
        process.exit(0);
      } else {
        // Non-tmux: spawn detached child so it survives parent exit
        // Must use node:child_process spawn (not Bun.spawn) for detached support
        restarting = true;
        const child = spawn(process.execPath, args, {
          detached: true,
          stdio: "ignore",
          env: process.env,
        });
        child.unref();

        // Update PID file with new child's PID
        if (noTmux) {
          try {
            writeFileSync(join(homedir(), ".critters", "critters.pid"), String(child.pid));
          } catch {}
        }

        process.exit(0);
      }
    } catch (err) {
      logError(`Restart failed: ${formatError(err)}`);
      // Fatal — resources are already torn down, cannot recover
      process.exit(1);
    }
  }

  if (config.daemon.healthPort !== 0) {
    const metricsPath = join(homedir(), ".critters", "metrics.jsonl");
    healthServer = startHealthServer(config.daemon.healthPort, () => ({
      activeCritters: spawner.getActiveCount("create"),
      queuedCritters: spawner.getQueueSize("create"),
      activeReviews: spawner.getActiveCount("review"),
      queuedReviews: spawner.getQueueSize("review"),
      perType: spawner.getPerTypeCounts(),
      lastPollAt,
      activeCritterDetails: spawner.getActiveDetails(),
      queuedCritterDetails: spawner.getQueuedDetails(),
      pollIntervalSeconds: config.polling.intervalSeconds,
      concurrencyMax: config.critterTypes.reduce((sum, ct) => sum + ct.concurrency, 0),
      circuitBreakers: watcher.getCircuitBreakerStatus(),
    }), metricsPath, {
      triggerPoll: () => watcher.triggerPoll(),
      triggerReviewPoll: () => watcher.triggerPoll(), // unified watcher handles both
      triggerRestart: () => restartDaemon(),
      triggerStop: () => process.kill(process.pid, "SIGTERM"),
      triggerPollForIssue: (identifier: string) => watcher.pollForIssue(identifier),
      triggerKill: (identifiers: string[]) => spawner.killByIdentifiers(identifiers),
    }, config.daemon.workDir, config.daemon.dashboardToken, healthContext, webhookConfig);
  }

  // Start tunnel if configured
  if (config.tunnel?.enabled && config.daemon.healthPort !== 0) {
    const { startTunnel } = await import("./tunnel.js");
    tunnelHandle = await startTunnel(config.daemon.healthPort, config.tunnel);
    if (tunnelHandle) {
      log(`Tunnel active: ${tunnelHandle.url}`);
    }
  }

  // Periodic main pane title update with uptime + active count
  let titleInterval: ReturnType<typeof setInterval> | null = null;
  if (!noTmux) {
    titleInterval = setInterval(() => {
      if (!mainPaneId) return;
      const uptime = formatDuration(Date.now() - startTime);
      const active = spawner.getActiveCount();
      const title = `Critters ${getDisplayVersion()} | up ${uptime} | ${active} active`;
      runCommand("tmux", ["select-pane", "-t", mainPaneId, "-T", title]).catch(() => {});
    }, 10_000);
    titleInterval.unref();
  }

  // Log type configs
  for (const ct of config.critterTypes) {
    log(`Type "${ct.name}": concurrency=${ct.concurrency}, timeout=${ct.timeoutMinutes}min, phases=${ct.phases.map((p) => p.name).join("→")}`);
  }

  // Config hot-reload watcher
  let configWatcher: ConfigWatcher | null = null;
  if (!noWatch && !dryRun) {
    const resolvedPath = resolveConfigPath(configPath);
    const reloadHandler = createConfigReloadHandler({
      get config() { return config; },
      get trackers() { return trackers; },
      watcher,
      spawner,
      get slackNotifier() { return slackNotifier; },
      circuitBreakers,
      healthContext,
      webhookConfig,
      autoUpdater,
      jsonLogsCli: jsonLogs,
      ensureLabelsAndStatuses,
      updateRefs: (updates) => {
        config = updates.config;
        trackers = updates.trackers;
        slackNotifier = updates.slackNotifier;
      },
    });
    configWatcher = new ConfigWatcher(resolvedPath, reloadHandler);
    configWatcher.start();
  }

  // Signal handlers
  let shuttingDown = false;
  let restarting = false;

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    log("Shutting down...");
    autoUpdater?.stop();
    tunnelHandle?.stop();
    configWatcher?.stop();
    if (titleInterval) clearInterval(titleInterval);
    healthServer?.stop();
    watcher.stop();

    // Remove PID file (unless restarting — the new child needs it)
    if (noTmux && !restarting) {
      try { unlinkSync(join(homedir(), ".critters", "critters.pid")); } catch {}
    }

    // Graceful exit: give running tasks a moment to clean up
    setTimeout(() => {
      log("Exiting");
      process.exit(0);
    }, 6000);

    // Hard fallback: if the event loop is stuck (open handles, blocked I/O),
    // force exit after 10s. unref() ensures this timer alone won't keep the
    // process alive, but if other handles do, it will still fire and kill us.
    setTimeout(() => {
      log("Forced exit (shutdown timeout)");
      process.exit(1);
    }, 10_000).unref();
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
    // buildProviderConfig throws on unknown providers — previously a provider
    // with no switch case here was silently skipped and failed later, confusingly.
    trackers.set(provider, createTracker(buildProviderConfig(config, provider)));
  }

  return trackers;
}

async function ensureLabelsAndStatuses(config: Config, trackers: Map<string, IssueTracker>): Promise<void> {
  // Group critter types by provider
  const typesByProvider = new Map<string, CritterTypeConfig[]>();
  for (const ct of config.critterTypes) {
    const provider = ct.provider ?? config.provider;
    const types = typesByProvider.get(provider) ?? [];
    types.push(ct);
    typesByProvider.set(provider, types);
  }

  for (const [provider, types] of typesByProvider) {
    const tracker = trackers.get(provider);
    if (!tracker) continue;

    // Ensure labels
    const labels = new Set(types.map((ct) => ct.trigger.label));
    for (const label of labels) {
      await tracker.ensureLabel(label);
    }

    // Statuses referenced by outcomes/claimStatus, ensured per provider below.
    const statusesToEnsure = new Set<string>();
    for (const ct of types) {
      for (const outcome of Object.values(ct.outcomes)) {
        if (outcome.status) statusesToEnsure.add(outcome.status);
      }
      if (ct.claimStatus) statusesToEnsure.add(ct.claimStatus);
    }

    const statusColor = (statusName: string) =>
      statusName.includes("Failed") ? "#EF4444"
        : statusName === "Human Review" ? "#F59E0B"
        : "#8B5CF6";

    // Linear: create missing workflow states per team (Jira manages these in workflows)
    const { LinearTracker } = await import("./tracker/linear.js");
    if (tracker instanceof LinearTracker) {
      const teamCache = tracker.getTeamStatusCache();
      const teamIds = Object.keys(teamCache);

      const standardStatuses = new Set(["Done", "In Progress", "In Review", "Todo", "Backlog", "Canceled", "Cancelled"]);

      for (const teamId of teamIds) {
        for (const statusName of statusesToEnsure) {
          if (standardStatuses.has(statusName)) continue;
          if (teamCache[teamId]?.[statusName]) continue;

          await tracker.ensureStatus(teamId, statusName, "started", statusColor(statusName));
        }
      }
    }

    // GitHub: create missing status field options / status:* labels per repo.
    // GitHubTracker.ensureStatus is idempotent and self-skips existing entries.
    const { GitHubTracker } = await import("./tracker/github.js");
    if (tracker instanceof GitHubTracker) {
      for (const team of await tracker.listTeams()) {
        for (const statusName of statusesToEnsure) {
          await tracker.ensureStatus(team.id, statusName, "started", statusColor(statusName));
        }
      }
    }
  }
}
