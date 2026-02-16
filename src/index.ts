import { loadConfig } from "./config.js";
import { checkPrerequisites } from "./prerequisites.js";
import { initLinear, ensureLabel, loadTeamStatuses, ensureCritterFailedStatus } from "./linear.js";
import { Spawner } from "./spawner.js";
import { Watcher } from "./watcher.js";
import { log, logError } from "./logger.js";

async function main() {
  log("Starting Critters...");

  // Verify required CLI tools are available
  await checkPrerequisites();

  // Load config
  const config = loadConfig();
  log(`Config loaded: concurrency=${config.concurrency}, timeout=${config.timeoutMinutes}min, poll=${config.pollIntervalSeconds}s`);

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
  log("Cleaned up stale work directories");

  // Create watcher
  const watcher = new Watcher(config, teamStatuses, spawner);

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
