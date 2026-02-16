# ACK-57: Log tmux pane kill failures instead of swallowing errors

## Summary

In `src/claude.ts`, tmux pane kill errors are silently swallowed with `.catch(() => {})`, giving no visibility when panes can't be cleaned up. This change adds proper warning-level logging so operators can detect zombie panes in a long-running daemon.

A new `logTaskWarn` function is needed in `src/logger.ts` since only `logTask` and `logTaskError` exist today. Warning level is appropriate here — a failed pane kill is not a task-breaking error, but it is noteworthy.

**Important detail:** `runCommand` in `src/utils.ts` always resolves (never rejects). It returns `{ code: number; stdout: string; stderr: string }`. The existing `.catch(() => {})` calls are actually dead code — they never execute. The fix must check the resolved result's `code` property instead.

## Files to modify

### 1. `src/logger.ts` — Add `logTaskWarn`

Add a new exported function following the existing pattern:

```typescript
export function logTaskWarn(identifier: string, message: string, ...args: unknown[]): void {
  console.warn(`[${timestamp()}] [${identifier}] WARN: ${message}`, ...args);
}
```

This mirrors `logTaskError` but uses `console.warn` and a `WARN:` prefix.

### 2. `src/claude.ts` — Replace silent catches with exit-code checks and warning logs

**Import change (line 4):** Add `logTaskWarn` to the import from `./logger.js`:

```typescript
import { logTask, logTaskError, logTaskWarn } from "./logger.js";
```

**Line 102 (abort signal handler):** The `kill-pane` call inside the abort handler currently has no error handling at all. Since `runCommand` never rejects, it won't throw, but failures are invisible. Replace:

```typescript
await runCommand("tmux", ["kill-pane", "-t", paneId]);
```

with:

```typescript
const killResult = await runCommand("tmux", ["kill-pane", "-t", paneId]);
if (killResult.code !== 0) {
  logTaskWarn(identifier, `Failed to kill tmux pane on abort: ${killResult.stderr}`);
}
```

**Line 118 (cleanup after completion):** Replace the silent `.catch(() => {})`:

```typescript
await runCommand("tmux", ["kill-pane", "-t", paneId]).catch(() => {});
```

with:

```typescript
const cleanupResult = await runCommand("tmux", ["kill-pane", "-t", paneId]);
if (cleanupResult.code !== 0) {
  logTaskWarn(identifier, `Failed to kill tmux pane during cleanup: ${cleanupResult.stderr}`);
}
```

### Not changed

**Line 93** (`select-layout` catch) — This is a layout hint, not a pane kill. The issue scope is specifically about pane kill failures, so this is left as-is.

## Dependencies

None. Uses only existing infrastructure (`src/logger.ts`, `console.warn`).

## Testing approach

- **Manual verification:** Run the daemon, kill a tmux pane externally before the cleanup runs, and confirm the warning is logged with the expected format including the tmux stderr output.
- **Code review:** Confirm both call sites check `result.code !== 0` and log `result.stderr` (not `err.message`, since `runCommand` never rejects).
- **Grep check:** After implementation, verify no `.catch(() => {})` remains on any `kill-pane` call in `src/claude.ts`.
