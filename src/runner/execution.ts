import { existsSync, readFileSync } from "node:fs";
import { spawnClaude, spawnClaudeSubprocess } from "../claude.js";
import { autoCommit, hasCommitsOnBranch, hasUncommittedChanges } from "../git.js";
import { logTask, logTaskError } from "../logger.js";
import { buildExecutionPrompt, getExecutionAllowedTools } from "../prompt.js";
import { withRetry } from "../retry.js";
import { runCommand, tailLines } from "../utils.js";
import type { PhaseContext, PhaseResult, PhaseRunner } from "./types.js";

export class ExecutionPhaseRunner implements PhaseRunner {
  async run(ctx: PhaseContext): Promise<PhaseResult> {
    const { task, config, workDir, branch, repoConfig, signal, resuming } = ctx;

    // Adapt TrackerTask to CritterTask for prompt builders
    const critterTask = {
      issueId: task.id,
      identifier: task.identifier,
      title: task.title,
      description: task.description,
      repoUrl: task.repoUrl,
      teamId: task.groupId,
      projectId: task.projectId,
    };

    const allowedTools = getExecutionAllowedTools(config, critterTask, repoConfig);
    logTask(task.identifier, `Execution phase allowed tools: ${allowedTools.join(", ")}`);

    const prompt = buildExecutionPrompt(critterTask, allowedTools, { resuming, repoConfig });

    const spawn = config.noTmux
      ? await spawnClaudeSubprocess(
          prompt,
          allowedTools,
          workDir,
          ctx.phase.maxTurns,
          task.identifier,
          task.title,
          "exec",
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
          "exec",
          config.tmuxSession,
          ctx.phase.model,
          task.repoUrl,
          signal,
        );

    validatePhaseResult(spawn, "execution");

    // Auto-commit if needed
    if (await hasUncommittedChanges(workDir)) {
      await autoCommit(workDir, task.identifier, `[${task.identifier}] Auto-commit remaining changes`);
    }

    if (!(await hasCommitsOnBranch(workDir, branch, task.identifier))) {
      throw new Error("Execution completed but no commits were made");
    }

    // Detect PR
    const prUrl = await detectPr(workDir, branch, task.identifier);

    // Include plan in PR body
    if (prUrl) {
      await updatePrWithPlan(workDir, prUrl, task.identifier);
    }

    return { spawn, data: { prUrl } };
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
    const errTail = tailLines(result.stderr || result.stdout, 20);
    const label = phaseName.charAt(0).toUpperCase() + phaseName.slice(1);
    throw new Error(`${label} failed (exit ${result.exitCode}):\n${errTail}`);
  }
}

async function detectPr(
  workDir: string,
  branch: string,
  identifier: string,
): Promise<string | null> {
  try {
    return await withRetry(
      async () => {
        const { code, stdout, stderr } = await runCommand(
          "gh",
          ["pr", "list", "--head", branch, "--json", "url", "--limit", "1"],
          { cwd: workDir },
        );

        if (code !== 0) {
          throw new Error(`gh pr list failed: ${stderr}`);
        }

        const prs = JSON.parse(stdout);
        if (prs.length > 0) {
          return prs[0].url as string;
        }
        throw new Error("PR not found yet");
      },
      {
        maxRetries: 4,
        baseDelayMs: 3000,
        maxDelayMs: 15000,
        onRetry: (_error, attempt, delayMs) => {
          logTask(identifier, `PR not found yet, retrying in ${Math.round(delayMs)}ms... (attempt ${attempt + 1}/4)`);
        },
      },
    );
  } catch {
    logTaskError(identifier, "PR not detected after 5 attempts");
    return null;
  }
}

async function updatePrWithPlan(
  workDir: string,
  prUrl: string,
  identifier: string,
): Promise<void> {
  const planFile = `${workDir}/critters/plans/${identifier}.md`;
  if (!existsSync(planFile)) {
    logTask(identifier, "No plan file found, skipping PR body update");
    return;
  }

  let planContent = readFileSync(planFile, "utf-8").trim();
  if (!planContent) return;

  // Truncate very long plans to keep PR body manageable
  const MAX_PLAN_LENGTH = 10000;
  if (planContent.length > MAX_PLAN_LENGTH) {
    planContent = planContent.slice(0, MAX_PLAN_LENGTH) + "\n\n*(plan truncated)*";
  }

  // Get current PR body
  const { code: viewCode, stdout: viewOut } = await runCommand(
    "gh",
    ["pr", "view", prUrl, "--json", "body"],
    { cwd: workDir },
  );
  if (viewCode !== 0) {
    logTask(identifier, "Could not read current PR body, skipping plan injection");
    return;
  }

  let currentBody = "";
  try {
    currentBody = JSON.parse(viewOut).body ?? "";
  } catch {
    // Best effort
  }

  const newBody = currentBody + "\n\n## Plan\n\n" + planContent;

  const { code } = await runCommand(
    "gh",
    ["pr", "edit", prUrl, "--body", newBody],
    { cwd: workDir },
  );
  if (code !== 0) {
    logTask(identifier, "Failed to update PR body with plan (non-fatal)");
  } else {
    logTask(identifier, "Updated PR body with implementation plan");
  }
}
