import { LinearTracker } from "./linear.js";
import type { IssueTracker, ProviderConfig } from "./types.js";

export type { IssueTracker, ProviderConfig, TrackerTask } from "./types.js";

export function createTracker(providerConfig: ProviderConfig): IssueTracker {
  switch (providerConfig.type) {
    case "linear": {
      if (!providerConfig.apiKey) {
        throw new Error("Linear tracker requires an API key (LINEAR_API_KEY)");
      }
      return new LinearTracker(providerConfig.apiKey);
    }
    case "jira":
      throw new Error("Jira tracker is not yet implemented");
    default:
      throw new Error(`Unknown tracker provider: ${providerConfig.type}`);
  }
}
