import { existsSync, readFileSync } from "node:fs";
import { spawnClaude, spawnClaudeSubprocess } from "../claude.js";
import { logTask, logTaskWarn } from "../logger.js";
import { buildPromptVars, resolvePrompt, resolveTools } from "../prompt-template.js";
import { tailLines } from "../utils.js";
import type { PhaseContext, PhaseResult, PhaseRunner } from "./types.js";

/**
 * Extract the final response text from a stream-json output file.
 * Looks for the `result` event first, then falls back to the last
 * `assistant` message.
 */
export function extractResponseText(jsonLogFile: string): string | null {
  if (!existsSync(jsonLogFile)) return null;

  try {
    const content = readFileSync(jsonLogFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    // Search from the end — the result event is last
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);

        if (obj.type === "result" && typeof obj.result === "string") {
          return obj.result;
        }

        if (obj.type === "assistant") {
          if (typeof obj.message?.content === "string") {
            return obj.message.content;
          }
          if (Array.isArray(obj.message?.content)) {
            const text = obj.message.content
              .filter((b: { type: string }) => b.type === "text")
              .map((b: { text: string }) => b.text)
              .join("\n");
            if (text) return text;
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    // File read or parse error
  }

  return null;
}

/**
 * Generic phase runner for user-defined custom critter types.
 * Loads prompt from file, resolves tools, spawns Claude, returns result.
 * Extracts Claude's final response text for posting as a comment.
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

    // Extract Claude's final response from the stream-json log
    const jsonLogFile = `${workDir}/.critter-output-${phase.name}.json`;
    const responseText = extractResponseText(jsonLogFile);
    if (!responseText) {
      logTaskWarn(task.identifier, `Could not extract response text from ${phase.name} output`);
    }

    return { spawn, data: { responseText } };
  }
}
