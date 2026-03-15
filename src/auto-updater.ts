import { log } from "./logger.js";
import type { SlackNotifier } from "./slack.js";
import type { Config } from "./types.js";
import type { UnifiedSpawner } from "./unified-spawner.js";
import { checkForUpdate, checkForUpdateAvailable } from "./updater.js";
import { VERSION } from "./version.js";

export interface AutoUpdaterHandle {
  stop(): void;
  updateConfig(config: Config): void;
}

export function startAutoUpdater(
  config: Config,
  spawner: UnifiedSpawner,
  slackNotifier: SlackNotifier,
  restartFn: () => void,
  /** @internal Version override for testing */
  _version?: string,
): AutoUpdaterHandle | null {
  const version = _version ?? VERSION;

  // Only auto-update when running as a compiled binary and not a dev build.
  // checkForUpdateAvailable() also has these guards, but we check here to
  // avoid creating an interval timer that would always no-op.
  const execName = process.execPath.split("/").pop() ?? "";
  const isBunRuntime = execName === "bun" || execName === "bun.exe";
  const isDevBuild = version === "dev";

  if (isBunRuntime) {
    log("Auto-update: disabled (not running as compiled binary)");
    return null;
  }
  if (isDevBuild) {
    log("Auto-update: disabled (dev build)");
    return null;
  }

  let enabled = config.autoUpdate?.enabled ?? true;
  let intervalMinutes = config.autoUpdate?.intervalMinutes ?? 1440;

  if (!enabled) {
    log("Auto-update: disabled by config");
    return null;
  }

  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    try {
      const result = await checkForUpdateAvailable(version);
      if (!result || !result.available) return;

      const activeCount = spawner.getActiveCount();
      if (activeCount > 0) {
        log(`Auto-update: v${result.currentVersion} → v${result.latestVersion} available but deferred — ${activeCount} critter(s) active`);
        return;
      }

      log(`Auto-update: applying update v${result.currentVersion} → v${result.latestVersion}...`);
      if (slackNotifier.isConfigured) {
        await slackNotifier.notify(
          "__auto_update__",
          `🔄 Auto-updating critters from v${result.currentVersion} to v${result.latestVersion}...`,
        );
      }

      await checkForUpdate(version);
      restartFn();
    } catch (err) {
      log(`Auto-update: check failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const startInterval = () => {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, intervalMinutes * 60 * 1000);
    timer.unref();
  };

  startInterval();
  log(`Auto-update: enabled, checking every ${intervalMinutes} minutes`);

  return {
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    updateConfig(newConfig: Config) {
      const newEnabled = newConfig.autoUpdate?.enabled ?? true;
      const newInterval = newConfig.autoUpdate?.intervalMinutes ?? 1440;

      if (!newEnabled) {
        if (timer) {
          clearInterval(timer);
          timer = null;
          log("Auto-update: disabled by config reload");
        }
        enabled = false;
        return;
      }

      enabled = true;
      if (newInterval !== intervalMinutes) {
        intervalMinutes = newInterval;
        startInterval();
        log(`Auto-update: interval changed to ${intervalMinutes} minutes`);
      } else if (!timer) {
        intervalMinutes = newInterval;
        startInterval();
        log(`Auto-update: re-enabled, checking every ${intervalMinutes} minutes`);
      }
    },
  };
}
