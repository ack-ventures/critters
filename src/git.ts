import { existsSync, readdirSync, rmSync } from "node:fs";
import { logTask, logTaskError, logTaskWarn } from "./logger.js";
import { runCommand, sleep } from "./utils.js";

export async function shallowClone(
  repoUrl: string,
  targetDir: string,
  identifier: string,
): Promise<void> {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logTask(identifier, `Cloning ${repoUrl} → ${targetDir}${attempt > 1 ? ` (attempt ${attempt}/${MAX_RETRIES})` : ""}`);
    const { code, stderr } = await runCommand(
      "git",
      ["clone", "--depth", "1", repoUrl, targetDir],
      { cwd: process.cwd() },
    );
    if (code === 0) return;
    if (attempt < MAX_RETRIES && stderr.includes("ENOENT")) {
      logTaskWarn(identifier, `git clone failed (ENOENT), retrying in ${attempt * 2}s...`);
      // Clean up partial clone if any
      if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
      await sleep(attempt * 2000);
      continue;
    }
    throw new Error(`git clone failed: ${stderr}`);
  }
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
  const { stdout } = await runCommand("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"], { cwd: workDir });
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

export function cleanupStaleWorkDirs(baseDir: string, activeWorkDirs?: Set<string>): void {
  if (!existsSync(baseDir)) return;
  const entries = readdirSync(baseDir, { encoding: "utf-8" });
  for (const entry of entries) {
    const fullPath = `${baseDir}/${entry}`;
    if (activeWorkDirs?.has(fullPath)) continue;
    cleanupWorkDir(fullPath);
  }
}
