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
