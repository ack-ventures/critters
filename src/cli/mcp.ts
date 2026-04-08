import { homedir } from "node:os";
import { join } from "node:path";
import type { CritterTypeConfig } from "../critter-type.js";
import type { Config } from "../types.js";
import type { CliAdapter } from "./types.js";

export function resolveMcpConfigShared(
  critterType: CritterTypeConfig,
  config: Config,
): { mcpConfig: string[]; strictMcpConfig: boolean } {
  const raw = critterType.mcpConfig ?? config.mcpConfig;
  const strict =
    critterType.strictMcpConfig ?? config.strictMcpConfig ?? false;

  if (!raw) return { mcpConfig: [], strictMcpConfig: strict };

  const paths = Array.isArray(raw) ? raw : [raw];
  const resolved = paths.map((p) =>
    p.startsWith("~") ? join(homedir(), p.slice(1)) : p,
  );

  return { mcpConfig: resolved, strictMcpConfig: strict };
}

export function resolvePhaseMcpConfig(
  cliAdapter: CliAdapter,
  critterType: CritterTypeConfig,
  config: Config,
): { mcpConfig: string[]; strictMcpConfig: boolean } {
  if (!cliAdapter.capabilities.mcp) {
    return { mcpConfig: [], strictMcpConfig: false };
  }

  return cliAdapter.resolveMcpConfig(critterType, config);
}
