import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { loadConfig } from "./config.js";
import { createTracker } from "./tracker/index.js";

function loadEnv(): void {
  const cwdEnv = "./.env";
  const userEnv = `${homedir()}/.critters/.env`;
  if (!existsSync(cwdEnv) && existsSync(userEnv)) {
    const envContent = readFileSync(userEnv, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

export async function runRetry(identifier: string, force: boolean): Promise<void> {
  loadEnv();

  const config = loadConfig();

  // Find which provider handles this identifier's trigger label.
  // For retry, we need to figure out which tracker to use. We'll try the default
  // provider first since we don't know which critter type this issue belongs to.
  const tracker = createTracker({
    type: config.provider,
    apiKey: config.linearApiKey,
    host: config.jiraHost,
    email: config.jiraEmail,
    apiToken: config.jiraApiToken,
    statusMap: config.jiraStatusMap,
  });

  const issue = await tracker.findIssueByIdentifier(identifier);
  if (!issue) {
    console.error(`Error: Issue ${identifier} not found.`);
    process.exit(1);
  }

  // Check that the issue has at least one trigger label from the configured critter types
  const triggerLabels = new Set(config.critterTypes.map((ct) => ct.trigger.label));
  const hasTriggerLabel = issue.labels.some((l) => triggerLabels.has(l));
  if (!hasTriggerLabel) {
    const labelList = [...triggerLabels].map((l) => `"${l}"`).join(" or ");
    console.error(
      `Error: ${identifier} isn't a critter task (missing ${labelList} label).`,
    );
    process.exit(1);
  }

  const statusName = issue.statusName;

  if (statusName === "Todo") {
    console.log(
      `${identifier} is already in Todo — it will be picked up on the next poll.`,
    );
    return;
  }

  if (statusName === "In Progress" || statusName === "In Review") {
    console.error(`Error: ${identifier} is currently being worked on.`);
    process.exit(1);
  }

  if (statusName === "Critter Failed") {
    // Always allowed — no force needed
  } else if (statusName === "Human Review") {
    if (!force) {
      console.error(
        `Error: ${identifier} was flagged for human review. Use --force to override.`,
      );
      process.exit(1);
    }
  } else if (statusName === "Done") {
    if (!force) {
      console.error(`Error: ${identifier} is already completed.`);
      process.exit(1);
    }
  } else {
    if (!force) {
      console.error(
        `Error: ${identifier} is in unexpected status '${statusName}'. Use --force to override.`,
      );
      process.exit(1);
    }
  }

  await tracker.updateStatus(issue.id, "Todo", issue.groupId);
  await tracker.comment(issue.id, "Retry triggered via CLI");

  console.log(
    `Retried ${identifier} — status set to Todo. The daemon will pick it up on the next poll cycle.`,
  );
}
