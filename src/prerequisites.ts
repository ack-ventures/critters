import { getCliAdapter } from "./cli/registry.js";
import { formatError, log, logError } from "./logger.js";
import type { Config } from "./types.js";
import { runCommand } from "./utils.js";

export async function checkPrerequisites(config?: Config): Promise<void> {
  // Collect unique CLI names from config
  const cliNames = new Set<string>();
  if (config) {
    cliNames.add(config.cli ?? "claude");
    for (const ct of config.critterTypes) {
      if (ct.cli) cliNames.add(ct.cli);
      for (const phase of ct.phases) {
        if (phase.cli) cliNames.add(phase.cli);
      }
    }
  } else {
    cliNames.add("claude");
  }

  // Check each CLI adapter
  const versions: string[] = [];
  for (const cliName of cliNames) {
    const adapter = getCliAdapter(cliName);
    try {
      const { version } = await adapter.checkPrerequisite();
      versions.push(version);
    } catch (err) {
      logError(`${adapter.name} prerequisite check failed: ${formatError(err)}`);
      process.exit(1);
    }
  }

  // Check gh CLI auth
  const ghAuth = await runCommand("gh", ["auth", "status"]);
  if (ghAuth.code !== 0) {
    logError("gh CLI not authenticated. Run: gh auth login");
    process.exit(1);
  }

  // Get gh version
  const ghVer = await runCommand("gh", ["--version"]);
  const ghVersion = ghVer.stdout.trim().split("\n")[0];

  log(`Prerequisites OK: ${versions.join(", ")}, ${ghVersion}`);
}
