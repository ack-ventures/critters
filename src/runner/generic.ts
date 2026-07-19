import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { spawnForPhase } from "../cli/spawn.js";
import { logTask, logTaskWarn } from "../logger.js";
import { buildPromptVars, resolvePrompt, resolveSkills, resolveTools } from "../prompt-template.js";
import { sanitizeIdentifier } from "../utils.js";
import type { PhaseContext, PhaseResult, PhaseRunner } from "./types.js";
import { validatePhaseResult } from "./validate.js";

const REPORT_FILE = ".critter-report.md";

const REPORT_INSTRUCTION = `

## Report Output
You MUST write your final report/output to the file \`.critter-report.md\` in the repo root using the Write tool.
This file will be automatically posted to the issue when you're done.
Do not skip this step — if you don't write the file, your work won't be visible.`;

/**
 * Generic phase runner for user-defined custom critter types.
 *
 * Automatically:
 * - Appends a standard instruction telling the active CLI to write `.critter-report.md`
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

    // Append report instruction so the CLI knows to write the file
    prompt += REPORT_INSTRUCTION;

    // Ensure Write is available so the CLI can create the report file
    const allowedTools = resolveTools(phase.tools, config, task, repoConfig);
    if (!allowedTools.includes("Write")) {
      allowedTools.push("Write");
    }

    logTask(task.identifier, `Phase ${phase.name} allowed tools: ${allowedTools.join(", ")}`);

    const spawn = await spawnForPhase(ctx, prompt, allowedTools, phase.name);

    validatePhaseResult(spawn, phase.name);

    // Read the report file that the CLI was instructed to write
    const reportPath = `${workDir}/${REPORT_FILE}`;
    let responseText: string | null = null;
    // Treat an empty/whitespace-only report as missing so we still fall through to
    // the stream-json fallback instead of returning an empty responseText.
    const reportContent = existsSync(reportPath) ? readFileSync(reportPath, "utf-8") : null;
    if (reportContent !== null && reportContent.trim().length > 0) {
      responseText = reportContent;
      logTask(task.identifier, `Report file found: ${REPORT_FILE} (${responseText.length} chars)`);
      // Also copy to the plans directory so builtin:execution can find it
      const planPath = `${workDir}/critters/plans/${sanitizeIdentifier(task.identifier)}.md`;
      if (!existsSync(planPath)) {
        copyFileSync(reportPath, planPath);
      }
    } else {
      // Fallback: extract from stream-json output
      logTaskWarn(
        task.identifier,
        reportContent !== null
          ? `${REPORT_FILE} was empty — extracting from CLI output`
          : `No ${REPORT_FILE} found — extracting from CLI output`,
      );
      const jsonLogFile = `${workDir}/.critter-output-${phase.name}.json`;
      const lastMessageFile = `${workDir}/.critter-last-message-${phase.name}.txt`;
      responseText = ctx.cliAdapter.extractFinalResponse(jsonLogFile, lastMessageFile);
      if (responseText) {
        logTask(task.identifier, `Extracted response from output log (${responseText.length} chars)`);
      } else {
        logTaskWarn(task.identifier, "Could not extract any response text");
      }
    }

    return { spawn, data: { responseText } };
  }
}
