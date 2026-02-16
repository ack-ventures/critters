import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logTask, logTaskError } from "./logger.js";
import type { SpawnResult } from "./types.js";
import { sleep } from "./utils.js";

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

  const errLog = `/tmp/critter-err-${identifier}-${phase}.log`;

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

  const paneId = tmuxResult.stdout.trim();

  // Poll for completion
  let timedOut = false;
  while (!existsSync(exitCodeFile)) {
    if (signal?.aborted) {
      timedOut = true;
      await runCommand("tmux", ["kill-pane", "-t", paneId]);
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
  await runCommand("tmux", ["kill-pane", "-t", paneId]).catch(() => {});

  const { numTurns, totalTokens } = parseClaudeJsonLog(jsonLogFile);

  return { exitCode, stdout: "", stderr: "", timedOut, numTurns, totalTokens };
}

function parseClaudeJsonLog(filePath: string): { numTurns?: number; totalTokens?: number } {
  if (!existsSync(filePath)) return {};
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    // Parse lines in reverse to find the result message
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === "result") {
          const numTurns = typeof obj.num_turns === "number" ? obj.num_turns : undefined;
          // Try multiple paths for token counts
          let totalTokens: number | undefined;
          if (obj.usage?.input_tokens != null && obj.usage?.output_tokens != null) {
            totalTokens = obj.usage.input_tokens + obj.usage.output_tokens;
          }
          return { numTurns, totalTokens };
        }
      } catch {
        // Skip non-JSON lines
      }
    }
  } catch {
    // File read error — non-fatal
  }
  return {};
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function runCommand(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d));
    proc.stderr?.on("data", (d) => (stderr += d));
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
