import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { spawnClaudeForPhase } from "../claude.js";
import { logTask, logTaskWarn } from "../logger.js";
import { buildPromptVars, resolvePrompt, resolveSkills, resolveTools } from "../prompt-template.js";
import { tailLines } from "../utils.js";
import type { PhaseContext, PhaseResult, PhaseRunner } from "./types.js";

const REPORT_FILE = ".critter-report.md";

const REPORT_INSTRUCTION = `

## Report Output
You MUST write your final report/output to the file \`.critter-report.md\` in the repo root using the Write tool.
This file will be automatically posted to the issue when you're done.
Do not skip this step — if you don't write the file, your work won't be visible.`;

/**
 * Extract the final response text from a stream-json output file.
 * Used as a fallback when Claude doesn't write .critter-report.md.
 */
function extractResponseFromLog(jsonLogFile: string): string | null {
  if (!existsSync(jsonLogFile)) return null;

  try {
    const content = readFileSync(jsonLogFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    // Look for the result event (contains the final response text)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === "result" && typeof obj.result === "string" && obj.result.length > 50) {
          return obj.result;
        }
      } catch {
        continue;
      }
    }

    // Fallback: collect text from all assistant messages
    const textParts: string[] = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type !== "assistant") continue;
        if (typeof obj.message?.content === "string") {
          textParts.push(obj.message.content);
        } else if (Array.isArray(obj.message?.content)) {
          const text = obj.message.content
            .filter((b: { type: string }) => b.type === "text")
            .map((b: { text: string }) => b.text)
            .join("\n");
          if (text) textParts.push(text);
        }
      } catch {
        continue;
      }
    }

    if (textParts.length > 0) {
      return textParts.join("\n\n");
    }
  } catch {
    // File read or parse error
  }

  return null;
}

/**
 * Generic phase runner for user-defined custom critter types.
 *
 * Automatically:
 * - Appends a standard instruction telling Claude to write `.critter-report.md`
 * - Ensures `Write` is in the allowed tools list
 * - Reads the report file after completion and returns it as `responseText`
 * - Falls back to extracting from stream-json output if no report file
 */
export class GenericPhaseRunner implements PhaseRunner {
  async run(ctx: PhaseContext): Promise<PhaseResult> {
    const { task, config, workDir, branch, phase, repoConfig } = ctx;

    const vars = buildPromptVars(task, workDir, branch);
    let prompt = resolvePrompt(phase.prompt, vars);
    if (prompt === null) {
      throw new Error(`Prompt "${phase.prompt}" resolved to null — builtin prompts should use dedicated runners`);
    }

    // Append skill content
    const skillContent = resolveSkills(phase.skills, vars);
    if (skillContent) {
      prompt += skillContent;
    }

    // Append report instruction so Claude knows to write the file
    prompt += REPORT_INSTRUCTION;

    // Ensure Write is available so Claude can create the report file
    const allowedTools = resolveTools(phase.tools, config, task, repoConfig);
    if (!allowedTools.includes("Write")) {
      allowedTools.push("Write");
    }

    logTask(task.identifier, `Phase ${phase.name} allowed tools: ${allowedTools.join(", ")}`);

    const spawn = await spawnClaudeForPhase(ctx, prompt, allowedTools, phase.name);

    if (spawn.timedOut) {
      throw new Error(`Timed out during ${phase.name} phase`);
    }

    if (spawn.exitCode !== 0) {
      const errTail = tailLines(spawn.stderr || spawn.stdout, 20);
      throw new Error(`Phase ${phase.name} failed (exit ${spawn.exitCode}):\n${errTail}`);
    }

    // Read the report file that Claude was instructed to write
    const reportPath = `${workDir}/${REPORT_FILE}`;
    let responseText: string | null = null;
    if (existsSync(reportPath)) {
      responseText = readFileSync(reportPath, "utf-8");
      logTask(task.identifier, `Report file found: ${REPORT_FILE} (${responseText.length} chars)`);
      // Also copy to the plans directory so builtin:execution can find it
      const planPath = `${workDir}/critters/plans/${task.identifier}.md`;
      if (!existsSync(planPath)) {
        copyFileSync(reportPath, planPath);
      }
    } else {
      // Fallback: extract from stream-json output
      logTaskWarn(task.identifier, `No ${REPORT_FILE} found — extracting from Claude output`);
      const jsonLogFile = `${workDir}/.critter-output-${phase.name}.json`;
      responseText = extractResponseFromLog(jsonLogFile);
      if (responseText) {
        logTask(task.identifier, `Extracted response from output log (${responseText.length} chars)`);
      } else {
        logTaskWarn(task.identifier, "Could not extract any response text");
      }
    }

    return { spawn, data: { responseText } };
  }
}
