import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { LinearClient } from "@linear/sdk";
import { loadWorkDir } from "./config.js";
import { STREAM_FILTER } from "./jq-filter.js";
import { findWorkDirs, newestDir, phaseFileTag, renderReadableLines, resolveCliAdapterForLog } from "./log-resolver.js";

const IDENTIFIER_RE = /^([A-Z]+-\d+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)$/;
const FILTER_TMP_PATH = "/tmp/critters-logs-filter.jq";

type Phase = "planning" | "execution" | "review";

const LINEAR_PHASE_TITLES: Record<Phase, string[]> = {
  planning: ["-plan-output.txt"],
  execution: ["-exec-output.txt"],
  review: ["-review-output.txt"],
};

interface ParsedArgs {
  identifier: string;
  phase?: Phase;
  follow: boolean;
  configPath?: string;
}

function parseArgs(args: string[]): ParsedArgs {
  let identifier: string | undefined;
  let phase: Phase | undefined;
  let follow = false;
  let configPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--phase") {
      const val = args[++i];
      if (val !== "planning" && val !== "execution" && val !== "review") {
        console.error(`Invalid phase: ${val}. Must be one of: planning, execution, review`);
        process.exit(1);
      }
      phase = val;
    } else if (arg === "--follow" || arg === "-f") {
      follow = true;
    } else if (arg === "--config") {
      configPath = args[++i];
    } else if (!arg.startsWith("-")) {
      identifier = arg;
    }
  }

  if (!identifier) {
    console.error("Usage: critters logs <issue-identifier> [--phase planning|execution|review] [--follow|-f] [--config PATH]");
    process.exit(1);
  }

  if (!IDENTIFIER_RE.test(identifier)) {
    console.error(`Invalid issue identifier: ${identifier}. Expected format: ABC-123 or owner/repo#123`);
    process.exit(1);
  }

  return { identifier, phase, follow, configPath };
}

function writeFilterFile(): void {
  writeFileSync(FILTER_TMP_PATH, STREAM_FILTER, "utf-8");
}

async function displayWithJq(logFile: string): Promise<void> {
  writeFilterFile();
  const proc = Bun.spawn(["jq", "-cr", "--arg", "tool_color", "\x1b[36m", "-f", FILTER_TMP_PATH, logFile], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    // jq might not be installed
    if (exitCode === 127) {
      console.error("jq is not installed. Install it with: brew install jq (macOS) or apt install jq (Linux)");
      process.exit(1);
    }
  }
}

function displayWithoutJq(logFile: string): void {
  const content = readFileSync(logFile, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());
  const adapter = resolveCliAdapterForLog(logFile);
  const rendered = renderReadableLines(lines, adapter);
  if (rendered.length > 0) {
    process.stdout.write(`${rendered.join("\n")}\n`);
  }
}

function fileContainsResult(logFile: string): boolean {
  const content = readFileSync(logFile, "utf-8");
  if (content.includes('"type":"result"')) {
    return true;
  }

  const lastMessageFile = logFile.replace(".json", ".txt").replace("/.critter-output-", "/.critter-last-message-");
  return existsSync(lastMessageFile) && statSync(lastMessageFile).size > 0;
}

async function followLogs(logFile: string): Promise<void> {
  const adapter = resolveCliAdapterForLog(logFile);

  // If the run is already complete, just display normally
  if (fileContainsResult(logFile)) {
    if (adapter.getDisplayFilter()) {
      await displayWithJq(logFile);
    } else {
      displayWithoutJq(logFile);
    }
    return;
  }

  if (!adapter.getDisplayFilter()) {
    displayWithoutJq(logFile);
    let fileOffset = statSync(logFile).size;
    const pollInterval = setInterval(async () => {
      try {
        const currentSize = statSync(logFile).size;
        if (currentSize > fileOffset) {
          const slice = await Bun.file(logFile).slice(fileOffset, currentSize).text();
          fileOffset = currentSize;
          const lines = slice.split("\n").filter((line) => line.trim());
          const rendered = renderReadableLines(lines, adapter);
          if (rendered.length > 0) {
            process.stdout.write(`${rendered.join("\n")}\n`);
          }
        }

        if (fileContainsResult(logFile)) {
          clearInterval(pollInterval);
          process.exit(0);
        }
      } catch {
        // Keep polling on transient read errors.
      }
    }, 500);

    process.on("SIGINT", () => {
      clearInterval(pollInterval);
      process.exit(0);
    });
    return await new Promise(() => {});
  }

  writeFilterFile();
  // Interpolate a real ESC byte (not the literal text "\x1b[36m") so jq receives
  // an actual ANSI color code. A raw ESC inside sh single quotes is passed through
  // verbatim, matching what displayWithJq does via --arg tool_color "\x1b[36m".
  const toolColor = "\x1b[36m";
  const proc = Bun.spawn(["sh", "-c", `tail -n +1 -f ${JSON.stringify(logFile)} | jq -cr --unbuffered --arg tool_color '${toolColor}' -f ${JSON.stringify(FILTER_TMP_PATH)}`], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const cleanup = () => {
    try { proc.kill(); } catch {}
  };
  process.on("SIGINT", () => { cleanup(); process.exit(0); });

  // Poll for completion
  const pollInterval = setInterval(() => {
    try {
      if (fileContainsResult(logFile)) {
        // Give jq a moment to process the last event
        setTimeout(() => {
          clearInterval(pollInterval);
          cleanup();
          process.exit(0);
        }, 1000);
      }
    } catch {}
  }, 2000);

  await proc.exited;
  clearInterval(pollInterval);
}

async function showLocalLogs(workDir: string, identifier: string, phase: Phase | undefined, follow: boolean): Promise<boolean> {
  const { critterDirs, reviewDirs } = findWorkDirs(workDir, identifier);

  if (critterDirs.length === 0 && reviewDirs.length === 0) {
    return false;
  }

  // If phase is explicitly set, find the right directory and file
  if (phase) {
    const logFileName = `.critter-output-${phaseFileTag(phase)}.json`;
    let targetDir: string | undefined;

    if (phase === "review") {
      if (reviewDirs.length > 0) {
        targetDir = `${workDir}/${newestDir(reviewDirs)}`;
      }
    } else {
      if (critterDirs.length > 0) {
        targetDir = `${workDir}/${newestDir(critterDirs)}`;
      }
    }

    if (!targetDir) {
      console.error(`No ${phase} logs found for ${identifier}.`);
      return true;
    }

    const logFile = `${targetDir}/${logFileName}`;
    if (!existsSync(logFile)) {
      console.error(`No ${phase} logs found for ${identifier}.`);
      return true;
    }

    if (statSync(logFile).size === 0) {
      console.error(`Log file is empty for ${phase} phase.`);
      return true;
    }

    if (follow) {
      await followLogs(logFile);
    } else {
      if (resolveCliAdapterForLog(logFile).getDisplayFilter()) {
        await displayWithJq(logFile);
      } else {
        displayWithoutJq(logFile);
      }
    }
    return true;
  }

  // Auto-detect: review > execution > planning
  // Check review dirs first
  if (reviewDirs.length > 0) {
    const dir = `${workDir}/${newestDir(reviewDirs)}`;
    const logFile = `${dir}/.critter-output-review.json`;
    if (existsSync(logFile) && statSync(logFile).size > 0) {
      if (follow) {
        await followLogs(logFile);
      } else if (resolveCliAdapterForLog(logFile).getDisplayFilter()) {
        await displayWithJq(logFile);
      } else {
        displayWithoutJq(logFile);
      }
      return true;
    }
  }

  // Check critter dirs for exec then plan
  if (critterDirs.length > 0) {
    const dir = `${workDir}/${newestDir(critterDirs)}`;
    for (const phase of ["execution", "planning"] as Phase[]) {
      const logFile = `${dir}/.critter-output-${phaseFileTag(phase)}.json`;
      if (existsSync(logFile) && statSync(logFile).size > 0) {
        if (follow) {
          await followLogs(logFile);
        } else if (resolveCliAdapterForLog(logFile).getDisplayFilter()) {
          await displayWithJq(logFile);
        } else {
          displayWithoutJq(logFile);
        }
        return true;
      }
    }
  }

  console.error(`No log files found for ${identifier} in work directory.`);
  return true;
}

async function showLinearLogs(identifier: string, phase: Phase | undefined): Promise<void> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error(`No logs found for ${identifier} in work directory.`);
    console.error(`Set LINEAR_API_KEY to check Linear for uploaded logs.`);
    process.exit(1);
  }

  console.error(`Checking Linear for uploaded logs...`);
  const client = new LinearClient({ apiKey });
  const searchResult = await client.searchIssues(identifier);

  const match = searchResult.nodes.find((n) => n.identifier === identifier);
  if (!match) {
    console.error(`Issue ${identifier} not found in Linear.`);
    process.exit(1);
  }

  // Fetch full Issue object (IssueSearchResult doesn't have attachments)
  const issue = await client.issue(match.id);
  const attachments = await issue.attachments();

  // Determine which attachment to show
  const phaseOrder: Phase[] = phase ? [phase] : ["review", "execution", "planning"];
  for (const p of phaseOrder) {
    for (const suffix of LINEAR_PHASE_TITLES[p]) {
      const title = `${identifier}${suffix}`;
      const attachment = attachments.nodes.find((a) => a.title === title);
      if (attachment?.url) {
        const resp = await fetch(attachment.url);
        if (resp.ok) {
          const content = await resp.text();
          process.stdout.write(content);
          return;
        }
      }
    }
  }

  console.error(`No logs found for ${identifier}. Work directory has been cleaned up and no logs were uploaded to Linear.`);
  process.exit(1);
}

export async function runLogs(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  const workDir = loadWorkDir(parsed.configPath);
  const found = await showLocalLogs(workDir, parsed.identifier, parsed.phase, parsed.follow);
  if (found) return;

  await showLinearLogs(parsed.identifier, parsed.phase);
}
