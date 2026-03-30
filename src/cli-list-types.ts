import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import {
  type CritterTypeConfig,
  parseCritterTypes,
  synthesizeDefaultTypes,
} from "./critter-type.js";
import type { Config } from "./types.js";

function resolveConfigPath(configPath?: string): string {
  if (configPath) return configPath;

  const candidates = [
    "./critters.config.yaml",
    `${homedir()}/.critters/config.yaml`,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `Config file not found. Searched:\n` +
    candidates.map((c) => `  - ${c}`).join("\n") +
    `\n\nRun 'critters init' to create a config, or pass --config <path>.`,
  );
}

function loadCritterTypes(configPath?: string): { types: CritterTypeConfig[]; defaultProvider: string } {
  const resolved = resolveConfigPath(configPath);
  const raw = readFileSync(resolved, "utf-8");
  const yaml = parseYaml(raw) as Record<string, unknown>;

  const defaultProvider = ((yaml.provider as string) ?? "linear") as "linear" | "jira";

  const rawTypes = yaml.critterTypes as Record<string, Record<string, unknown>> | undefined;

  if (!rawTypes || typeof rawTypes !== "object") {
    // Synthesize from flat config fields — build a partial Config with the fields synthesizeDefaultTypes reads
    const partialConfig = {
      triggerLabel: (yaml.triggerLabel as string) ?? "Critter",
      planningModel: (yaml.planningModel as string) ?? "opus",
      maxPlanningTurns: (yaml.maxPlanningTurns as number) ?? 50,
      executionModel: (yaml.executionModel as string) ?? "opus",
      maxExecutionTurns: (yaml.maxExecutionTurns as number) ?? 75,
      concurrency: (yaml.concurrency as number) ?? 2,
      timeoutMinutes: (yaml.timeoutMinutes as number) ?? 30,
      reviewTriggerLabel: (yaml.reviewTriggerLabel as string) ?? "Critter Review",
      reviewModel: (yaml.reviewModel as string) ?? "opus",
      reviewConcurrency: (yaml.reviewConcurrency as number) ?? 2,
      reviewTimeoutMinutes: (yaml.reviewTimeoutMinutes as number) ?? 15,
      maxReviewTurns: (yaml.maxReviewTurns as number) ?? 30,
    } as Config;

    return { types: synthesizeDefaultTypes(partialConfig), defaultProvider };
  }

  const types: CritterTypeConfig[] = [];
  for (const [name, rawType] of Object.entries(rawTypes)) {
    const expanded = parseCritterTypes(name, rawType);
    types.push(...expanded);
  }

  if (types.length === 0) {
    console.error("critterTypes is defined but empty — no types to display.");
    process.exit(1);
  }

  return { types, defaultProvider };
}

function formatTrigger(trigger: CritterTypeConfig["trigger"]): string {
  const parts = [`label="${trigger.label}"`, `status="${trigger.status}"`];
  if (trigger.statusType) parts.push(`statusType="${trigger.statusType}"`);
  if (trigger.assignee) parts.push(`assignee="${trigger.assignee}"`);
  return parts.join(", ");
}

function formatPhases(phases: CritterTypeConfig["phases"]): string {
  const names = phases.map((p) => p.name).join(" → ");
  const count = phases.length;
  return `${names} (${count} phase${count !== 1 ? "s" : ""})`;
}

function formatOutcomes(outcomes: CritterTypeConfig["outcomes"]): string {
  return Object.entries(outcomes)
    .map(([key, val]) => `${key} → ${val.status}`)
    .join(", ");
}

export async function runListTypes(configPath?: string): Promise<void> {
  try {
    const { types, defaultProvider } = loadCritterTypes(configPath);

    console.log(`\nCritter Types (${types.length} configured)\n`);

    for (const ct of types) {
      const provider = ct.provider ?? defaultProvider;
      console.log(`  ${ct.name}`);
      console.log(`    Provider:    ${provider}`);
      console.log(`    Trigger:     ${formatTrigger(ct.trigger)}`);
      console.log(`    Phases:      ${formatPhases(ct.phases)}`);
      console.log(`    Concurrency: ${ct.concurrency}`);
      console.log(`    Timeout:     ${ct.timeoutMinutes} min`);
      console.log(`    Outcomes:    ${formatOutcomes(ct.outcomes)}`);
      if (ct.enrichment) {
        console.log(`    Enrichment:  ${ct.enrichment}`);
      }
      console.log();
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
