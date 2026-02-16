import { spawn } from "child_process";
import { log, logError } from "./logger.js";

function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) => {
      resolve({ code: 1, stdout, stderr: stderr || err.message });
    });
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function checkPrerequisites(): Promise<void> {
  // Check claude CLI
  const claude = await runCommand("claude", ["--version"]);
  if (claude.code !== 0) {
    logError("claude CLI not found or not working. Install it: https://docs.anthropic.com/en/docs/claude-code");
    process.exit(1);
  }
  const claudeVersion = claude.stdout.trim();

  // Check gh CLI auth
  const ghAuth = await runCommand("gh", ["auth", "status"]);
  if (ghAuth.code !== 0) {
    logError("gh CLI not authenticated. Run: gh auth login");
    process.exit(1);
  }

  // Get gh version
  const ghVer = await runCommand("gh", ["--version"]);
  const ghVersion = ghVer.stdout.trim().split("\n")[0];

  log(`Prerequisites OK: ${claudeVersion}, ${ghVersion}`);
}
