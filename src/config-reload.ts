import type { CircuitBreaker } from "./circuit-breaker.js";
import { createCircuitBreaker } from "./circuit-breaker-factory.js";
import { diffConfigs } from "./config-watcher.js";
import type { CritterTypeConfig } from "./critter-type.js";
import { resetMetadataCache } from "./health.js";
import { disableJsonLogs, enableJsonLogs, isJsonMode, log, logError } from "./logger.js";
import type { SlackNotifier } from "./slack.js";
import { createTracker } from "./tracker/index.js";
import type { IssueTracker } from "./tracker/types.js";
import type { Config } from "./types.js";
import type { UnifiedSpawner } from "./unified-spawner.js";
import type { UnifiedWatcher } from "./unified-watcher.js";

export interface DaemonContext {
  config: Config;
  trackers: Map<string, IssueTracker>;
  watcher: UnifiedWatcher;
  spawner: UnifiedSpawner;
  slackNotifier: SlackNotifier;
  circuitBreakers: Map<string, CircuitBreaker>;
  healthContext: {
    trackers: Map<string, IssueTracker>;
    critterTypes: CritterTypeConfig[];
    defaultProvider: string;
    repos: Record<string, { url: string; extraAllowedTools?: string[] }>;
    teamRepos: Record<string, string>;
  };
  webhookConfig: {
    linearWebhookSecret?: string;
    jiraWebhookSecret?: string;
    critterTypes: CritterTypeConfig[];
  };
  autoUpdater: { updateConfig: (c: Config) => void; stop: () => void } | null;
  jsonLogsCli: boolean;
  ensureLabelsAndStatuses: (config: Config, trackers: Map<string, IssueTracker>) => Promise<void>;
  /** Callback to update the parent's mutable config/trackers/slackNotifier refs */
  updateRefs: (updates: { config: Config; trackers: Map<string, IssueTracker>; slackNotifier: SlackNotifier }) => void;
}

const immutableFields = ["workDir", "healthPort", "tmuxSession", "dashboardToken", "metricsRetentionDays"] as const;

export function createConfigReloadHandler(ctx: DaemonContext): (newConfig: Config) => void {
  return (newConfig: Config) => {
    // Preserve runtime flag
    newConfig.noTmux = ctx.config.noTmux;
    newConfig.daemon.noTmux = ctx.config.daemon.noTmux;

    // Override immutable fields with current values, warn if changed
    for (const field of immutableFields) {
      if (newConfig[field] !== ctx.config[field]) {
        log(`Warning: '${field}' cannot be changed at runtime (ignoring ${JSON.stringify(ctx.config[field])} → ${JSON.stringify(newConfig[field])})`);
        (newConfig as unknown as Record<string, unknown>)[field] = ctx.config[field];
      }
    }

    // Tunnel config is immutable at runtime (ngrok is a long-lived subprocess)
    if (newConfig.tunnel?.enabled !== ctx.config.tunnel?.enabled) {
      log("Warning: 'tunnel.enabled' cannot be changed at runtime — restart the daemon to apply");
      newConfig.tunnel = ctx.config.tunnel;
    }

    // Warn if default provider changed
    if (newConfig.provider !== ctx.config.provider) {
      log(`Warning: default 'provider' changed (${ctx.config.provider} → ${newConfig.provider}) — new trackers created, but restart recommended for clean state`);
    }

    // Check if new providers are needed
    const neededProviders = new Set<string>();
    for (const ct of newConfig.critterTypes) {
      neededProviders.add(ct.provider ?? newConfig.provider);
    }
    const newTrackers = new Map(ctx.trackers);
    const trackersToInit: IssueTracker[] = [];
    for (const provider of neededProviders) {
      if (!newTrackers.has(provider)) {
        const tracker = createTracker(
          provider === "jira"
            ? { type: "jira", host: newConfig.jira.host, email: newConfig.jira.email, apiToken: newConfig.jira.apiToken, statusMap: newConfig.jira.statusMap }
            : { type: "linear", apiKey: newConfig.linear.apiKey },
        );
        newTrackers.set(provider, tracker);
        trackersToInit.push(tracker);
      }
    }

    // Compute diff before applying
    const summary = diffConfigs(ctx.config, newConfig);

    // Init new trackers and apply config
    (async () => {
      for (const tracker of trackersToInit) {
        await tracker.init();
      }
      // Update circuit breakers
      for (const [_provider, breaker] of ctx.circuitBreakers) {
        breaker.updateOptions({
          failureThreshold: newConfig.circuitBreaker?.failureThreshold ?? 3,
          baseDelayMs: newConfig.polling.intervalSeconds * 2 * 1000,
          maxDelayMs: (newConfig.circuitBreaker?.maxBackoffMinutes ?? 30) * 60 * 1000,
        });
      }
      // Create breakers for any new providers
      for (const provider of newTrackers.keys()) {
        if (!ctx.circuitBreakers.has(provider)) {
          const breaker = createCircuitBreaker(provider, newConfig, ctx.slackNotifier);
          ctx.circuitBreakers.set(provider, breaker);
        }
      }
      // Update slack notifier
      const { SlackNotifier } = await import("./slack.js");
      const newSlackNotifier = new SlackNotifier({
        webhookUrl: newConfig.slack.webhookUrl,
        botToken: newConfig.slack.botToken,
        channel: newConfig.slack.channel,
      });

      ctx.autoUpdater?.updateConfig(newConfig);
      ctx.watcher.updateConfig(newConfig, newTrackers);
      ctx.spawner.updateConfig(newConfig, newTrackers);

      // Update mutable refs in daemon scope
      ctx.updateRefs({ config: newConfig, trackers: newTrackers, slackNotifier: newSlackNotifier });

      ctx.healthContext.trackers = newTrackers;
      ctx.healthContext.critterTypes = newConfig.critterTypes;
      ctx.healthContext.defaultProvider = newConfig.provider;
      ctx.healthContext.repos = newConfig.repos;
      ctx.healthContext.teamRepos = newConfig.teamRepos;
      ctx.webhookConfig.linearWebhookSecret = newConfig.linear.webhookSecret;
      ctx.webhookConfig.jiraWebhookSecret = newConfig.jira.webhookSecret;
      ctx.webhookConfig.critterTypes = newConfig.critterTypes;
      resetMetadataCache();
      // Hot-reload jsonLogs (CLI flag always takes precedence)
      if (!ctx.jsonLogsCli) {
        if (newConfig.daemon.jsonLogs && !isJsonMode()) {
          enableJsonLogs();
        } else if (!newConfig.daemon.jsonLogs && isJsonMode()) {
          disableJsonLogs();
        }
      }
      await ctx.ensureLabelsAndStatuses(newConfig, newTrackers);
      log(summary);
    })().catch((err) => {
      logError(`Config reload apply failed: ${err}`);
    });
  };
}
