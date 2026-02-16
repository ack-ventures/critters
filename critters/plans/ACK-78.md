# ACK-78: Add CLI flags and no-tmux quiet mode

## Summary

Add proper CLI arg parsing and a `--no-tmux` flag that runs Claude as a direct child process instead of in tmux panes. In no-tmux mode, there is no terminal output — all logs go to `~/.critters/critters.log`. This enables running critters as a background process (`critters --no-tmux &`).

## Files to modify

### 1. `package.json`

**Changes:**
- Add `"bin"` field pointing to `src/index.ts` so `bun link` makes `critters` available globally:
  ```json
  "bin": {
    "critters": "src/index.ts"
  }
  ```

### 2. `src/index.ts`

**Changes:**
- Add `#!/usr/bin/env bun` shebang as the first line
- Parse CLI args from `Bun.argv` (no library needed):
  - `--no-tmux` — boolean flag for quiet/subprocess mode
- Pass `noTmux` into config object after `loadConfig()` (set it on the returned config)
- When `noTmux` is true:
  - Call `initFileLogging()` from logger.ts to redirect all log output to `~/.critters/critters.log`
  - Skip the two `tmux set` commands (pane-border-status and pane-border-format)
- When `noTmux` is false (default): keep existing behavior unchanged

**Specific code:**
```typescript
#!/usr/bin/env bun

// After loadConfig():
const noTmux = Bun.argv.includes("--no-tmux");
config.noTmux = noTmux;

if (noTmux) {
  initFileLogging();  // redirect console to file
} else {
  // existing tmux pane-title setup
  await runCommand("tmux", ["set", "-t", config.tmuxSession, "pane-border-status", "top"]).catch(() => {});
  await runCommand("tmux", ["set", "-t", config.tmuxSession, "pane-border-format", "#{pane_title}"]).catch(() => {});
}
```

### 3. `src/types.ts`

**Changes:**
- Add `noTmux: boolean` to the `Config` interface

### 4. `src/config.ts`

**Changes:**
- Set `noTmux: false` as the default value in the config object constructed by `loadConfig()`
- This is the static default; `index.ts` will override it from CLI args after loading

### 5. `src/logger.ts`

**Changes:**
- Add `initFileLogging()` export that:
  1. Creates `~/.critters/` directory if it doesn't exist (`mkdirSync` with `recursive: true`)
  2. Opens `~/.critters/critters.log` for appending (using `Bun.file` or `createWriteStream`)
  3. Replaces `console.log`, `console.error`, `console.warn` with versions that write to the log file instead of stdout/stderr
- The timestamp formatting and message format stay exactly the same — only the output destination changes
- Use `appendFileSync` for simplicity (same pattern as other sync file ops in the codebase), or `Bun.write` / `fs.createWriteStream` for a persistent file handle

**Implementation detail:**
```typescript
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let logFile: string | null = null;

export function initFileLogging(): void {
  const dir = join(homedir(), ".critters");
  mkdirSync(dir, { recursive: true });
  logFile = join(dir, "critters.log");
}

function writeLog(level: string, message: string, ...args: unknown[]): void {
  const formatted = `[${timestamp()}] ${level}${message}${args.length > 0 ? " " + args.map(String).join(" ") : ""}\n`;
  if (logFile) {
    appendFileSync(logFile, formatted);
  } else {
    // Use the appropriate console method based on level
    if (level.includes("ERROR")) console.error(formatted.trimEnd());
    else if (level.includes("WARN")) console.warn(formatted.trimEnd());
    else console.log(formatted.trimEnd());
  }
}
```

Each exported function (`log`, `logError`, `logTask`, `logTaskWarn`, `logTaskError`) will call `writeLog` with the appropriate level prefix. When `logFile` is null (default), output goes to console as before. When `logFile` is set, output goes to the file.

### 6. `src/claude.ts`

**Changes:**
- Add a new exported function `spawnClaudeSubprocess()` as an alternative to the existing `spawnClaude()` for no-tmux mode
- The existing `spawnClaude()` function remains untouched
- Alternatively: add a `noTmux` parameter to `spawnClaude()` and branch internally. However, a separate function is cleaner since the two paths share very little logic.

**New function `spawnClaudeSubprocess()`:**

Signature (matches `spawnClaude` minus `tmuxSession`):
```typescript
export async function spawnClaudeSubprocess(
  prompt: string,
  allowedTools: string[],
  workDir: string,
  maxTurns: number,
  identifier: string,
  phase: string,
  signal?: AbortSignal,
): Promise<SpawnResult>
```

Implementation:
1. Write the prompt to `.critter-prompt-{phase}` file (same as tmux path)
2. Define output file paths: `.critter-output-{phase}.json` and `.critter-err-{phase}.log`
3. Build the `claude` command args directly (no bash script, no tmux, no jq piping):
   ```
   claude -p "$(prompt)" --model opus --allowedTools <tools> --max-turns <n> --verbose --output-format stream-json
   ```
4. Spawn via `Bun.spawn()`:
   ```typescript
   const proc = Bun.spawn(["claude", "-p", prompt, "--model", "opus", ...], {
     cwd: workDir,
     stdout: Bun.file(jsonLogFile),  // stream-json output goes to file
     stderr: Bun.file(errLog),       // stderr goes to error log
     env: { ...process.env, CLAUDECODE: undefined },
   });
   ```
5. Handle abort signal — register a listener that kills the process:
   ```typescript
   const onAbort = () => proc.kill();
   signal?.addEventListener("abort", onAbort, { once: true });
   ```
6. Wait for the process to exit: `await proc.exited`
7. Remove the abort listener on completion
8. Reuse `parseClaudeJsonLog()` to extract usage stats (need to make it exported or move to a shared scope — currently it's a module-level function, so it's accessible within the same file)
9. Return `SpawnResult` with exit code, timedOut flag, and usage stats

**Key differences from tmux path:**
- No bash script generation
- No tmux session/pane management
- No jq filtering (no terminal to display to)
- No pane colors/labels
- Direct `Bun.spawn` instead of tmux split-window
- Kill process directly on abort instead of killing tmux pane
- Read prompt from variable directly via `-p` flag (not from file via `cat`)

**Note on prompt passing:** The prompt can be very large. Passing it via command-line arg may hit OS limits. Safer approach: write prompt to file (already done), then use shell to read it:
```typescript
const proc = Bun.spawn(["/bin/bash", "-c", `claude -p "$(cat ${shellEscape(promptFile)})" --model opus ...`], { ... });
```
Or use stdin. Actually, looking at the existing code, it already writes the prompt to a file and reads it via `$(cat ...)` in the bash script — we should do the same for the subprocess path. We'll create a small bash command string that reads from the prompt file.

### 7. `src/spawner.ts`

**Changes:**
- Import `spawnClaudeSubprocess` from `./claude.js`
- In `runTask()`, choose between `spawnClaude()` and `spawnClaudeSubprocess()` based on `this.config.noTmux`:
  ```typescript
  const spawn = this.config.noTmux ? spawnClaudeSubprocess : spawnClaude;
  ```
- When calling the spawn function:
  - For `spawnClaude`: pass `this.config.tmuxSession` as before
  - For `spawnClaudeSubprocess`: omit `tmuxSession` (different signature)
- Track child process handles for signal handling: The existing `activeProcesses` Set<AbortController> already handles this — aborting triggers the abort listener on the child process, which kills it. No change needed here.

**Specific changes in `runTask()`:**

Replace the two `spawnClaude()` calls (planning phase ~line 141, execution phase ~line 180) with a conditional:

```typescript
// Phase 1: Planning
const planResult = this.config.noTmux
  ? await spawnClaudeSubprocess(
      buildPlanningPrompt(task),
      planAllowedTools,
      workDir,
      this.config.maxPlanningTurns,
      task.identifier,
      "plan",
      abortController.signal,
    )
  : await spawnClaude(
      buildPlanningPrompt(task),
      planAllowedTools,
      workDir,
      this.config.maxPlanningTurns,
      task.identifier,
      "plan",
      this.config.tmuxSession,
      abortController.signal,
    );
```

Same pattern for Phase 2 (execution).

### 8. Signal handling

**No changes needed to signal handling in `index.ts`** — the existing pattern already works:

1. `shutdown()` calls `watcher.stop()` which calls `spawner.stop()`
2. `spawner.stop()` aborts all `AbortController`s in `activeProcesses`
3. In tmux mode: the abort handler in `spawnClaude` kills the tmux pane
4. In no-tmux mode: the abort handler in `spawnClaudeSubprocess` kills the child process via `proc.kill()`

The `AbortController` abstraction means the shutdown path is mode-agnostic. The only difference is what happens when `signal.abort` fires — and that's handled within each spawn function.

## Data flow

```
CLI args (Bun.argv)
    │
    ▼
index.ts: parse --no-tmux → config.noTmux = true
    │
    ├─ noTmux=true → initFileLogging() (logger.ts)
    │                 skip tmux pane-title setup
    │
    ▼
Config (with noTmux flag) → Spawner constructor
    │
    ▼
spawner.runTask()
    │
    ├─ noTmux=true  → spawnClaudeSubprocess() (Bun.spawn, direct child process)
    ├─ noTmux=false → spawnClaude() (tmux pane, existing behavior)
    │
    ▼
Abort path:
    ├─ noTmux=true  → proc.kill()
    ├─ noTmux=false → tmux kill-pane
```

## What stays the same

- Default behavior (tmux mode) is completely unchanged
- Polling, Linear integration, git operations, prompt building — all untouched
- JSON log file parsing (`parseClaudeJsonLog`) reused as-is
- Concurrent critters still work — just child processes instead of tmux panes
- Linear comments still provide debugging visibility
- Config file format unchanged (no-tmux is CLI-only, not a YAML setting)

## Edge cases and considerations

1. **Prompt size**: Use the same `$(cat promptFile)` pattern in a bash wrapper to avoid ARG_MAX limits
2. **Process cleanup**: `Bun.spawn` processes are killed via `proc.kill()` which sends SIGTERM by default — sufficient for Claude CLI
3. **Log rotation**: Not in scope — `~/.critters/critters.log` will grow unbounded. Users can set up external log rotation (logrotate, etc.)
4. **Concurrent file logging**: Multiple `appendFileSync` calls from concurrent tasks are safe since each call is atomic for reasonable message sizes (< PIPE_BUF)
5. **tmux not installed**: In no-tmux mode, tmux is never invoked, so it doesn't need to be installed. The prerequisite check doesn't check for tmux (it only checks `claude` and `gh`), so no change needed there.
6. **Mixed mode**: Not supported — all critters in a session use the same mode. This is fine since it's a process-level flag.

## Testing approach

1. **Unit test logger.ts**: Verify `initFileLogging()` creates `~/.critters/` and that subsequent `log()` calls write to the file
2. **Unit test spawnClaudeSubprocess**: Mock `Bun.spawn` to verify correct args, file paths, and abort handling
3. **Integration test**: Run `bun run src/index.ts --no-tmux` with a mock Linear setup and verify:
   - No tmux commands are executed
   - Logs appear in `~/.critters/critters.log`
   - Claude processes are spawned as direct children
4. **Manual test**: Run `critters --no-tmux &` and verify it backgrounds cleanly, logs to file, and responds to SIGTERM
5. **Regression**: Run without `--no-tmux` and verify existing tmux behavior is unchanged
