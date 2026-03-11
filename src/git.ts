import { existsSync, readdirSync, rmSync, statfsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { log, logTask, logTaskError, logTaskWarn } from "./logger.js";
import { withRetry } from "./retry.js";
import { runCommand } from "./utils.js";

export function getAvailableSpaceMb(path: string): number {
  const stats = statfsSync(path);
  return Math.floor((stats.bsize * stats.bavail) / (1024 * 1024));
}

export function checkDiskSpace(workDir: string, minDiskSpaceMb: number): void {
  const availableMb = getAvailableSpaceMb(workDir);
  if (availableMb < minDiskSpaceMb) {
    throw new Error(
      `Insufficient disk space: ${availableMb}MB available, ${minDiskSpaceMb}MB required on ${workDir}`
    );
  }
}

export async function shallowClone(
  repoUrl: string,
  targetDir: string,
  identifier: string,
  cwd?: string,
  depth: number = 1,
  localPath?: string,
  minDiskSpaceMb?: number,
): Promise<void> {
  // Check disk space before attempting clone
  if (minDiskSpaceMb != null) {
    const checkDir = cwd ?? dirname(targetDir);
    checkDiskSpace(checkDir, minDiskSpaceMb);
  }

  await withRetry(
    async () => {
      const source = localPath ?? repoUrl;
      const args = localPath
        ? ["clone", "--depth", String(depth), "--no-hardlinks", source, targetDir]
        : ["clone", "--depth", String(depth), source, targetDir];
      logTask(identifier, `Cloning ${source} → ${targetDir} (depth ${depth}${localPath ? ", local" : ""})`);
      const { code, stderr } = await runCommand("git", args, cwd ? { cwd } : undefined);
      if (code !== 0) {
        throw new Error(`git clone failed: ${stderr}`);
      }

      if (localPath) {
        // Point origin back to the remote URL and fetch latest
        await runCommand("git", ["remote", "set-url", "origin", repoUrl], { cwd: targetDir });
        logTask(identifier, "Fetching latest from remote...");
        const fetch = await runCommand("git", ["fetch", "--depth", String(depth), "origin"], { cwd: targetDir });
        if (fetch.code !== 0) {
          logTaskWarn(identifier, `git fetch from remote failed (non-fatal): ${fetch.stderr}`);
        }
      }

      // Ensure origin/HEAD is set from the remote (shallow/local clones may not have it)
      await runCommand("git", ["remote", "set-head", "origin", "--auto"], { cwd: targetDir });

      // Verify we're on the default branch (local clones inherit whatever was checked out)
      const headRef = await runCommand("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: targetDir });
      const defaultBranch = headRef.code === 0
        ? headRef.stdout.trim().replace("refs/remotes/origin/", "")
        : "main";
      const { stdout: currentRef } = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: targetDir });
      if (currentRef.trim() !== defaultBranch) {
        logTask(identifier, `Switching from "${currentRef.trim()}" to default branch "${defaultBranch}"`);
        await runCommand("git", ["checkout", "-B", defaultBranch, `origin/${defaultBranch}`], { cwd: targetDir });
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
  // Ensure we're on the default branch before creating a feature branch
  const defaultBranch = await getDefaultBranch(workDir, identifier);
  const { stdout: currentRef } = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: workDir });
  const currentBranch = currentRef.trim();
  if (currentBranch && currentBranch !== defaultBranch) {
    logTaskWarn(identifier, `On branch "${currentBranch}" instead of "${defaultBranch}", switching before branching`);
    const { code: switchCode, stderr: switchErr } = await runCommand("git", ["checkout", defaultBranch], { cwd: workDir });
    if (switchCode !== 0) {
      // Try fetching the default branch and retrying
      logTaskWarn(identifier, `Could not switch to ${defaultBranch}, fetching from remote...`);
      await runCommand("git", ["fetch", "origin", defaultBranch], { cwd: workDir });
      const retry = await runCommand("git", ["checkout", "-B", defaultBranch, `origin/${defaultBranch}`], { cwd: workDir });
      if (retry.code !== 0) {
        throw new Error(`Cannot switch to default branch "${defaultBranch}" before creating feature branch: ${switchErr}`);
      }
    }
  }

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
  if (entries.length === 0) return;
  log(`Cleaning up stale work directories (${entries.length} entries in ${baseDir})...`);
  const maxAgeMs = maxAgeMinutes * 60_000;
  let removed = 0;
  for (const entry of entries) {
    const fullPath = `${baseDir}/${entry}`;
    if (activeWorkDirs?.has(fullPath)) continue;
    try {
      const stats = statSync(fullPath);
      if (Date.now() - stats.mtimeMs < maxAgeMs) continue;
    } catch {
      continue;
    }
    log(`  Removing stale directory: ${entry}`);
    cleanupWorkDir(fullPath);
    removed++;
  }
  if (removed > 0) log(`Stale cleanup complete (removed ${removed})`);
}
