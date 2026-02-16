import { spawn } from "child_process";
import { existsSync, rmSync } from "fs";
import { logTask, logTaskError } from "./logger.js";

function run(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function shallowClone(
  repoUrl: string,
  targetDir: string,
  identifier: string,
): Promise<void> {
  logTask(identifier, `Cloning ${repoUrl} → ${targetDir}`);
  const { code, stderr } = await run(
    ["clone", "--depth", "1", repoUrl, targetDir],
    process.cwd(),
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
  const { code, stderr } = await run(["checkout", "-b", branch], workDir);
  if (code !== 0) {
    throw new Error(`git checkout -b failed: ${stderr}`);
  }
}

export async function hasCommitsOnBranch(workDir: string, branch: string): Promise<boolean> {
  const defaultBranch = await getDefaultBranch(workDir);
  const { code, stdout } = await run(
    ["log", `${defaultBranch}..${branch}`, "--oneline"],
    workDir,
  );
  if (code !== 0) return false;
  return stdout.trim().length > 0;
}

export async function getDefaultBranch(workDir: string): Promise<string> {
  const { stdout } = await run(["rev-parse", "--abbrev-ref", "origin/HEAD"], workDir);
  const branch = stdout.trim().replace("origin/", "");
  return branch || "main";
}

export async function hasUncommittedChanges(workDir: string): Promise<boolean> {
  const { stdout } = await run(["status", "--porcelain"], workDir);
  return stdout.trim().length > 0;
}

export async function autoCommit(
  workDir: string,
  identifier: string,
  message: string,
): Promise<void> {
  logTask(identifier, "Auto-committing uncommitted changes...");
  await run(["add", "-A"], workDir);
  const { code, stderr } = await run(["commit", "-m", message], workDir);
  if (code !== 0) {
    logTaskError(identifier, `Auto-commit failed: ${stderr}`);
  }
}

export function cleanupWorkDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function cleanupStaleWorkDirs(baseDir: string): void {
  if (!existsSync(baseDir)) return;
  const { readdirSync } = require("fs");
  const entries = readdirSync(baseDir) as string[];
  for (const entry of entries) {
    const fullPath = `${baseDir}/${entry}`;
    cleanupWorkDir(fullPath);
  }
}
