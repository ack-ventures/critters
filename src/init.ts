import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const CRITTERS_DIR = join(homedir(), ".critters");
const CONFIG_PATH = join(CRITTERS_DIR, "config.yaml");
const ENV_PATH = join(CRITTERS_DIR, ".env");

const DEFAULT_CONFIG = `pollIntervalSeconds: 120
concurrency: 2
timeoutMinutes: 30
workDir: /tmp/critters-work
triggerLabel: "Critter"
maxPlanningTurns: 50
maxExecutionTurns: 75
tmuxSession: critters
planningModel: opus
executionModel: opus

defaultAllowedTools:
  - "Read"
  - "Write"
  - "Edit"
  - "Glob"
  - "Grep"
  - "Bash(git:*)"
  - "Bash(gh:*)"
  - "Bash(bun:*)"
  - "Bash(npm:*)"
  - "Bash(npx:*)"
  - "Bash(node:*)"
  - "Bash(tsc:*)"
  - "Bash(ls:*)"
  - "Bash(mkdir:*)"
  - "Bash(cat:*)"

repos:
  # Linear project ID → repo config
  # "project-uuid-1":
  #   url: "git@github.com:your-org/your-repo.git"
  #   extraAllowedTools: ["Bash(poetry:*)"]

teamRepos:
  # Fallback: Linear team ID → repo URL
  # "team-uuid-1": "git@github.com:your-org/default-repo.git"

# Review critter settings
reviewTriggerLabel: "Critter Review"
reviewModel: opus
reviewConcurrency: 2
reviewTimeoutMinutes: 15
maxReviewTurns: 30
`;

export function mergeConfig(
  existingYaml: string,
  defaultYaml: string,
): { merged: string; added: string[] } {
  const existing = parseYaml(existingYaml) as Record<string, unknown> | null;
  const defaults = parseYaml(defaultYaml) as Record<string, unknown>;

  const merged = existing != null ? { ...existing } : {};
  const added: string[] = [];

  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (!(key in merged)) {
      merged[key] = defaultValue;
      added.push(key);
    }
  }

  return { merged: stringifyYaml(merged), added };
}

export async function runInit(): Promise<void> {
  console.log("Critters Setup");
  console.log("==============\n");

  // Create ~/.critters/
  if (!existsSync(CRITTERS_DIR)) {
    mkdirSync(CRITTERS_DIR, { recursive: true });
    console.log(`Created ${CRITTERS_DIR}/`);
  } else {
    console.log(`${CRITTERS_DIR}/ already exists`);
  }

  // Write default config
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, DEFAULT_CONFIG);
    console.log(`Wrote default config to ${CONFIG_PATH}`);
  } else {
    const existingRaw = readFileSync(CONFIG_PATH, "utf-8");
    const { merged, added } = mergeConfig(existingRaw, DEFAULT_CONFIG);

    if (added.length > 0) {
      writeFileSync(CONFIG_PATH, merged);
      const defaults = parseYaml(DEFAULT_CONFIG) as Record<string, unknown>;
      for (const field of added) {
        const value = defaults[field];
        const display = typeof value === "object" ? "(default structure)" : `(default: ${value})`;
        console.log(`Added missing field: ${field} ${display}`);
      }
      console.log("\nNote: YAML comments have been removed during merge.");
    } else {
      console.log("Config is up to date");
    }
  }

  // Handle .env
  if (existsSync(ENV_PATH)) {
    process.stdout.write(`\n${ENV_PATH} already exists. Overwrite? [y/N] `);
    const answer = (await readLine()).toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      console.log("Keeping existing .env");
      printSummary();
      return;
    }
  }

  // Prompt for LINEAR_API_KEY
  console.log("");
  process.stdout.write("LINEAR_API_KEY (required): ");
  const linearKey = await readLine();
  if (!linearKey) {
    console.log("No API key provided. You can set it later in " + ENV_PATH);
    printSummary();
    return;
  }

  // Prompt for SLACK_WEBHOOK_URL
  process.stdout.write("SLACK_WEBHOOK_URL (optional, press Enter to skip): ");
  const slackUrl = await readLine();

  let envContent = `LINEAR_API_KEY=${linearKey}\n`;
  if (slackUrl) {
    envContent += `SLACK_WEBHOOK_URL=${slackUrl}\n`;
  }

  writeFileSync(ENV_PATH, envContent, { mode: 0o600 });
  console.log(`Wrote ${ENV_PATH}`);

  printSummary();
}

function printSummary(): void {
  console.log("\n--- Setup complete ---");
  console.log(`  Config: ${CONFIG_PATH}`);
  console.log(`  Env:    ${ENV_PATH}`);
  console.log(`\nRun 'critters' to start the daemon.`);
}

const stdinReader = Bun.stdin.stream().getReader();
const decoder = new TextDecoder();

async function readLine(): Promise<string> {
  const result = await stdinReader.read();
  if (result.value) return decoder.decode(result.value).trim();
  return "";
}
