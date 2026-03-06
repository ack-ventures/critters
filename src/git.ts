import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { logTask, logTaskError, logTaskWarn } from "./logger.js";
import { withRetry } from "./retry.js";
import { runCommand } from "./utils.js";

export async function shallowClone(
  repoUrl: string,
  targetDir: string,
  identifier: string,
  cwd?: string,
): Promise<void> {
  await withRetry(
    async () => {
      logTask(identifier, `Cloning ${repoUrl} → ${targetDir}`);
      const { code, stderr } = await runCommand(
        "git",
        ["clone", "--depth", "1", repoUrl, targetDir],
        cwd ? { cwd } : undefined,
      );
      if (code !== 0) {
        throw new Error(`git clone failed: ${stderr}`);
      }
    },
    {
      maxRetries: 2,
      baseDelayMs: 2000,
      maxDelayMs: 8000,
      shouldRetry: (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        return msg.includes("ENOENT");
      },
      onRetry: (_error, _attempt, delayMs) => {
        logTaskWarn(identifier, `git clone failed (ENOENT), retrying in ${delayMs}ms...`);
        if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
      },
    },
  );
}

export async function createBranch(
  workDir: string,
  branch: string,
  identifier: string,
): Promise<void> {
  logTask(identifier, `Creating branch ${branch}`);
  const { code, stderr } = await runCommand("git", ["checkout", "-b", branch], { cwd: workDir });
  if (code !== 0) {
    throw new Error(`git checkout -b failed: ${stderr}`);
  }
}

export async function hasCommitsOnBranch(workDir: string, branch: string, identifier: string): Promise<boolean> {
  const defaultBranch = await getDefaultBranch(workDir, identifier);
  const { code, stdout } = await runCommand(
    "git",
    ["log", `${defaultBranch}..${branch}`, "--oneline"],
    { cwd: workDir },
  );
  if (code !== 0) return false;
  return stdout.trim().length > 0;
}

export async function getDefaultBranch(workDir: string, identifier: string): Promise<string> {
  const { code, stdout } = await runCommand("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"], { cwd: workDir });
  if (code !== 0) {
    logTaskWarn(
      identifier,
      "Could not detect default branch (origin/HEAD not set). Falling back to 'main'. Run 'git remote set-head origin --auto' in the repo to fix this.",
    );
    return "main";
  }
  const branch = stdout.trim().replace("origin/", "");
  if (!branch) {
    logTaskWarn(identifier, "Could not detect default branch, falling back to 'main'");
    return "main";
  }
  return branch;
}

export async function hasUncommittedChanges(workDir: string): Promise<boolean> {
  const { stdout } = await runCommand("git", ["status", "--porcelain"], { cwd: workDir });
  return stdout.trim().length > 0;
}

export async function autoCommit(
  workDir: string,
  identifier: string,
  message: string,
): Promise<void> {
  logTask(identifier, "Auto-committing uncommitted changes...");
  await runCommand("git", ["add", "-A"], { cwd: workDir });
  const { code, stderr } = await runCommand("git", ["commit", "-m", message], { cwd: workDir });
  if (code !== 0) {
    logTaskError(identifier, `Auto-commit failed: ${stderr}`);
  }
}

export async function commitFile(
  workDir: string,
  filePath: string,
  message: string,
  identifier: string,
): Promise<void> {
  logTask(identifier, `Committing ${filePath}`);
  const addResult = await runCommand("git", ["add", filePath], { cwd: workDir });
  if (addResult.code !== 0) {
    throw new Error(`git add failed for ${filePath}: ${addResult.stderr}`);
  }
  // Check if anything is actually staged (handles already-committed case)
  const diffResult = await runCommand("git", ["diff", "--cached", "--quiet"], { cwd: workDir });
  if (diffResult.code === 0) {
    logTask(identifier, `Nothing to commit for ${filePath}, skipping`);
    return;
  }
  const commitResult = await runCommand("git", ["commit", "-m", message], { cwd: workDir });
  if (commitResult.code !== 0) {
    throw new Error(`git commit failed: ${commitResult.stderr}`);
  }
}

export function cleanupWorkDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function deleteRemoteBranch(repoUrl: string, branch: string): Promise<void> {
  const { code, stderr } = await runCommand("git", ["push", repoUrl, "--delete", branch]);
  if (code !== 0) {
    throw new Error(`Failed to delete remote branch ${branch}: ${stderr}`);
  }
}

export function cleanupStaleWorkDirs(baseDir: string, activeWorkDirs?: Set<string>, maxAgeMinutes = 60): void {
  if (!existsSync(baseDir)) return;
  const entries = readdirSync(baseDir, { encoding: "utf-8" });
  const maxAgeMs = maxAgeMinutes * 60_000;
  for (const entry of entries) {
    const fullPath = `${baseDir}/${entry}`;
    if (activeWorkDirs?.has(fullPath)) continue;
    try {
      const stats = statSync(fullPath);
      if (Date.now() - stats.mtimeMs < maxAgeMs) continue;
    } catch {
      continue;
    }
    cleanupWorkDir(fullPath);
  }
}
