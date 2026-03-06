import { JiraTracker } from "./jira.js";
import { LinearTracker } from "./linear.js";
import type { IssueTracker, ProviderConfig } from "./types.js";

export type { IssueTracker, IssueTrackerIssue, ProviderConfig, TrackerTask } from "./types.js";

export function createTracker(providerConfig: ProviderConfig): IssueTracker {
  switch (providerConfig.type) {
    case "linear": {
      if (!providerConfig.apiKey) {
        throw new Error("Linear tracker requires an API key (LINEAR_API_KEY)");
      }
      return new LinearTracker(providerConfig.apiKey);
    }
    case "jira": {
      if (!providerConfig.host || !providerConfig.email || !providerConfig.apiToken) {
        throw new Error("Jira tracker requires JIRA_HOST, JIRA_EMAIL, and JIRA_API_TOKEN");
      }
      return new JiraTracker(providerConfig.host, providerConfig.email, providerConfig.apiToken, providerConfig.statusMap);
    }
    default:
      throw new Error(`Unknown tracker provider: ${providerConfig.type}`);
  }
}
