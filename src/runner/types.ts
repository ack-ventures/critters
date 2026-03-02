import type { CritterTypeConfig, PhaseConfig } from "../critter-type.js";
import type { PerRepoConfig } from "../repo-config.js";
import type { IssueTracker, TrackerTask } from "../tracker/types.js";
import type { Config, SpawnResult } from "../types.js";

export interface PhaseContext {
  task: TrackerTask;
  critterType: CritterTypeConfig;
  phase: PhaseConfig;
  workDir: string;
  branch: string;
  tracker: IssueTracker;
  config: Config;
  repoConfig: PerRepoConfig | null;
  signal: AbortSignal;
  /** Whether this is a resume of a previously failed attempt */
  resuming: boolean;
}

export interface PhaseResult {
  spawn: SpawnResult;
  data: Record<string, unknown>;
}

export interface PhaseRunner {
  run(ctx: PhaseContext): Promise<PhaseResult>;
}
