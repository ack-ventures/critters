import { existsSync, readFileSync } from "node:fs";
import { spawnForPhase } from "../cli/spawn.js";
import { logTask } from "../logger.js";
import { buildPromptVars, resolveSkills } from "../prompt-template.js";
import { buildReviewPrompt, getReviewAllowedTools } from "../review-prompt.js";
import { runCommand, tailLines } from "../utils.js";
import type { PhaseContext, PhaseResult, PhaseRunner } from "./types.js";

export interface ReviewOutcome {
  decision: "merged" | "needs_changes" | "unknown";
  reason?: string;
}

export function parseReviewOutcome(logFilePath: string): ReviewOutcome {
  if (!existsSync(logFilePath)) {
    return { decision: "unknown" };
  }

  try {
    const content = readFileSync(logFilePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i--) {
      let text: string;
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === "assistant" && typeof obj.message?.content === "string") {
          text = obj.message.content;
        } else if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
          text = obj.message.content
            .filter((b: { type: string }) => b.type === "text")
            .map((b: { text: string }) => b.text)
            .join("\n");
        } else if (obj.type === "result" && typeof obj.result === "string") {
          text = obj.result;
        } else {
          continue;
        }
      } catch {
        continue;
      }

      const match = text.match(/REVIEW_RESULT:(MERGED|NEEDS_CHANGES)(?::(.+))?/);
      if (match) {
        if (match[1] === "MERGED") {
          return { decision: "merged" };
        }
        return { decision: "needs_changes", reason: match[2] || "No reason provided" };
      }
    }
  } catch {
    // File read or parse error
  }

  return { decision: "unknown" };
}

export class ReviewPhaseRunner implements PhaseRunner {
  async run(ctx: PhaseContext): Promise<PhaseResult> {
    const { task, workDir, repoConfig } = ctx;

    // Verify PR is still open
    if (task.prNumber) {
      const prState = await runCommand(
        "gh",
        ["pr", "view", String(task.prNumber), "--json", "state", "--jq", ".state"],
        { cwd: workDir },
      );

      const state = prState.stdout.trim();
      if (state === "MERGED") {
        logTask(task.identifier, "PR already merged");
        return {
          spawn: { exitCode: 0, stdout: "", stderr: "", timedOut: false },
          data: { reviewDecision: "merged", alreadyMerged: true },
        };
      }
      if (state === "CLOSED") {
        throw new Error("PR is closed");
      }
    }

    // Resolve PR branch name and checkout
    if (task.prNumber && !task.prBranch) {
      const branchResult = await runCommand(
        "gh",
        ["pr", "view", String(task.prNumber), "--json", "headRefName", "--jq", ".headRefName"],
        { cwd: workDir },
      );
      task.prBranch = branchResult.stdout.trim();
    }

    if (task.prBranch) {
      const fetchResult = await runCommand(
        "git",
        ["fetch", "origin", `${task.prBranch}:${task.prBranch}`],
        { cwd: workDir },
      );
      if (fetchResult.code !== 0) {
        throw new Error(`Failed to fetch PR branch: ${fetchResult.stderr}`);
      }

      const checkoutResult = await runCommand(
        "git",
        ["checkout", task.prBranch],
        { cwd: workDir },
      );
      if (checkoutResult.code !== 0) {
        throw new Error(`Failed to checkout PR branch: ${checkoutResult.stderr}`);
      }
    }

    // Build review prompt — adapt TrackerTask to ReviewTask
    const reviewTask = {
      issueId: task.id,
      identifier: task.identifier,
      title: task.title,
      description: task.description,
      repoUrl: task.repoUrl,
      teamId: task.groupId,
      projectId: task.projectId,
      prUrl: task.prUrl ?? "",
      prNumber: task.prNumber ?? 0,
      prBranch: task.prBranch ?? "",
    };

    const allowedTools = getReviewAllowedTools();
    const basePrompt = buildReviewPrompt(reviewTask, ctx.cliAdapter, repoConfig);
    const vars = buildPromptVars(task, workDir, task.prBranch ?? "");
    const skillContent = resolveSkills(ctx.phase.skills, vars);
    const prompt = skillContent ? basePrompt + skillContent : basePrompt;

    logTask(task.identifier, "Starting review phase");

    const spawn = await spawnForPhase(ctx, prompt, allowedTools, "review");

    if (spawn.timedOut) {
      throw new Error("Timed out during review phase");
    }

    if (spawn.exitCode !== 0) {
      const errTail = tailLines(spawn.stderr || spawn.stdout, 20);
      throw new Error(`Review failed (exit ${spawn.exitCode}):\n${errTail}`);
    }

    // Parse review outcome from Claude's output
    const jsonLogFile = `${workDir}/.critter-output-review.json`;
    const outcome = parseReviewOutcome(jsonLogFile);

    // Fallback: if no sentinel, check if PR was actually merged
    if (outcome.decision === "unknown" && task.prNumber) {
      const fallbackState = await runCommand(
        "gh",
        ["pr", "view", String(task.prNumber), "--json", "state", "--jq", ".state"],
        { cwd: workDir },
      );
      if (fallbackState.stdout.trim() === "MERGED") {
        outcome.decision = "merged";
      }
    }

    return {
      spawn,
      data: {
        reviewDecision: outcome.decision,
        reviewReason: outcome.reason,
      },
    };
  }
}
