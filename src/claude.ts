import { spawn } from "child_process";
import { writeFileSync, readFileSync, existsSync, chmodSync } from "fs";
import type { SpawnResult } from "./types.js";
import { logTask, logTaskError } from "./logger.js";
import { sleep } from "./utils.js";

const TMUX_SESSION = "critters";

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

  // Write prompt to file to avoid shell quoting issues
  writeFileSync(promptFile, prompt);

  // Write a bash script that runs claude directly with TTY
  const script = `#!/bin/bash
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "=== Critter ${identifier} (${phase}) ==="
echo "Working in: ${workDir}"
echo "Starting Claude..."
echo ""
cd ${shellEscape(workDir)}
claude -p "$(cat ${shellEscape(promptFile)})" \\
  --model opus \\
  --allowedTools ${shellEscape(allowedTools.join(","))} \\
  --max-turns ${maxTurns}
EXIT_CODE=$?
echo $EXIT_CODE > ${shellEscape(exitCodeFile)}
echo ""
echo "=== Claude exited with code $EXIT_CODE ==="
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
    if (isNaN(exitCode)) exitCode = 1;
  }

  // Clean up the pane (it may already be gone after the script exits)
  await runCommand("tmux", ["kill-pane", "-t", paneId]).catch(() => {});

  return { exitCode, stdout: "", stderr: "", timedOut };
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
