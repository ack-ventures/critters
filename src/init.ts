import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const CRITTERS_DIR = join(homedir(), ".critters");
const CONFIG_PATH = join(CRITTERS_DIR, "config.yaml");
const ENV_PATH = join(CRITTERS_DIR, ".env");
const SERVICE_PATH = join(CRITTERS_DIR, "critters.service");

const PROMPT_FILES = [
  {
    filename: "planning-prompt.md",
    comment: "<!-- Optional: Add extra context for the planning phase here. This content will be appended to the planning prompt. -->",
  },
  {
    filename: "execution-prompt.md",
    comment: "<!-- Optional: Add extra context for the execution phase here. This content will be appended to the execution prompt. -->",
  },
  {
    filename: "review-prompt.md",
    comment: "<!-- Optional: Add extra context for the review phase here. This content will be appended to the review prompt. -->",
  },
];

const DEFAULT_CONFIG = `provider: linear
# provider: jira
# provider: [linear, jira]

pollIntervalSeconds: 120
workDir: /tmp/critters-work
tmuxSession: critters
healthPort: 3847

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
  # Linear project ID or Jira project key → repo config
  # "project-uuid-1":
  #   url: "git@github.com:your-org/your-repo.git"
  #   extraAllowedTools: ["Bash(poetry:*)"]

teamRepos:
  # Fallback: Linear team ID → repo URL
  # "team-uuid-1": "git@github.com:your-org/default-repo.git"

# Jira status mapping (required when using provider: jira)
# jiraStatusMap:
#   "Todo": "To Do"
#   "In Progress": "In Progress"
#   "In Review": "In Review"
#   "Done": "Done"
#   "Critter Failed": "Failed"

critterTypes:
  create:
    trigger: { label: "Critter", status: "Todo", statusType: "unstarted" }
    repo: { clone: true, branch: true }
    phases:
      - name: planning
        prompt: builtin:planning
        model: opus
        maxTurns: 50
        tools: readonly
      - name: execution
        prompt: builtin:execution
        model: opus
        maxTurns: 75
        tools: default
    outcomes:
      success: { status: "In Review" }
      failure: { status: "Critter Failed" }
    concurrency: 2
    timeoutMinutes: 30

  review:
    trigger: { label: "Critter Review", status: "In Review" }
    repo: { clone: true }
    phases:
      - name: review
        prompt: builtin:review
        model: opus
        maxTurns: 30
        tools: review
    outcomes:
      merged: { status: "Done" }
      needsChanges: { status: "Human Review" }
      failure: { status: "Critter Failed" }
    concurrency: 2
    timeoutMinutes: 15
    enrichment: extractPrUrl
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

  // Write prompt placeholder files
  for (const { filename, comment } of PROMPT_FILES) {
    const filePath = join(CRITTERS_DIR, filename);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, `${comment}\n`);
      console.log(`Wrote ${filePath}`);
    } else {
      console.log(`${filePath} already exists, skipping`);
    }
  }

  // Handle .env
  if (existsSync(ENV_PATH)) {
    process.stdout.write(`\n${ENV_PATH} already exists. Overwrite? [y/N] `);
    const answer = (await readLine()).toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      console.log("Keeping existing .env");
      await maybeGenerateSystemdService();
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
    await maybeGenerateSystemdService();
    printSummary();
    return;
  }

  // Prompt for SLACK_WEBHOOK_URL
  process.stdout.write("SLACK_WEBHOOK_URL (optional, press Enter to skip): ");
  const slackUrl = await readLine();

  // Prompt for Slack Bot Token (enables threaded notifications)
  process.stdout.write("SLACK_BOT_TOKEN (optional, enables threaded notifications, press Enter to skip): ");
  const slackBotToken = await readLine();

  let slackChannel = "";
  if (slackBotToken) {
    process.stdout.write("SLACK_CHANNEL (required with bot token, e.g. C0123456789): ");
    slackChannel = await readLine();
  }

  let envContent = `LINEAR_API_KEY=${linearKey}\n`;
  if (slackUrl) {
    envContent += `SLACK_WEBHOOK_URL=${slackUrl}\n`;
  }
  if (slackBotToken) {
    envContent += `SLACK_BOT_TOKEN=${slackBotToken}\n`;
    if (slackChannel) {
      envContent += `SLACK_CHANNEL=${slackChannel}\n`;
    }
  }

  writeFileSync(ENV_PATH, envContent, { mode: 0o600 });
  console.log(`Wrote ${ENV_PATH}`);

  await maybeGenerateSystemdService();
  printSummary();
}

function generateSystemdService(): string {
  const home = homedir();
  return `[Unit]
Description=Critters daemon
After=network.target

[Service]
Type=simple
ExecStart=${process.execPath} --no-tmux --json-logs --config ${home}/.critters/config.yaml
Restart=on-failure
RestartSec=10
Environment=HOME=${home}
Environment=PATH=/usr/local/bin:/usr/bin:/bin:${home}/.local/bin
StandardOutput=journal
StandardError=journal
WorkingDirectory=${home}

[Install]
WantedBy=multi-user.target
`;
}

async function maybeGenerateSystemdService(): Promise<void> {
  if (process.platform !== "linux") return;

  if (existsSync(SERVICE_PATH)) {
    process.stdout.write(`\n${SERVICE_PATH} already exists. Overwrite? [y/N] `);
    const answer = (await readLine()).toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      console.log("Keeping existing service file");
      return;
    }
  } else {
    process.stdout.write("\nGenerate a systemd service file? [y/N] ");
    const answer = (await readLine()).toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      return;
    }
  }

  writeFileSync(SERVICE_PATH, generateSystemdService());
  console.log(`Wrote ${SERVICE_PATH}`);
  console.log("\nTo install the service:");
  console.log(`  sudo cp ${SERVICE_PATH} /etc/systemd/system/`);
  console.log("  sudo systemctl daemon-reload");
  console.log("  sudo systemctl enable --now critters");
  console.log("  journalctl -u critters -f");
}

function printSummary(): void {
  console.log("\n--- Setup complete ---");
  console.log(`  Config: ${CONFIG_PATH}`);
  console.log(`  Env:    ${ENV_PATH}`);
  if (existsSync(SERVICE_PATH)) {
    console.log(`  Service: ${SERVICE_PATH}`);
  }
  console.log(`\nRun 'critters' to start the daemon.`);
}

const decoder = new TextDecoder();

async function readLine(): Promise<string> {
  // Acquire the stdin reader lazily so importing this module (which happens for
  // every subcommand) does not lock stdin process-wide. Release it after each
  // read so other consumers can use stdin once setup is done.
  const reader = Bun.stdin.stream().getReader();
  try {
    const result = await reader.read();
    if (result.value) return decoder.decode(result.value).trim();
    return "";
  } finally {
    reader.releaseLock();
  }
}
