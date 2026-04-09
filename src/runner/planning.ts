import { existsSync } from "node:fs";
import { spawnForPhase } from "../cli/spawn.js";
import { commitFile } from "../git.js";
import { logTask } from "../logger.js";
import { buildPlanningPrompt, getPlanningAllowedTools } from "../prompt.js";
import { buildPromptVars, resolveSkills } from "../prompt-template.js";
import type { PhaseContext, PhaseResult, PhaseRunner } from "./types.js";
import { validatePhaseResult } from "./validate.js";

export class PlanningPhaseRunner implements PhaseRunner {
  async run(ctx: PhaseContext): Promise<PhaseResult> {
    const { task, workDir, repoConfig } = ctx;

    const allowedTools = getPlanningAllowedTools();
    logTask(task.identifier, `Planning phase allowed tools: ${allowedTools.join(", ")}`);

    // Adapt TrackerTask to CritterTask for buildPlanningPrompt
    const critterTask = {
      issueId: task.id,
      identifier: task.identifier,
      title: task.title,
      description: task.description,
      repoUrl: task.repoUrl,
      teamId: task.groupId,
      projectId: task.projectId,
    };

    const basePrompt = buildPlanningPrompt(critterTask, ctx.cliAdapter, repoConfig);
    const vars = buildPromptVars(task, workDir, "");
    const skillContent = resolveSkills(ctx.phase.skills, vars);
    const prompt = skillContent ? basePrompt + skillContent : basePrompt;

    const spawn = await spawnForPhase(ctx, prompt, allowedTools, "plan");

    validatePhaseResult(spawn, "planning");

    // Verify plan file exists
    const planFile = `${workDir}/critters/plans/${task.identifier}.md`;
    if (!existsSync(planFile)) {
      throw new Error("Planning failed to produce a plan file");
    }

    // Commit plan file to branch (only if commitPlans is enabled)
    if (ctx.critterType.repo.commitPlans) {
      await commitFile(
        workDir,
        `critters/plans/${task.identifier}.md`,
        `[${task.identifier}] Add implementation plan`,
        task.identifier,
      );
    }

    return { spawn, data: { planFile } };
  }
}

