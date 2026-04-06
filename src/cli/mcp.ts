import type { CritterTypeConfig } from "../critter-type.js";
import type { Config } from "../types.js";
import type { CliAdapter } from "./types.js";

export function resolvePhaseMcpConfig(
  cliAdapter: CliAdapter,
  critterType: CritterTypeConfig,
  config: Config,
): { mcpConfig: string[]; strictMcpConfig: boolean } {
  if (!cliAdapter.supportsMcp()) {
    return { mcpConfig: [], strictMcpConfig: false };
  }

  return cliAdapter.resolveMcpConfig(critterType, config);
}
