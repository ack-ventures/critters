import { existsSync, readdirSync, rmSync } from "node:fs";
import { logTask, logTaskError } from "./logger.js";
import { runCommand } from "./utils.js";

export async function shallowClone(
  repoUrl: string,
  targetDir: string,
  identifier: string,
): Promise<void> {
  logTask(identifier, `Cloning ${repoUrl} → ${targetDir}`);
  const { code, stderr } = await runCommand(
    "git",
    ["clone", "--depth", "1", repoUrl, targetDir],
    { cwd: process.cwd() },
  );
  if (code !== 0) {
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

export async function hasCommitsOnBranch(workDir: string, branch: string): Promise<boolean> {
  const defaultBranch = await getDefaultBranch(workDir);
  const { code, stdout } = await runCommand(
    "git",
    ["log", `${defaultBranch}..${branch}`, "--oneline"],
    { cwd: workDir },
  );
  if (code !== 0) return false;
  return stdout.trim().length > 0;
}

export async function getDefaultBranch(workDir: string): Promise<string> {
  const { stdout } = await runCommand("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"], { cwd: workDir });
  const branch = stdout.trim().replace("origin/", "");
  return branch || "main";
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

export function cleanupStaleWorkDirs(baseDir: string): void {
  if (!existsSync(baseDir)) return;
  const entries = readdirSync(baseDir, { encoding: "utf-8" });
  for (const entry of entries) {
    const fullPath = `${baseDir}/${entry}`;
    cleanupWorkDir(fullPath);
  }
}
