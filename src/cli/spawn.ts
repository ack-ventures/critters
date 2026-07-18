import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { logTask, logTaskError, logTaskWarn } from "../logger.js";
import type { PhaseContext } from "../runner/types.js";
import type { SpawnResult } from "../types.js";
import { formatDuration, runCommand, shellEscape, shortRepoName, sleep } from "../utils.js";
import type { CliAdapter } from "./types.js";

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
  return `${title.slice(0, maxLen - 1)}\u2026`;
}

function buildPaneLabel(identifier: string, title: string, phase: string, repoShort?: string): string {
  const base = `${identifier}: ${truncateTitle(title)} / ${phase}`;
  if (repoShort) return `${base} | ${repoShort}`;
  return base;
}

/**
 * Build the colored banner `echo` line for a critter's tmux pane.
 *
 * `windowName` embeds the untrusted issue title, so it MUST be single-quoted via
 * shellEscape: interpolating it into the double-quoted `echo -e "…"` directly (as
 * the old `.replace(/"/g, …)` did) lets `$(…)` / backticks in a title execute as
 * shell when the generated script runs — i.e. arbitrary RCE on the daemon host.
 * The color codes are build-time constants and stay inside the double quotes so
 * `echo -e` still interprets their escape sequences.
 */
export function buildPaneBanner(colorLabel: string, windowName: string, reset: string): string {
  return `echo -e "${colorLabel}━━━ "${shellEscape(windowName)}" ━━━${reset}"`;
}

async function spawnInTmux(
  adapter: CliAdapter,
  prompt: string,
  allowedTools: string[],
  workDir: string,
  maxTurns: number,
  sandbox: string | undefined,
  permissionMode: string | undefined,
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
  const lastMessageFile = `${workDir}/.critter-last-message-${phase}.txt`;
  const errLog = `${workDir}/.critter-err-${phase}.log`;

  // Write prompt to work dir
  writeFileSync(promptFile, prompt);

  // Write display filter if adapter provides one
  const displayFilter = adapter.getDisplayFilter();
  const filterFile = `${workDir}/.critter-filter.jq`;
  if (displayFilter) {
    writeFileSync(filterFile, displayFilter);
  }

  const available = PANE_COLORS.map((_, i) => i).filter(i => !activeColors.has(i));
  const idx = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : Math.floor(Math.random() * PANE_COLORS.length);
  const color = PANE_COLORS[idx];
  const reset = "\\x1b[0m";

  // Build CLI command via adapter
  const cmd = adapter.buildCommand({
    prompt,
    promptFile,
    lastMessageFile,
    allowedTools,
    workDir,
    maxTurns,
    model,
    sandbox,
    permissionMode,
    mcpConfig,
    strictMcpConfig,
  });

  // Build shell script that runs the CLI and pipes through jq for display
  const currentPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
  let script: string;

  if (displayFilter) {
    script = `#!/bin/bash
set -o pipefail
export PATH="$HOME/.bun/bin:$HOME/.local/bin:${currentPath}"
${cmd.env ? Object.entries(cmd.env).map(([k, v]) => v === undefined ? `unset ${k}` : `export ${k}=${shellEscape(v)}`).join("\n") : ""}
${buildPaneBanner(color.label, windowName, reset)}
echo ""
cd ${shellEscape(workDir)}
${cmd.script} \\
  2>${shellEscape(errLog)} | \\
  tee ${shellEscape(jsonLogFile)} | \\
  jq --unbuffered -cr --arg tool_color '${color.toolColor}' -f ${shellEscape(filterFile)}
EXIT_CODE=\${PIPESTATUS[0]}
if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo -e "${color.label}=== ${adapter.name} failed (exit $EXIT_CODE) ===${reset}"
  echo "stderr:"
  cat ${shellEscape(errLog)}
fi
echo $EXIT_CODE > ${shellEscape(exitCodeFile)}
sleep 5
`;
  } else {
    script = `#!/bin/bash
set -o pipefail
export PATH="$HOME/.bun/bin:$HOME/.local/bin:${currentPath}"
${cmd.env ? Object.entries(cmd.env).map(([k, v]) => v === undefined ? `unset ${k}` : `export ${k}=${shellEscape(v)}`).join("\n") : ""}
${buildPaneBanner(color.label, windowName, reset)}
echo ""
cd ${shellEscape(workDir)}
${cmd.script} \\
  2>${shellEscape(errLog)} | \\
  tee ${shellEscape(jsonLogFile)}
EXIT_CODE=\${PIPESTATUS[0]}
if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo -e "${color.label}=== ${adapter.name} failed (exit $EXIT_CODE) ===${reset}"
  echo "stderr:"
  cat ${shellEscape(errLog)}
fi
echo $EXIT_CODE > ${shellEscape(exitCodeFile)}
sleep 5
`;
  }

  writeFileSync(scriptFile, script);
  chmodSync(scriptFile, 0o755);

  logTask(identifier, `Spawning ${adapter.name} in tmux pane "${windowName}" (${phase})`);

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

  const parsed = adapter.parseOutputLog(jsonLogFile, identifier);

  return {
    exitCode,
    stdout: "",
    stderr: "",
    timedOut,
    outputLogPath: jsonLogFile,
    numTurns: parsed.numTurns,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    cacheReadTokens: parsed.cacheReadTokens,
    costUsd: parsed.costUsd,
  };
}

async function spawnSubprocess(
  adapter: CliAdapter,
  prompt: string,
  allowedTools: string[],
  workDir: string,
  maxTurns: number,
  sandbox: string | undefined,
  permissionMode: string | undefined,
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
  const lastMessageFile = `${workDir}/.critter-last-message-${phase}.txt`;
  const errLog = `${workDir}/.critter-err-${phase}.log`;

  // Write prompt to file (avoids ARG_MAX limits for large prompts)
  writeFileSync(promptFile, prompt);

  logTask(identifier, `Spawning ${adapter.name} subprocess: ${buildPaneLabel(identifier, title, phase, repoShort)}`);

  const cmd = adapter.buildCommand({
    prompt,
    promptFile,
    lastMessageFile,
    allowedTools,
    workDir,
    maxTurns,
    model,
    sandbox,
    permissionMode,
    mcpConfig,
    strictMcpConfig,
  });

  const bashCmd = [
    cmd.script,
    ` 2>${shellEscape(errLog)}` +
      ` >${shellEscape(jsonLogFile)}`,
  ].join("");

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

  const parsed = adapter.parseOutputLog(jsonLogFile, identifier);

  // Read stderr for error reporting
  let stderr = "";
  if (existsSync(errLog)) {
    try {
      stderr = readFileSync(errLog, "utf-8");
    } catch {}
  }

  return {
    exitCode,
    stdout: "",
    stderr,
    timedOut,
    outputLogPath: jsonLogFile,
    numTurns: parsed.numTurns,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    cacheReadTokens: parsed.cacheReadTokens,
    costUsd: parsed.costUsd,
  };
}

/**
 * Spawn a CLI for a phase, using the adapter from the phase context.
 * Delegates to tmux pane spawning or subprocess based on config.
 */
export async function spawnForPhase(
  ctx: PhaseContext,
  prompt: string,
  allowedTools: string[],
  phaseTag: string,
): Promise<SpawnResult> {
  const { task, config, workDir, signal, cliAdapter } = ctx;

  // Write meta file so log-resolver knows which adapter to use
  const metaFile = `${workDir}/.critter-meta-${phaseTag}.json`;
  writeFileSync(metaFile, JSON.stringify({ cli: cliAdapter.binary }));

  if (config.daemon.noTmux) {
    return spawnSubprocess(
      cliAdapter, prompt, allowedTools, workDir, ctx.phase.maxTurns, ctx.phase.sandbox,
      ctx.phase.permissionMode,
      task.identifier, task.title, phaseTag, ctx.phase.model,
      task.repoUrl, signal, ctx.mcpConfig, ctx.strictMcpConfig,
    );
  }
  return spawnInTmux(
    cliAdapter, prompt, allowedTools, workDir, ctx.phase.maxTurns, ctx.phase.sandbox,
    ctx.phase.permissionMode,
    task.identifier, task.title, phaseTag, config.daemon.tmuxSession,
    ctx.phase.model, task.repoUrl, signal, ctx.mcpConfig, ctx.strictMcpConfig,
  );
}

// ── Stale pane cleanup ───────────────────────────────────────────────────────

/** Regex to detect critter-titled tmux panes. Captures the issue identifier. */
// Issue key: an uppercase letter followed by uppercase letters/digits, a dash,
// then digits (e.g. ACK-12, ABC2-123 for Jira keys that contain digits).
const CRITTER_PANE_TITLE_RE = /^([A-Z][A-Z0-9]*-\d+): .+ \/ (plan|exec|review|[\w-]+)/;

interface ParsedPane {
  paneId: string;
  pid: string;
  command: string;
  title: string;
  identifier: string | null;
}

/** Parse tmux list-panes output into structured objects. Pure function, unit-testable. */
export function parsePaneList(output: string): ParsedPane[] {
  const panes: ParsedPane[] = [];
  for (const line of output.trim().split("\n")) {
    if (!line.trim()) continue;
    // Format: "#{pane_id} #{pane_pid} #{pane_current_command} #{pane_title}"
    // pane_title may contain spaces, so split into at most 4 parts
    const parts = line.split(" ");
    if (parts.length < 4) continue;
    const [paneId, pid, command, ...titleParts] = parts;
    const title = titleParts.join(" ");
    const match = title.match(CRITTER_PANE_TITLE_RE);
    panes.push({
      paneId,
      pid,
      command,
      title,
      identifier: match ? match[1] : null,
    });
  }
  return panes;
}

export function activeCritterIdentifiersFromPanes(panes: ParsedPane[], mainPaneId?: string): Set<string> {
  const activeIdentifiers = new Set<string>();
  for (const pane of panes) {
    if (mainPaneId && pane.paneId === mainPaneId) continue;
    if (!pane.identifier) continue;
    if (pane.title.startsWith("Critters ")) continue;
    activeIdentifiers.add(pane.identifier);
  }
  return activeIdentifiers;
}

export async function listActiveCritterPaneIdentifiers(
  tmuxSession: string,
  mainPaneId?: string,
): Promise<Set<string>> {
  const hasSession = await runCommand("tmux", ["has-session", "-t", tmuxSession]);
  if (hasSession.code !== 0) return new Set();

  const listResult = await runCommand("tmux", [
    "list-panes", "-t", tmuxSession, "-F",
    "#{pane_id} #{pane_pid} #{pane_current_command} #{pane_title}",
  ]);
  if (listResult.code !== 0) return new Set();

  return activeCritterIdentifiersFromPanes(parsePaneList(listResult.stdout), mainPaneId);
}

export interface StalePane {
  paneId: string;
  title: string;
  reason: string;
}

/**
 * Identify orphaned critter tmux panes.
 * A pane is orphaned if it has a critter-style title but its identifier
 * has no corresponding entry in activeWorkDirs.
 */
export async function cleanupStalePanes(
  tmuxSession: string,
  activeWorkDirs: Set<string>,
  mainPaneId?: string,
  activePaneIdentifiers: Set<string> = new Set(),
): Promise<StalePane[]> {
  // Check if session exists
  const hasSession = await runCommand("tmux", ["has-session", "-t", tmuxSession]);
  if (hasSession.code !== 0) return [];

  // List all panes
  const listResult = await runCommand("tmux", [
    "list-panes", "-t", tmuxSession, "-F",
    "#{pane_id} #{pane_pid} #{pane_current_command} #{pane_title}",
  ]);
  if (listResult.code !== 0) return [];

  const panes = parsePaneList(listResult.stdout);

  // Build set of active identifiers from work dir names
  const activeIdentifiers = new Set<string>();
  for (const dir of activeWorkDirs) {
    const basename = dir.split("/").pop() ?? "";
    const match = basename.replace(/^review-/, "").match(/^([A-Z][A-Z0-9]*-\d+)/);
    if (match) activeIdentifiers.add(match[1]);
  }
  for (const identifier of activePaneIdentifiers) {
    activeIdentifiers.add(identifier);
  }

  const stalePanes: StalePane[] = [];
  for (const pane of panes) {
    // Skip main pane
    if (mainPaneId && pane.paneId === mainPaneId) continue;
    // Skip panes with non-critter titles (user-created)
    if (!pane.identifier) continue;
    // Skip panes whose title starts with "Critters " (main daemon pane)
    if (pane.title.startsWith("Critters ")) continue;
    // Skip panes for actively-tracked critters
    if (activeIdentifiers.has(pane.identifier)) continue;

    stalePanes.push({
      paneId: pane.paneId,
      title: pane.title,
      reason: `no active work dir for ${pane.identifier}`,
    });
  }

  return stalePanes;
}

/**
 * Kill identified stale panes. Checks pane count before each kill
 * to avoid destroying the last pane (which would destroy the session).
 */
export async function killStalePanes(
  tmuxSession: string,
  panes: StalePane[],
): Promise<{ killed: number; failed: number }> {
  let killed = 0;
  let failed = 0;

  for (const pane of panes) {
    // Check pane count — never kill the last pane
    const countResult = await runCommand("tmux", ["list-panes", "-t", tmuxSession]);
    if (countResult.code !== 0) { failed++; continue; }
    const numPanes = countResult.stdout.trim().split("\n").length;
    if (numPanes <= 1) { failed++; continue; }

    const killResult = await runCommand("tmux", ["kill-pane", "-t", pane.paneId]);
    if (killResult.code === 0) {
      killed++;
    } else {
      failed++;
    }
  }

  return { killed, failed };
}
