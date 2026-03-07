import { existsSync } from "node:fs";
import { spawnClaude, spawnClaudeSubprocess } from "../claude.js";
import { commitFile } from "../git.js";
import { logTask } from "../logger.js";
import { buildPlanningPrompt, getPlanningAllowedTools } from "../prompt.js";
import { buildPromptVars, resolveSkills } from "../prompt-template.js";
import type { PhaseContext, PhaseResult, PhaseRunner } from "./types.js";

export class PlanningPhaseRunner implements PhaseRunner {
  async run(ctx: PhaseContext): Promise<PhaseResult> {
    const { task, config, workDir, repoConfig, signal } = ctx;

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

    const basePrompt = buildPlanningPrompt(critterTask, repoConfig);
    const vars = buildPromptVars(task, workDir, "");
    const skillContent = resolveSkills(ctx.phase.skills, vars);
    const prompt = skillContent ? basePrompt + skillContent : basePrompt;

    const spawn = config.noTmux
      ? await spawnClaudeSubprocess(
          prompt,
          allowedTools,
          workDir,
          ctx.phase.maxTurns,
          task.identifier,
          task.title,
          "plan",
          ctx.phase.model,
          task.repoUrl,
          signal,
        )
      : await spawnClaude(
          prompt,
          allowedTools,
          workDir,
          ctx.phase.maxTurns,
          task.identifier,
          task.title,
          "plan",
          config.tmuxSession,
          ctx.phase.model,
          task.repoUrl,
          signal,
        );

    validatePhaseResult(spawn, "planning");

    // Verify plan file exists
    const planFile = `${workDir}/critters/plans/${task.identifier}.md`;
    if (!existsSync(planFile)) {
      throw new Error("Planning failed to produce a plan file");
    }

    // Commit plan file to branch
    await commitFile(
      workDir,
      `critters/plans/${task.identifier}.md`,
      `[${task.identifier}] Add implementation plan`,
      task.identifier,
    );

    return { spawn, data: { planFile } };
  }
}

function validatePhaseResult(
  result: { exitCode: number; timedOut: boolean; stderr: string; stdout: string },
  phaseName: string,
): void {
  if (result.timedOut) {
    throw new Error(`Timed out during ${phaseName} phase`);
  }
  if (result.exitCode !== 0) {
    const lines = (result.stderr || result.stdout).split("\n");
    const errTail = lines.slice(-20).join("\n");
    const label = phaseName.charAt(0).toUpperCase() + phaseName.slice(1);
    throw new Error(`${label} failed (exit ${result.exitCode}):\n${errTail}`);
  }
}
