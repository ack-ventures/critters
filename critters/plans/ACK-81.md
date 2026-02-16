# ACK-81: Fix --no-tmux process exiting immediately when backgrounded

## Summary

Running `critters --no-tmux &` causes the process to exit immediately when the parent shell exits (or sometimes immediately upon backgrounding). The root cause is that the process does not handle `SIGHUP`, which is sent to background processes when the controlling terminal closes.

The fix is minimal — add signal handlers in `src/index.ts` for `SIGHUP` and `SIGPIPE` when running in `--no-tmux` mode.

## Files to modify

### 1. `src/index.ts`

**Changes:**

Add `SIGHUP` and `SIGPIPE` signal handlers inside the existing `if (noTmux)` block, **before** `initFileLogging()`, to ensure they are registered as the very first operation after parsing the CLI flag. This eliminates any timing window where a signal could arrive before the handlers are in place.

**Specific code — the existing `if (noTmux)` block (lines 13-16) becomes:**

```typescript
  const noTmux = Bun.argv.includes("--no-tmux");
  if (noTmux) {
    // Ignore SIGHUP (terminal disconnect) and SIGPIPE so the process
    // survives when backgrounded (e.g., `critters --no-tmux &`)
    process.on("SIGHUP", () => {});
    process.on("SIGPIPE", () => {});
    initFileLogging();
  }
```

**Why place it here and not alongside the SIGINT/SIGTERM handlers on lines 66-67:**
- SIGHUP/SIGPIPE need to be ignored as early as possible — before any async work (prerequisite checks, config loading, Linear init) that could be interrupted by a signal.
- SIGINT/SIGTERM trigger graceful shutdown, which requires the watcher and spawner to exist. They must be registered later, after those objects are created.
- Keeping the SIGHUP/SIGPIPE handlers inside the existing `if (noTmux)` block groups all no-tmux mode initialization together.

**Why only in no-tmux mode:**
- In tmux mode, critters runs inside a tmux session which manages terminal lifecycle — SIGHUP doesn't apply.
- Ignoring SIGHUP unconditionally would prevent terminal-exit cleanup in tmux mode, which is undesirable.

**Why SIGPIPE:** The current file-logging implementation doesn't use pipes, so SIGPIPE is not an active threat. However, ignoring it is defensive programming — it prevents crashes if future changes introduce pipe operations or if external process interactions produce a broken pipe. It costs nothing and removes a class of potential failures.

**No changes to SIGINT/SIGTERM handlers:** These should continue to trigger `shutdown()` in both modes. A user sending SIGTERM to the backgrounded process should still shut it down gracefully.

**Note on `nohup`:** Running `nohup critters --no-tmux &` is redundant but harmless — `nohup` already ignores SIGHUP, so our handler doesn't conflict.

## Files NOT modified

- **`src/claude.ts`**: `spawnClaudeSubprocess()` sets `stdout: "ignore"` and `stderr: "ignore"` on child processes (lines 244-245). Child processes don't inherit signal handlers and won't receive SIGHUP from the terminal since they're managed by the parent. No changes needed.
- **`src/logger.ts`**: File logging via `appendFileSync` has no TTY dependency. When `initFileLogging()` has been called, all output goes to `~/.critters/critters.log`. No changes needed.
- **`src/watcher.ts`**: Pure polling loop with `sleep()`. No stdin reads or TTY checks. No changes needed.
- **`src/spawner.ts`**: Dispatches to `spawnClaudeSubprocess()` in no-tmux mode. No TTY dependency. No changes needed.
- **`src/utils.ts`**: `runCommand()` uses `child_process.spawn` which doesn't read from stdin. No changes needed.
- **`src/prerequisites.ts`**: Runs `claude --version` and `gh auth status` — both are non-interactive commands. No changes needed.
- **`src/config.ts`**, **`src/types.ts`**: No changes needed.

## Dependencies

None. This is a two-line addition with no new imports or dependencies.

## Testing approach

1. **Manual test — process stays alive when backgrounded:**
   - Start: `bun run src/index.ts --no-tmux &`
   - Wait 10 seconds
   - Verify with `ps aux | grep critters` that the process is still running
   - This directly tests the reported failure mode (process exiting immediately)

2. **Manual test — backgrounded process survives shell exit:**
   - Start: `bun run src/index.ts --no-tmux &`
   - Note the PID
   - Close/exit the terminal
   - Open a new terminal and verify with `ps aux | grep critters` that the process is still running

3. **Manual test — SIGHUP explicitly ignored:**
   - Start the process: `bun run src/index.ts --no-tmux &`
   - From another terminal, send SIGHUP: `kill -HUP <PID>`
   - Verify the process continues running and logs continue appearing in `~/.critters/critters.log`

4. **Regression — tmux mode unchanged:**
   - Start normally in a tmux session: `bun run src/index.ts`
   - Verify it still works as before (no SIGHUP handler registered, normal shutdown on SIGINT/SIGTERM)

5. **Regression — graceful shutdown still works in no-tmux mode:**
   - Start: `bun run src/index.ts --no-tmux &`
   - Send SIGTERM: `kill <PID>`
   - Verify "Shutting down..." appears in `~/.critters/critters.log` and the process exits cleanly
