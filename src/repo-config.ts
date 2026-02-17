import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { log } from "./logger.js";

export type PerRepoConfig = {
  extraAllowedTools?: string[];
  planningPrompt?: string;
  executionPrompt?: string;
  reviewPrompt?: string;
};

export function loadRepoConfig(workDir: string): PerRepoConfig | null {
  const filePath = join(workDir, ".critters.yaml");
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = parseYaml(raw);
    if (parsed == null) return null;
    return parsed as PerRepoConfig;
  } catch (err) {
    log(`Warning: failed to parse .critters.yaml in ${workDir}: ${err}`);
    return null;
  }
}
