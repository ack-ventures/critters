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
  const logFile = `${workDir}/.critter-log-${phase}`;
  const scriptFile = `${workDir}/.critter-run-${phase}.sh`;

  // Write prompt to file to avoid shell quoting issues
  writeFileSync(promptFile, prompt);

  // Write a bash script that runs claude and captures the exit code
  const script = `#!/bin/bash
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd ${shellEscape(workDir)}
claude -p "$(cat ${shellEscape(promptFile)})" \\
  --model opus \\
  --allowedTools ${shellEscape(allowedTools.join(","))} \\
  --max-turns ${maxTurns} \\
  2>&1 | tee ${shellEscape(logFile)}
echo \${PIPESTATUS[0]} > ${shellEscape(exitCodeFile)}
`;

  writeFileSync(scriptFile, script);
  chmodSync(scriptFile, 0o755);

  logTask(identifier, `Spawning Claude in tmux window "${windowName}" (${phase})`);

  // Create tmux window running the bash script
  const tmuxResult = await runCommand("tmux", [
    "new-window", "-t", TMUX_SESSION, "-n", windowName, `/bin/bash ${scriptFile}`,
  ]);

  if (tmuxResult.code !== 0) {
    logTaskError(identifier, `Failed to create tmux window: ${tmuxResult.stderr}`);
    return { exitCode: 1, stdout: "", stderr: tmuxResult.stderr, timedOut: false };
  }

  // Poll for completion
  let timedOut = false;
  while (!existsSync(exitCodeFile)) {
    if (signal?.aborted) {
      timedOut = true;
      await runCommand("tmux", ["kill-window", "-t", `${TMUX_SESSION}:${windowName}`]);
      break;
    }
    await sleep(2000);
  }

  // Read results
  let exitCode = 1;
  let stdout = "";

  if (existsSync(exitCodeFile)) {
    const raw = readFileSync(exitCodeFile, "utf-8").trim();
    exitCode = parseInt(raw, 10);
    if (isNaN(exitCode)) exitCode = 1;
  }

  if (existsSync(logFile)) {
    stdout = readFileSync(logFile, "utf-8");
  }

  // Clean up the tmux window (it may already be gone)
  await runCommand("tmux", ["kill-window", "-t", `${TMUX_SESSION}:${windowName}`]).catch(() => {});

  return { exitCode, stdout, stderr: "", timedOut };
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
