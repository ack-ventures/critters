import type { PhaseConfig } from "../critter-type.js";
import { BuiltinPhase } from "../enums.js";
import { getBuiltinPhaseName } from "../prompt-template.js";
import { ExecutionPhaseRunner } from "./execution.js";
import { GenericPhaseRunner } from "./generic.js";
import { PlanningPhaseRunner } from "./planning.js";
import { ReviewPhaseRunner } from "./review.js";
import type { PhaseRunner } from "./types.js";

const planningRunner = new PlanningPhaseRunner();
const executionRunner = new ExecutionPhaseRunner();
const reviewRunner = new ReviewPhaseRunner();
const genericRunner = new GenericPhaseRunner();

/**
 * Get the appropriate phase runner for a given phase config.
 * Built-in phases (builtin:planning, builtin:execution, builtin:review) use
 * dedicated runners. Custom phases use the generic runner.
 */
export function getPhaseRunner(phase: PhaseConfig): PhaseRunner {
  const builtinName = getBuiltinPhaseName(phase);

  switch (builtinName) {
    case BuiltinPhase.Planning:
      return planningRunner;
    case BuiltinPhase.Execution:
      return executionRunner;
    case BuiltinPhase.Review:
      return reviewRunner;
    default:
      return genericRunner;
  }
}

export { ExecutionPhaseRunner } from "./execution.js";
export { GenericPhaseRunner } from "./generic.js";
export { PlanningPhaseRunner } from "./planning.js";
export { parseReviewOutcome, ReviewPhaseRunner } from "./review.js";
export type { PhaseContext, PhaseResult, PhaseRunner } from "./types.js";
export { validatePhaseResult } from "./validate.js";
