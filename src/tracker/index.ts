import { GitHubTracker } from "./github.js";
import { JiraTracker } from "./jira.js";
import { LinearTracker } from "./linear.js";
import type { IssueTracker, ProviderConfig } from "./types.js";

export type { CreatedIssue, CreateIssueInput, IssueTracker, IssueTrackerIssue, ProviderConfig, TrackerTask, TrackerTeam } from "./types.js";

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
    case "github": {
      if (!providerConfig.token) {
        throw new Error("GitHub tracker requires GITHUB_TOKEN");
      }
      if (!providerConfig.repos || providerConfig.repos.length === 0) {
        throw new Error('GitHub tracker requires github.repos (at least one "owner/repo")');
      }
      return new GitHubTracker(providerConfig.token, providerConfig.repos, {
        statusField: providerConfig.statusField,
        statusMap: providerConfig.statusMap,
        statusTypes: providerConfig.statusTypeMap,
      });
    }
    default:
      throw new Error(`Unknown tracker provider: ${providerConfig.type}`);
  }
}
