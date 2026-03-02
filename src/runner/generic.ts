import { spawnClaude, spawnClaudeSubprocess } from "../claude.js";
import { logTask } from "../logger.js";
import { buildPromptVars, resolvePrompt, resolveTools } from "../prompt-template.js";
import { tailLines } from "../utils.js";
import type { PhaseContext, PhaseResult, PhaseRunner } from "./types.js";

/**
 * Generic phase runner for user-defined custom critter types.
 * Loads prompt from file, resolves tools, spawns Claude, returns result.
 */
export class GenericPhaseRunner implements PhaseRunner {
  async run(ctx: PhaseContext): Promise<PhaseResult> {
    const { task, config, workDir, branch, phase, repoConfig, signal } = ctx;

    const vars = buildPromptVars(task, workDir, branch);
    const prompt = resolvePrompt(phase.prompt, vars);
    if (prompt === null) {
      throw new Error(`Prompt "${phase.prompt}" resolved to null — builtin prompts should use dedicated runners`);
    }

    const allowedTools = resolveTools(phase.tools, config, task, repoConfig);
    logTask(task.identifier, `Phase ${phase.name} allowed tools: ${allowedTools.join(", ")}`);

    const spawn = config.noTmux
      ? await spawnClaudeSubprocess(
          prompt,
          allowedTools,
          workDir,
          phase.maxTurns,
          task.identifier,
          task.title,
          phase.name,
          phase.model,
          signal,
        )
      : await spawnClaude(
          prompt,
          allowedTools,
          workDir,
          phase.maxTurns,
          task.identifier,
          task.title,
          phase.name,
          config.tmuxSession,
          phase.model,
          signal,
        );

    if (spawn.timedOut) {
      throw new Error(`Timed out during ${phase.name} phase`);
    }

    if (spawn.exitCode !== 0) {
      const errTail = tailLines(spawn.stderr || spawn.stdout, 20);
      throw new Error(`Phase ${phase.name} failed (exit ${spawn.exitCode}):\n${errTail}`);
    }

    return { spawn, data: {} };
  }
}
