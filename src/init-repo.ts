import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const TEMPLATE = `# Critters per-repo configuration
# This file is read by the critters daemon after cloning this repo.
# All fields are optional — omit or leave empty to use daemon defaults.

# Extra tools the critter is allowed to use (merged with daemon defaults)
# extraAllowedTools:
#   - "Bash(python:*)"
#   - "Bash(pip:*)"

# Custom prompt appended to the planning phase
# planningPrompt: |
#   Follow the patterns in src/utils/ for new utilities.
#   Always add tests in __tests__/.

# Custom prompt appended to the execution phase
# executionPrompt: |
#   Run \`npm test\` before committing.

# Custom prompt appended to the review phase
# reviewPrompt: |
#   Pay extra attention to SQL injection risks.
`;

export async function runInitRepo(): Promise<void> {
  // Verify we're in a git repo
  const result = spawnSync("git", ["rev-parse", "--git-dir"], { stdio: "pipe" });
  if (result.status !== 0) {
    console.error("Error: not a git repository (or any parent up to mount point)");
    process.exit(1);
  }

  // Check if .critters.yaml already exists
  if (existsSync(".critters.yaml")) {
    console.log(".critters.yaml already exists");
    process.exit(0);
  }

  // Write the template
  writeFileSync(".critters.yaml", TEMPLATE);
  console.log("Created .critters.yaml — edit it to customize critter behavior for this repo");
}
