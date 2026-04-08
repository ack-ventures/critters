import { CircuitBreaker } from "./circuit-breaker.js";
import { log, logError } from "./logger.js";
import { type SlackNotifier, sendSlackNotification } from "./slack.js";
import type { IssueTracker } from "./tracker/types.js";
import type { Config } from "./types.js";

export function createCircuitBreaker(
  provider: string,
  config: Config,
  slackNotifier: SlackNotifier,
): CircuitBreaker {
  const breaker = new CircuitBreaker(provider, {
    failureThreshold: config.circuitBreaker?.failureThreshold ?? 3,
    baseDelayMs: config.pollIntervalSeconds * 2 * 1000,
    maxDelayMs: (config.circuitBreaker?.maxBackoffMinutes ?? 30) * 60 * 1000,
    onStateChange: (providerName, from, to) => {
      if (to === "open") {
        const msg = `⚠️ Circuit breaker OPEN for ${providerName} — backing off after ${breaker.getStatus().consecutiveFailures} consecutive failures`;
        logError(msg);
        if (slackNotifier.isConfigured) {
          slackNotifier.notify(`__circuit_breaker_${providerName}__`, msg);
        } else {
          sendSlackNotification(config.slackWebhookUrl, msg);
        }
      } else if (to === "closed" && from !== "closed") {
        const msg = `✅ Circuit breaker CLOSED for ${providerName} — API recovered, resuming normal polling`;
        log(msg);
        if (slackNotifier.isConfigured) {
          slackNotifier.notify(`__circuit_breaker_${providerName}__`, msg);
        } else {
          sendSlackNotification(config.slackWebhookUrl, msg);
        }
      }
    },
  });
  return breaker;
}

export function createCircuitBreakers(
  trackers: Map<string, IssueTracker>,
  config: Config,
  slackNotifier: SlackNotifier,
): Map<string, CircuitBreaker> {
  const breakers = new Map<string, CircuitBreaker>();
  for (const provider of trackers.keys()) {
    breakers.set(provider, createCircuitBreaker(provider, config, slackNotifier));
  }
  return breakers;
}
