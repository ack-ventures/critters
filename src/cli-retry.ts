import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { loadConfig } from "./config.js";
import { commentOnIssue, getIssueByIdentifier, initLinear, updateIssueStatus } from "./linear.js";

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
  initLinear(config);

  const issue = await getIssueByIdentifier(identifier);
  if (!issue) {
    console.error(`Error: Issue ${identifier} not found.`);
    process.exit(1);
  }

  const state = await issue.state;
  const labels = await issue.labels();
  const team = await issue.team;

  const hasTriggerLabel = labels.nodes.some(
    (l: { name: string }) => l.name === config.triggerLabel,
  );
  if (!hasTriggerLabel) {
    console.error(
      `Error: ${identifier} isn't a critter task (missing "${config.triggerLabel}" label).`,
    );
    process.exit(1);
  }

  const statusName = state?.name ?? "Unknown";

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

  // Resolve "Todo" status ID from the issue's team
  if (!team) {
    console.error(`Error: Could not resolve team for ${identifier}.`);
    process.exit(1);
  }

  const states = await team.states();
  const todoState = states.nodes.find(
    (s: { name: string }) => s.name === "Todo",
  );
  if (!todoState) {
    const names = states.nodes.map((s: { name: string }) => s.name);
    throw new Error(
      `No "Todo" status found for team ${team.name}. Available statuses: ${names.join(", ")}`,
    );
  }

  await updateIssueStatus(issue.id, todoState.id);
  await commentOnIssue(issue.id, "Retry triggered via CLI");

  console.log(
    `Retried ${identifier} — status set to Todo. The daemon will pick it up on the next poll cycle.`,
  );
}
