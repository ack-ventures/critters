import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logTask, logTaskError, logTaskWarn } from "./logger.js";
import type { SpawnResult } from "./types.js";
import { runCommand, sleep } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TMUX_SESSION = "critters";

// Rotating colors for critter panes — each critter gets a distinct look
const PANE_COLORS = [
  { bg: "colour17",  fg: "colour39",  label: "\x1b[1;36m" },  // deep blue bg, cyan text
  { bg: "colour52",  fg: "colour209", label: "\x1b[1;33m" },  // dark red bg, orange text
  { bg: "colour22",  fg: "colour119", label: "\x1b[1;32m" },  // dark green bg, lime text
  { bg: "colour53",  fg: "colour177", label: "\x1b[1;35m" },  // purple bg, magenta text
];
let colorIndex = 0;

export async function spawnClaude(
  prompt: string,
  allowedTools: string[],
  workDir: string,
  maxTurns: number,
  identifier: string,
  phase: string,
  signal?: AbortSignal,
): Promise<SpawnResult> {
  const windowName = `${identifier}-${phase}`;
  const promptFile = `${workDir}/.critter-prompt-${phase}`;
  const exitCodeFile = `${workDir}/.critter-exit-code-${phase}`;
  const scriptFile = `${workDir}/.critter-run-${phase}.sh`;
  const jsonLogFile = `${workDir}/.critter-output-${phase}.json`;

  // Write prompt and jq filter to work dir
  writeFileSync(promptFile, prompt);
  const filterFile = `${workDir}/.critter-filter.jq`;
  copyFileSync(join(__dirname, "stream-filter.jq"), filterFile);

  const color = PANE_COLORS[colorIndex % PANE_COLORS.length];
  colorIndex++;
  const reset = "\\x1b[0m";

  const errLog = `${workDir}/.critter-err-${phase}.log`;

  // Write a bash script that streams Claude's output via stream-json + jq
  const script = `#!/bin/bash
set -o pipefail
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
unset CLAUDECODE
echo -e "${color.label}━━━ ${identifier} / ${phase} ━━━${reset}"
echo ""
cd ${shellEscape(workDir)}
claude -p "$(cat ${shellEscape(promptFile)})" \\
  --model opus \\
  --allowedTools ${shellEscape(allowedTools.join(","))} \\
  --max-turns ${maxTurns} \\
  --verbose \\
  --output-format stream-json \\
  2>${shellEscape(errLog)} | \\
  tee ${shellEscape(jsonLogFile)} | \\
  jq --unbuffered -cr -f ${shellEscape(filterFile)}
EXIT_CODE=\${PIPESTATUS[0]}
if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo -e "${color.label}=== Claude failed (exit $EXIT_CODE) ===${reset}"
  echo "stderr:"
  cat ${shellEscape(errLog)}
fi
echo $EXIT_CODE > ${shellEscape(exitCodeFile)}
sleep 5
`;

  writeFileSync(scriptFile, script);
  chmodSync(scriptFile, 0o755);

  logTask(identifier, `Spawning Claude in tmux pane "${windowName}" (${phase})`);

  // Split a new pane in the critters session for this critter
  const tmuxResult = await runCommand("tmux", [
    "split-window", "-t", TMUX_SESSION, "-h", "-d",
    "-P", "-F", "#{pane_id}",
    `/bin/bash ${scriptFile}`,
  ]);

  if (tmuxResult.code !== 0) {
    logTaskError(identifier, `Failed to create tmux pane: ${tmuxResult.stderr}`);
    return { exitCode: 1, stdout: "", stderr: tmuxResult.stderr, timedOut: false };
  }

  // Apply main-horizontal layout so the watcher stays on top
  await runCommand("tmux", ["select-layout", "-t", TMUX_SESSION, "main-horizontal"]).catch(() => {});

  const paneId = tmuxResult.stdout.trim();

  // Label the pane so it's identifiable in the tmux UI
  await runCommand("tmux", ["select-pane", "-t", paneId, "-T", windowName]);

  // Poll for completion
  let timedOut = false;
  while (!existsSync(exitCodeFile)) {
    if (signal?.aborted) {
      timedOut = true;
      const killResult = await runCommand("tmux", ["kill-pane", "-t", paneId]);
      if (killResult.code !== 0) {
        logTaskWarn(identifier, `Failed to kill tmux pane on abort: ${killResult.stderr}`);
      }
      break;
    }
    await sleep(2000);
  }

  // Read results
  let exitCode = 1;

  if (existsSync(exitCodeFile)) {
    const raw = readFileSync(exitCodeFile, "utf-8").trim();
    exitCode = parseInt(raw, 10);
    if (Number.isNaN(exitCode)) exitCode = 1;
  }

  // Clean up the pane (it may already be gone after the script exits)
  const cleanupResult = await runCommand("tmux", ["kill-pane", "-t", paneId]);
  if (cleanupResult.code !== 0) {
    logTaskWarn(identifier, `Failed to kill tmux pane during cleanup: ${cleanupResult.stderr}`);
  }

  const { numTurns, inputTokens, outputTokens, cacheReadTokens, costUsd } = parseClaudeJsonLog(jsonLogFile, identifier);

  return { exitCode, stdout: "", stderr: "", timedOut, numTurns, inputTokens, outputTokens, cacheReadTokens, costUsd };
}

function parseClaudeJsonLog(filePath: string, identifier: string): { numTurns?: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; costUsd?: number } {
  if (!existsSync(filePath)) return {};
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    let numTurns: number | undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let costUsd: number | undefined;

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "result") {
          if (typeof obj.num_turns === "number") {
            numTurns = obj.num_turns;
          }
          if (typeof obj.total_cost_usd === "number") {
            costUsd = obj.total_cost_usd;
          }
          // Use modelUsage from the result event — it has accurate cumulative totals.
          // The assistant event's usage.output_tokens is reported at stream start
          // (before content is generated) so it's nearly always ~1 per turn.
          if (obj.modelUsage && typeof obj.modelUsage === "object") {
            inputTokens = 0;
            outputTokens = 0;
            cacheReadTokens = 0;
            for (const model of Object.values(obj.modelUsage) as Record<string, number>[]) {
              inputTokens += (model.inputTokens ?? 0) + (model.cacheCreationInputTokens ?? 0);
              outputTokens += model.outputTokens ?? 0;
              cacheReadTokens += model.cacheReadInputTokens ?? 0;
            }
          }
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    if (numTurns === undefined || (inputTokens === 0 && outputTokens === 0)) {
      logTaskWarn(identifier, "Could not parse usage data from Claude output");
    }

    return {
      numTurns,
      inputTokens: inputTokens || undefined,
      outputTokens: outputTokens || undefined,
      cacheReadTokens: cacheReadTokens || undefined,
      costUsd,
    };
  } catch {
    // File read error — non-fatal
  }
  return {};
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
