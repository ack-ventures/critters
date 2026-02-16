import { log, logError } from "./logger.js";
import { runCommand } from "./utils.js";

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
