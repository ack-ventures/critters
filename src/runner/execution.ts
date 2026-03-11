import { existsSync, readFileSync } from "node:fs";
import { spawnClaudeForPhase } from "../claude.js";
import { autoCommit, getDefaultBranch, hasCommitsOnBranch, hasUncommittedChanges } from "../git.js";
import { logTask, logTaskError, logTaskWarn } from "../logger.js";
import { buildExecutionPrompt, getExecutionAllowedTools } from "../prompt.js";
import { buildPromptVars, resolveSkills, resolveTools } from "../prompt-template.js";
import { withRetry } from "../retry.js";
import { formatDuration, runCommand, tailLines } from "../utils.js";
import type { PhaseContext, PhaseResult, PhaseRunner } from "./types.js";

export class ExecutionPhaseRunner implements PhaseRunner {
  async run(ctx: PhaseContext): Promise<PhaseResult> {
    const { task, config, workDir, branch, repoConfig, resuming } = ctx;

    // Adapt TrackerTask to CritterTask for prompt builders
    const critterTask = {
      issueId: task.id,
      identifier: task.identifier,
      title: task.title,
      description: task.description,
      repoUrl: task.repoUrl,
      teamId: task.groupId,
      projectId: task.projectId,
      issueUrl: task.issueUrl,
    };

    // Use explicit phase tools if configured, otherwise fall back to default execution tools
    const allowedTools = Array.isArray(ctx.phase.tools)
      ? resolveTools(ctx.phase.tools, config, task, repoConfig)
      : getExecutionAllowedTools(config, critterTask, repoConfig);
    logTask(task.identifier, `Execution phase allowed tools: ${allowedTools.join(", ")}`);

    const defaultBranch = await getDefaultBranch(workDir, task.identifier);
    const basePrompt = buildExecutionPrompt(critterTask, allowedTools, { resuming, repoConfig, commitPlans: ctx.critterType.repo.commitPlans, defaultBranch });
    const vars = buildPromptVars(task, workDir, branch);
    const skillContent = resolveSkills(ctx.phase.skills, vars);
    const prompt = skillContent ? basePrompt + skillContent : basePrompt;

    const spawn = await spawnClaudeForPhase(ctx, prompt, allowedTools, "exec");

    validatePhaseResult(spawn, "execution");

    // Auto-commit if needed
    if (await hasUncommittedChanges(workDir)) {
      await autoCommit(workDir, task.identifier, `[${task.identifier}] Auto-commit remaining changes`);
    }

    if (!(await hasCommitsOnBranch(workDir, branch, task.identifier))) {
      // No commits — nothing to do (analysis-only completion)
      return { spawn, data: { prUrl: null } };
    }

    // Only look for a PR if the branch was pushed to the remote
    const { stdout: remoteOut } = await runCommand("git", ["ls-remote", "--heads", "origin", branch], { cwd: workDir });
    if (!remoteOut.trim()) {
      return { spawn, data: { prUrl: null } };
    }

    // Detect PR
    const prUrl = await detectPr(workDir, branch, task.identifier);

    // Verify PR targets the correct base branch
    if (prUrl) {
      await verifyPrBaseBranch(workDir, prUrl, defaultBranch, task.identifier);
    }

    return { spawn, data: { prUrl } };
  }
}

async function verifyPrBaseBranch(
  workDir: string,
  prUrl: string,
  expectedBase: string,
  identifier: string,
): Promise<void> {
  try {
    const { code, stdout } = await runCommand(
      "gh",
      ["pr", "view", prUrl, "--json", "baseRefName"],
      { cwd: workDir },
    );
    if (code !== 0) return;

    const { baseRefName } = JSON.parse(stdout);
    if (baseRefName && baseRefName !== expectedBase) {
      logTaskWarn(identifier, `PR targets "${baseRefName}" instead of "${expectedBase}", retargeting...`);
      const editResult = await runCommand(
        "gh",
        ["pr", "edit", prUrl, "--base", expectedBase],
        { cwd: workDir },
      );
      if (editResult.code === 0) {
        logTask(identifier, `Retargeted PR to ${expectedBase}`);
      } else {
        logTaskError(identifier, `Failed to retarget PR: ${editResult.stderr}`);
      }
    }
  } catch (err) {
    logTaskError(identifier, `PR base branch verification failed: ${err}`);
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

function formatStatsSection(stats: { name: string; durationMs: number; costUsd?: number }[]): string {
  const lines: string[] = ["## Critter Stats"];
  let totalMs = 0;
  let totalCost = 0;
  let hasCost = false;

  for (const phase of stats) {
    totalMs += phase.durationMs;
    if (phase.costUsd != null) {
      totalCost += phase.costUsd;
      hasCost = true;
    }
    const duration = formatDuration(phase.durationMs);
    const capitalizedName = phase.name.charAt(0).toUpperCase() + phase.name.slice(1);
    if (phase.costUsd != null) {
      lines.push(`- **${capitalizedName}**: ${duration} · $${phase.costUsd.toFixed(2)}`);
    } else {
      lines.push(`- **${capitalizedName}**: ${duration}`);
    }
  }

  // Total line (only if more than one phase)
  if (stats.length > 1) {
    const totalDuration = formatDuration(totalMs);
    if (hasCost) {
      lines.push(`- **Total**: ${totalDuration} · $${totalCost.toFixed(2)}`);
    } else {
      lines.push(`- **Total**: ${totalDuration}`);
    }
  }

  return lines.join("\n");
}

export async function updatePrWithPlan(
  workDir: string,
  prUrl: string,
  identifier: string,
  phaseStats?: { name: string; durationMs: number; costUsd?: number }[],
): Promise<void> {
  const planFile = `${workDir}/critters/plans/${identifier}.md`;
  let planContent = "";
  if (existsSync(planFile)) {
    planContent = readFileSync(planFile, "utf-8").trim();

    // Truncate very long plans to keep PR body manageable
    const MAX_PLAN_LENGTH = 10000;
    if (planContent.length > MAX_PLAN_LENGTH) {
      planContent = planContent.slice(0, MAX_PLAN_LENGTH) + "\n\n*(plan truncated)*";
    }
  }

  if (!planContent && (!phaseStats || phaseStats.length === 0)) {
    logTask(identifier, "No plan file or stats found, skipping PR body update");
    return;
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

  let newBody = currentBody;
  if (phaseStats && phaseStats.length > 0) {
    newBody += "\n\n" + formatStatsSection(phaseStats);
  }
  if (planContent) {
    newBody += "\n\n## Plan\n\n" + planContent;
  }

  const { code } = await runCommand(
    "gh",
    ["pr", "edit", prUrl, "--body", newBody],
    { cwd: workDir },
  );
  if (code !== 0) {
    logTask(identifier, "Failed to update PR body with plan (non-fatal)");
  } else {
    logTask(identifier, "Updated PR body with implementation plan and stats");
  }
}
