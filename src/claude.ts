/**
 * Re-export shim — logic has moved to src/cli/.
 * This file exists for backward compatibility so existing imports continue to work.
 */

export type { StalePane } from "./cli/spawn.js";
// Re-export spawn utilities from cli/spawn
export {
  cleanupStalePanes,
  killStalePanes,
  parsePaneList,
  spawnForPhase,
} from "./cli/spawn.js";

// Re-export adapter utilities via the Claude adapter singleton
import { ClaudeCodeAdapter } from "./cli/claude.js";
import type { CritterTypeConfig } from "./critter-type.js";
import type { PhaseContext } from "./runner/types.js";
import type { Config, SpawnResult } from "./types.js";

const _claude = new ClaudeCodeAdapter();

/**
 * @deprecated Use cliAdapter.readPartialCost() instead
 */
export function readPartialCost(filePath: string): number {
  return _claude.readPartialCost(filePath);
}

/**
 * @deprecated Use cliAdapter.resolveMcpConfig() instead
 */
export function resolveMcpConfig(
  critterType: CritterTypeConfig,
  config: Config,
): { mcpConfig: string[]; strictMcpConfig: boolean } {
  return _claude.resolveMcpConfig(critterType, config);
}

/**
 * @deprecated Use spawnForPhase() instead
 */
export async function spawnClaudeForPhase(
  ctx: PhaseContext,
  prompt: string,
  allowedTools: string[],
  phaseTag: string,
): Promise<SpawnResult> {
  const { spawnForPhase } = await import("./cli/spawn.js");
  return spawnForPhase(ctx, prompt, allowedTools, phaseTag);
}
