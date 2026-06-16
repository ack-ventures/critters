import {
  autoCommit,
  getDefaultBranch,
  hasCommitsOnBranch,
  hasUncommittedChanges,
} from "./git.js";
import { logTaskError } from "./logger.js";
import { extractOwnerRepo, runCommand } from "./utils.js";

export async function salvagePartialProgress(
  workDir: string,
  branch: string,
  identifier: string,
  title: string,
  repoUrl?: string,
  baseBranch?: string,
): Promise<{ prUrl?: string; branchPushed?: boolean }> {
  try {
    const ownerRepo = repoUrl ? extractOwnerRepo(repoUrl) : null;
    const repoArgs = ownerRepo ? ["--repo", ownerRepo] : [];
    const defaultBranch = await getDefaultBranch(workDir, identifier, baseBranch);
    try {
      if (await hasUncommittedChanges(workDir)) {
        await autoCommit(workDir, identifier, `[${identifier}] Auto-commit in-progress work`);
      }
    } catch {
      logTaskError(identifier, "Salvage: auto-commit failed, continuing anyway");
    }

    if (!(await hasCommitsOnBranch(workDir, branch, identifier, baseBranch))) {
      return {};
    }

    // Check if a PR already exists
    const listResult = await runCommand(
      "gh",
      ["pr", "list", "--head", branch, "--json", "url", "--limit", "1", ...repoArgs],
      { cwd: workDir },
    );
    if (listResult.code === 0) {
      try {
        const prs = JSON.parse(listResult.stdout);
        if (prs.length > 0) {
          // A PR already exists, but a resumed attempt (or the auto-commit
          // above) may have produced commits that were never pushed. Push
          // before returning so cleanupWorkDir doesn't delete unpushed work.
          // The push is an idempotent fast-forward when origin is already
          // up to date; only short-circuit if local HEAD is not ahead.
          const pushResult = await runCommand("git", ["push", "origin", branch], { cwd: workDir });
          if (pushResult.code !== 0) {
            logTaskError(identifier, `Salvage: push to existing PR branch failed: ${pushResult.stderr}`);
          }
          return { prUrl: prs[0].url, branchPushed: true };
        }
      } catch {
        // JSON parse failed
      }
    }

    // Push the branch
    const pushResult = await runCommand("git", ["push", "origin", branch], { cwd: workDir });
    if (pushResult.code !== 0) {
      logTaskError(identifier, `Salvage: push failed: ${pushResult.stderr}`);
      return {};
    }

    // Create a draft PR targeting the default branch
    const prResult = await runCommand(
      "gh",
      [
        "pr", "create", "--draft",
        "--head", branch,
        "--base", defaultBranch,
        "--title", `[${identifier}] ${title} (partial)`,
        "--body", "Critter failed mid-execution. See the linked issue for details.",
        ...repoArgs,
      ],
      { cwd: workDir },
    );
    if (prResult.code === 0) {
      return { prUrl: prResult.stdout.trim(), branchPushed: true };
    }

    logTaskError(identifier, `Salvage: draft PR creation failed: ${prResult.stderr}`);
    return { branchPushed: true };
  } catch (err) {
    logTaskError(identifier, `Salvage failed entirely: ${err}`);
    return {};
  }
}

export async function addPrTimeoutComment(
  workDir: string,
  prUrl: string,
  identifier: string,
  timeoutMinutes: number,
  repoUrl?: string,
): Promise<void> {
  try {
    const ownerRepo = repoUrl ? extractOwnerRepo(repoUrl) : null;
    const repoArgs = ownerRepo ? ["--repo", ownerRepo] : [];
    const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1];
    if (!prNumber) return;

    const body = `**Timeout**: Critter \`${identifier}\` timed out after ${timeoutMinutes} minutes. Partial work may have been committed to this branch. See the linked issue for details.`;
    await runCommand("gh", ["pr", "comment", prNumber, "--body", body, ...repoArgs], { cwd: workDir });
  } catch (err) {
    logTaskError(identifier, `Failed to comment on PR: ${err}`);
  }
}

export function buildLogFileList(
  workDir: string,
  identifier: string,
  phases: Array<{ name: string }>,
): Array<{ path: string; name: string }> {
  const logFiles: Array<{ path: string; name: string }> = [];
  for (const phase of phases) {
    const phaseTag = phase.name === "planning" ? "plan" : phase.name === "execution" ? "exec" : phase.name;
    logFiles.push(
      { path: `${workDir}/.critter-output-${phaseTag}.json`, name: `${identifier}-${phaseTag}-output.txt` },
      { path: `${workDir}/.critter-err-${phaseTag}.log`, name: `${identifier}-${phaseTag}-stderr.txt` },
    );
  }
  logFiles.push(
    { path: `${workDir}/critters/plans/${identifier}.md`, name: `${identifier}-plan.md` },
    { path: `${workDir}/critters/plans/${identifier}.checkpoint.md`, name: `${identifier}-checkpoint.md` },
  );
  return logFiles;
}
