import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CritterTypeConfig } from "./critter-type.js";
import { STREAM_FILTER } from "./jq-filter.js";
import { logTask, logTaskError, logTaskWarn } from "./logger.js";
import type { Config, SpawnResult } from "./types.js";
import { formatDuration, runCommand, shellEscape, shortRepoName, sleep } from "./utils.js";

// Rotating colors for critter panes — each critter gets a distinct look
const PANE_COLORS = [
  { bg: "colour17",  fg: "colour39",  label: "\x1b[1;36m", toolColor: "\x1b[36m"  },  // cyan
  { bg: "colour52",  fg: "colour209", label: "\x1b[1;33m", toolColor: "\x1b[33m"  },  // yellow
  { bg: "colour22",  fg: "colour119", label: "\x1b[1;32m", toolColor: "\x1b[32m"  },  // green
  { bg: "colour53",  fg: "colour177", label: "\x1b[1;35m", toolColor: "\x1b[35m"  },  // magenta
  { bg: "colour234", fg: "colour255", label: "\x1b[1;37m", toolColor: "\x1b[37m"  },  // white
  { bg: "colour58",  fg: "colour220", label: "\x1b[38;5;220m", toolColor: "\x1b[38;5;220m" },  // amber
  { bg: "colour18",  fg: "colour75",  label: "\x1b[1;34m", toolColor: "\x1b[34m"  },  // blue
  { bg: "colour23",  fg: "colour44",  label: "\x1b[38;5;44m", toolColor: "\x1b[38;5;44m" },  // teal
  { bg: "colour53",  fg: "colour213", label: "\x1b[38;5;213m", toolColor: "\x1b[38;5;213m" },  // pink
  { bg: "colour58",  fg: "colour214", label: "\x1b[38;5;214m", toolColor: "\x1b[38;5;214m" },  // orange
];
const activeColors = new Set<number>();

function truncateTitle(title: string, maxLen = 40): string {
  if (title.length <= maxLen) return title;
  return `${title.slice(0, maxLen - 1)}…`;
}

function buildPaneLabel(identifier: string, title: string, phase: string, repoShort?: string): string {
  const base = `${identifier}: ${truncateTitle(title)} / ${phase}`;
  if (repoShort) return `${base} | ${repoShort}`;
  return base;
}

export function resolveMcpConfig(
  critterType: CritterTypeConfig,
  config: Config,
): { mcpConfig: string[]; strictMcpConfig: boolean } {
  const raw = critterType.mcpConfig ?? config.mcpConfig;
  const strict = critterType.strictMcpConfig ?? config.strictMcpConfig ?? false;

  if (!raw) return { mcpConfig: [], strictMcpConfig: strict };

  const paths = Array.isArray(raw) ? raw : [raw];
  const resolved = paths.map(p =>
    p.startsWith("~") ? join(homedir(), p.slice(1)) : p
  );

  return { mcpConfig: resolved, strictMcpConfig: strict };
}

export async function spawnClaude(
  prompt: string,
  allowedTools: string[],
  workDir: string,
  maxTurns: number,
  identifier: string,
  title: string,
  phase: string,
  tmuxSession: string,
  model: string,
  repoUrl: string,
  signal?: AbortSignal,
  mcpConfig?: string[],
  strictMcpConfig?: boolean,
): Promise<SpawnResult> {
  const repoShort = shortRepoName(repoUrl);
  const windowName = buildPaneLabel(identifier, title, phase, repoShort);
  const promptFile = `${workDir}/.critter-prompt-${phase}`;
  const exitCodeFile = `${workDir}/.critter-exit-code-${phase}`;
  const scriptFile = `${workDir}/.critter-run-${phase}.sh`;
  const jsonLogFile = `${workDir}/.critter-output-${phase}.json`;

  // Write prompt and jq filter to work dir
  writeFileSync(promptFile, prompt);
  const filterFile = `${workDir}/.critter-filter.jq`;
  writeFileSync(filterFile, STREAM_FILTER);

  const available = PANE_COLORS.map((_, i) => i).filter(i => !activeColors.has(i));
  const idx = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : Math.floor(Math.random() * PANE_COLORS.length);
  const color = PANE_COLORS[idx];
  const reset = "\\x1b[0m";

  const errLog = `${workDir}/.critter-err-${phase}.log`;

  const mcpArgs = mcpConfig && mcpConfig.length > 0
    ? mcpConfig.map(p => ` \\\n  --mcp-config ${shellEscape(p)}`).join("")
    : "";
  const strictMcpArg = strictMcpConfig ? " \\\n  --strict-mcp-config" : "";

  // Write a bash script that streams Claude's output via stream-json + jq
  const currentPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
  const script = `#!/bin/bash
set -o pipefail
export PATH="$HOME/.bun/bin:$HOME/.local/bin:${currentPath}"
unset CLAUDECODE
echo -e "${color.label}━━━ ${windowName.replace(/"/g, '\\"')} ━━━${reset}"
echo ""
cd ${shellEscape(workDir)}
claude -p "$(cat ${shellEscape(promptFile)})" \\
  --model ${shellEscape(model)} \\
  --allowedTools ${shellEscape(allowedTools.join(","))} \\
  --max-turns ${maxTurns} \\
  --verbose \\
  --output-format stream-json${mcpArgs}${strictMcpArg} \\
  2>${shellEscape(errLog)} | \\
  tee ${shellEscape(jsonLogFile)} | \\
  jq --unbuffered -cr --arg tool_color '${color.toolColor}' -f ${shellEscape(filterFile)}
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

  // Ensure tmux session exists
  const checkSession = await runCommand("tmux", ["has-session", "-t", tmuxSession]);
  if (checkSession.code !== 0) {
    logTask(identifier, `tmux session "${tmuxSession}" not found, creating it`);
    const createResult = await runCommand("tmux", ["new-session", "-d", "-s", tmuxSession]);
    if (createResult.code !== 0) {
      logTaskError(identifier, `Failed to create tmux session: ${createResult.stderr}`);
      return { exitCode: 1, stdout: "", stderr: createResult.stderr, timedOut: false };
    }
  }

  // Split a new pane in the critters session for this critter
  const tmuxResult = await runCommand("tmux", [
    "split-window", "-t", tmuxSession, "-h", "-d",
    "-P", "-F", "#{pane_id}",
    `/bin/bash ${scriptFile}`,
  ]);

  if (tmuxResult.code !== 0) {
    logTaskError(identifier, `Failed to create tmux pane: ${tmuxResult.stderr}`);
    return { exitCode: 1, stdout: "", stderr: tmuxResult.stderr, timedOut: false };
  }

  activeColors.add(idx);

  // Apply main-horizontal layout so the watcher stays on top
  await runCommand("tmux", ["select-layout", "-t", tmuxSession, "main-horizontal"]).catch(() => {});

  const paneId = tmuxResult.stdout.trim();

  // Label the pane so it's identifiable in the tmux UI
  await runCommand("tmux", ["select-pane", "-t", paneId, "-T", windowName]);
  await runCommand("tmux", ["select-pane", "-t", paneId, "-P", `border-style=fg=${color.fg}`]).catch(() => {});

  // Start periodic pane title update with elapsed time
  const startTime = Date.now();
  const titleInterval = setInterval(() => {
    const elapsed = formatDuration(Date.now() - startTime);
    const updatedTitle = `${buildPaneLabel(identifier, title, phase, repoShort)} | ${elapsed}`;
    runCommand("tmux", ["select-pane", "-t", paneId, "-T", updatedTitle]).catch(() => {});
  }, 10_000);
  titleInterval.unref();

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

  clearInterval(titleInterval);

  // Read results
  let exitCode = 1;

  if (existsSync(exitCodeFile)) {
    const raw = readFileSync(exitCodeFile, "utf-8").trim();
    exitCode = parseInt(raw, 10);
    if (Number.isNaN(exitCode)) exitCode = 1;
  }

  // Clean up the pane (but don't kill the last pane — that would destroy the session)
  const paneCount = await runCommand("tmux", ["list-panes", "-t", tmuxSession]);
  const numPanes = paneCount.stdout.trim().split("\n").length;
  if (numPanes > 1) {
    const cleanupResult = await runCommand("tmux", ["kill-pane", "-t", paneId]);
    if (cleanupResult.code !== 0) {
      logTaskWarn(identifier, `Failed to kill tmux pane during cleanup: ${cleanupResult.stderr}`);
    }
  }

  activeColors.delete(idx);

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

    let skippedLines = 0;

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
        skippedLines++;
      }
    }

    if (skippedLines > 0) {
      logTaskWarn(identifier, `Skipped ${skippedLines} unparseable lines in Claude output`);
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
  } catch (err) {
    logTaskWarn(identifier, `Failed to read Claude output log: ${err}`);
  }
  return {};
}

export async function spawnClaudeSubprocess(
  prompt: string,
  allowedTools: string[],
  workDir: string,
  maxTurns: number,
  identifier: string,
  title: string,
  phase: string,
  model: string,
  repoUrl: string,
  signal?: AbortSignal,
  mcpConfig?: string[],
  strictMcpConfig?: boolean,
): Promise<SpawnResult> {
  const repoShort = shortRepoName(repoUrl);
  const promptFile = `${workDir}/.critter-prompt-${phase}`;
  const jsonLogFile = `${workDir}/.critter-output-${phase}.json`;
  const errLog = `${workDir}/.critter-err-${phase}.log`;

  // Write prompt to file (avoids ARG_MAX limits for large prompts)
  writeFileSync(promptFile, prompt);

  logTask(identifier, `Spawning Claude subprocess: ${buildPaneLabel(identifier, title, phase, repoShort)}`);

  const subMcpArgs = mcpConfig && mcpConfig.length > 0
    ? mcpConfig.map(p => ` --mcp-config ${shellEscape(p)}`).join("")
    : "";
  const subStrictMcpArg = strictMcpConfig ? " --strict-mcp-config" : "";

  const currentPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
  const bashCmd = [
    `export PATH="$HOME/.bun/bin:$HOME/.local/bin:${currentPath}"`,
    "unset CLAUDECODE",
    `cd ${shellEscape(workDir)}`,
    `exec claude -p "$(cat ${shellEscape(promptFile)})"` +
      ` --model ${shellEscape(model)}` +
      ` --allowedTools ${shellEscape(allowedTools.join(","))}` +
      ` --max-turns ${maxTurns}` +
      ` --verbose` +
      ` --output-format stream-json` +
      subMcpArgs +
      subStrictMcpArg +
      ` 2>${shellEscape(errLog)}` +
      ` >${shellEscape(jsonLogFile)}`,
  ].join("\n");

  const proc = Bun.spawn(["/bin/bash", "-c", bashCmd], {
    cwd: workDir,
    stdout: "ignore",
    stderr: "ignore",
  });

  const onAbort = () => proc.kill();
  signal?.addEventListener("abort", onAbort, { once: true });

  let timedOut = false;
  const exitCode = await proc.exited;

  if (signal?.aborted) {
    timedOut = true;
  }

  signal?.removeEventListener("abort", onAbort);

  const { numTurns, inputTokens, outputTokens, cacheReadTokens, costUsd } = parseClaudeJsonLog(jsonLogFile, identifier);

  // Read stderr for error reporting
  let stderr = "";
  if (existsSync(errLog)) {
    try {
      stderr = readFileSync(errLog, "utf-8");
    } catch {}
  }

  return { exitCode, stdout: "", stderr, timedOut, numTurns, inputTokens, outputTokens, cacheReadTokens, costUsd };
}
