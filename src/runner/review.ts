import { ClaudeCodeAdapter } from "../cli/claude.js";
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

export interface PrFeedbackSnapshot {
  commentIds: Set<string>;
  reviewIds: Set<string>;
}

export function parseReviewOutcome(logFilePath: string, lastMessageFile?: string): ReviewOutcome {
  const adapter = new ClaudeCodeAdapter();
  return adapter.extractReviewDecision(logFilePath, lastMessageFile ?? "");
}

export function hasNewPrFeedback(before: PrFeedbackSnapshot, after: PrFeedbackSnapshot): boolean {
  for (const id of after.commentIds) {
    if (!before.commentIds.has(id)) return true;
  }
  for (const id of after.reviewIds) {
    if (!before.reviewIds.has(id)) return true;
  }
  return false;
}

async function fetchPrFeedbackSnapshot(prNumber: number, workDir: string): Promise<PrFeedbackSnapshot> {
  const result = await runCommand(
    "gh",
    ["pr", "view", String(prNumber), "--json", "comments,reviews"],
    { cwd: workDir },
  );

  if (result.code !== 0) {
    throw new Error(`Failed to inspect PR feedback: ${result.stderr || result.stdout}`);
  }

  const parsed = JSON.parse(result.stdout) as {
    comments?: Array<{ id?: string }>;
    reviews?: Array<{ id?: string }>;
  };

  return {
    commentIds: new Set((parsed.comments ?? []).flatMap((c) => typeof c.id === "string" ? [c.id] : [])),
    reviewIds: new Set((parsed.reviews ?? []).flatMap((r) => typeof r.id === "string" ? [r.id] : [])),
  };
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

    const feedbackBefore = task.prNumber
      ? await fetchPrFeedbackSnapshot(task.prNumber, workDir)
      : null;

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

    // Parse review outcome from the active CLI output
    const jsonLogFile = `${workDir}/.critter-output-review.json`;
    const lastMessageFile = `${workDir}/.critter-last-message-review.txt`;
    const outcome = ctx.cliAdapter.extractReviewDecision(jsonLogFile, lastMessageFile);

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

    if (outcome.decision === "needs_changes" && task.prNumber && feedbackBefore) {
      const feedbackAfter = await fetchPrFeedbackSnapshot(task.prNumber, workDir);
      if (!hasNewPrFeedback(feedbackBefore, feedbackAfter)) {
        throw new Error("Review returned NEEDS_CHANGES without leaving any PR review or PR comment");
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
