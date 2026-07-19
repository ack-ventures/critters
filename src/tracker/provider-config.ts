import type { ProviderConfig } from "./types.js";

/**
 * Structural source for provider credentials/settings. `Config` (src/types.ts)
 * satisfies this shape; CLI commands build smaller literals of the same shape.
 */
export interface ProviderConfigSource {
  linear: { apiKey?: string };
  jira: { host?: string; email?: string; apiToken?: string; statusMap?: Record<string, string> };
  github: {
    token?: string;
    repos?: string[];
    statusField?: string;
    statusMap?: Record<string, string>;
    statusTypes?: Record<string, string[]>;
  };
}

/**
 * Build the ProviderConfig for a tracker provider. Single construction point —
 * call sites previously hand-rolled these objects, and two of them silently
 * treated any non-"jira" provider as linear. Throws on unknown providers.
 *
 * Lives in its own module (not tracker/index.ts) because tests fully mock
 * tracker/index.js; importing this from there would break those mocks.
 */
export function buildProviderConfig(source: ProviderConfigSource, provider: string): ProviderConfig {
  switch (provider) {
    case "linear":
      return { type: "linear", apiKey: source.linear.apiKey };
    case "jira":
      return {
        type: "jira",
        host: source.jira.host,
        email: source.jira.email,
        apiToken: source.jira.apiToken,
        statusMap: source.jira.statusMap,
      };
    case "github":
      return {
        type: "github",
        token: source.github.token,
        repos: source.github.repos ?? [],
        statusField: source.github.statusField,
        statusMap: source.github.statusMap,
        statusTypeMap: source.github.statusTypes,
      };
    default:
      throw new Error(`Unknown tracker provider: "${provider}"`);
  }
}
