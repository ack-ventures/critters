import type { Config } from "./types.js";

export interface TriggerConfig {
  label: string;
  status: string;
  statusType?: string;
  assignee?: string;
}

export interface PhaseConfig {
  name: string;
  prompt: string;
  model: string;
  maxTurns: number;
  tools: string | string[];
}

export interface OutcomeConfig {
  status: string;
  comment?: boolean;
}

export interface CritterTypeConfig {
  name: string;
  trigger: TriggerConfig;
  repo: { clone: boolean; branch?: boolean };
  phases: PhaseConfig[];
  outcomes: Record<string, OutcomeConfig>;
  concurrency: number;
  timeoutMinutes: number;
  enrichment?: string;
  provider?: "linear" | "jira";
}

/**
 * Synthesize built-in "create" and "review" critter types from flat config fields.
 * Called when `critterTypes` is not present in the config YAML.
 */
export function synthesizeDefaultTypes(config: Config): CritterTypeConfig[] {
  const createType: CritterTypeConfig = {
    name: "create",
    trigger: {
      label: config.triggerLabel,
      status: "Todo",
      statusType: "unstarted",
    },
    repo: { clone: true, branch: true },
    phases: [
      {
        name: "planning",
        prompt: "builtin:planning",
        model: config.planningModel,
        maxTurns: config.maxPlanningTurns,
        tools: "readonly",
      },
      {
        name: "execution",
        prompt: "builtin:execution",
        model: config.executionModel,
        maxTurns: config.maxExecutionTurns,
        tools: "default",
      },
    ],
    outcomes: {
      success: { status: "In Review" },
      failure: { status: "Critter Failed" },
    },
    concurrency: config.concurrency,
    timeoutMinutes: config.timeoutMinutes,
  };

  const reviewType: CritterTypeConfig = {
    name: "review",
    trigger: {
      label: config.reviewTriggerLabel,
      status: "In Review",
    },
    repo: { clone: true },
    phases: [
      {
        name: "review",
        prompt: "builtin:review",
        model: config.reviewModel,
        maxTurns: config.maxReviewTurns,
        tools: "review",
      },
    ],
    outcomes: {
      merged: { status: "Done" },
      needsChanges: { status: "Human Review" },
      failure: { status: "Critter Failed" },
    },
    concurrency: config.reviewConcurrency,
    timeoutMinutes: config.reviewTimeoutMinutes,
    enrichment: "extractPrUrl",
  };

  return [createType, reviewType];
}

export function validateCritterType(ct: CritterTypeConfig): void {
  if (!ct.name) {
    throw new Error("Critter type must have a name");
  }
  if (!ct.trigger?.label || !ct.trigger?.status) {
    throw new Error(`Critter type "${ct.name}": trigger must have label and status`);
  }
  if (!ct.phases || ct.phases.length === 0) {
    throw new Error(`Critter type "${ct.name}": must have at least one phase`);
  }
  if (ct.concurrency < 1) {
    throw new Error(`Critter type "${ct.name}": concurrency must be >= 1`);
  }
  if (ct.timeoutMinutes <= 0) {
    throw new Error(`Critter type "${ct.name}": timeoutMinutes must be > 0`);
  }
  for (const phase of ct.phases) {
    if (!phase.name || !phase.prompt || !phase.model || phase.maxTurns <= 0) {
      throw new Error(`Critter type "${ct.name}", phase "${phase.name}": invalid phase config`);
    }
  }
}

/**
 * Parse a raw YAML critter type entry into a CritterTypeConfig.
 */
export function parseCritterType(name: string, raw: Record<string, unknown>): CritterTypeConfig {
  const trigger = raw.trigger as Record<string, unknown> | undefined;
  if (!trigger) {
    throw new Error(`Critter type "${name}": missing trigger`);
  }

  const repoRaw = (raw.repo as Record<string, unknown>) ?? { clone: true };
  const phases = raw.phases as Array<Record<string, unknown>> | undefined;
  if (!phases || !Array.isArray(phases) || phases.length === 0) {
    throw new Error(`Critter type "${name}": must have at least one phase`);
  }

  const outcomes = raw.outcomes as Record<string, Record<string, unknown>> | undefined;
  if (!outcomes) {
    throw new Error(`Critter type "${name}": missing outcomes`);
  }

  const parsedOutcomes: Record<string, OutcomeConfig> = {};
  for (const [key, val] of Object.entries(outcomes)) {
    parsedOutcomes[key] = {
      status: val.status as string,
      comment: val.comment as boolean | undefined,
    };
  }

  const parsedPhases: PhaseConfig[] = phases.map((p) => ({
    name: p.name as string,
    prompt: p.prompt as string,
    model: p.model as string,
    maxTurns: p.maxTurns as number,
    tools: (p.tools as string | string[]) ?? "default",
  }));

  const ct: CritterTypeConfig = {
    name,
    trigger: {
      label: trigger.label as string,
      status: trigger.status as string,
      statusType: trigger.statusType as string | undefined,
      assignee: trigger.assignee as string | undefined,
    },
    repo: {
      clone: (repoRaw.clone as boolean) ?? true,
      branch: repoRaw.branch as boolean | undefined,
    },
    phases: parsedPhases,
    outcomes: parsedOutcomes,
    concurrency: (raw.concurrency as number) ?? 2,
    timeoutMinutes: (raw.timeoutMinutes as number) ?? 30,
    enrichment: raw.enrichment as string | undefined,
    provider: raw.provider as "linear" | "jira" | undefined,
  };

  validateCritterType(ct);
  return ct;
}

/**
 * Parse a raw YAML critter type, expanding multi-provider arrays into
 * separate configs. `provider: [linear, jira]` becomes two entries
 * with names like "create:linear" and "create:jira".
 */
export function parseCritterTypes(name: string, raw: Record<string, unknown>): CritterTypeConfig[] {
  const providerRaw = raw.provider;

  if (Array.isArray(providerRaw) && providerRaw.length > 1) {
    const results: CritterTypeConfig[] = [];
    for (const p of providerRaw) {
      const provider = p as "linear" | "jira";
      const ct = parseCritterType(`${name}:${provider}`, { ...raw, provider });
      results.push(ct);
    }
    return results;
  }

  // Single provider (string or single-element array)
  const provider = Array.isArray(providerRaw) ? providerRaw[0] : providerRaw;
  const ct = parseCritterType(name, { ...raw, provider: provider as string | undefined });
  return [ct];
}
