# ACK-59: Run periodic stale work directory cleanup

## Summary

Currently, `cleanupStaleWorkDirs()` only runs once at startup (`src/index.ts:32`). If the daemon runs for extended periods, stale directories from crashed or timed-out tasks accumulate in the `workDir` and consume disk space. This change adds a periodic interval that re-runs cleanup, and properly clears it on shutdown.

**Key insight**: The existing `cleanupStaleWorkDirs()` deletes *all* entries in workDir unconditionally. This is safe at startup (nothing is running), but calling it periodically would destroy active work directories. The periodic cleanup must skip directories belonging to in-progress tasks.

## Files to modify

### `src/spawner.ts`

**Changes:**

1. Add two new private fields to the `Spawner` class (after `private stopped = false;` on line 37):
   ```typescript
   private cleanupInterval: Timer | null = null;
   private activeWorkDirs = new Set<string>();
   ```

2. Add `log` to the imports from `./logger.js`:
   ```typescript
   import { log, logTask, logTaskError } from "./logger.js";
   ```

3. Track active work directories in `runTask()`. Add the workDir to the set right after it's defined (line 80), and remove it in the `finally` block (line 254):
   ```typescript
   // In runTask(), after line 80 (const workDir = ...):
   this.activeWorkDirs.add(workDir);

   // In the finally block (around line 254), add before cleanupWorkDir(workDir):
   this.activeWorkDirs.delete(workDir);
   ```

4. Update the `cleanupStale()` method (line 44) to pass active dirs:
   ```typescript
   cleanupStale(): void {
     cleanupStaleWorkDirs(this.config.workDir, this.activeWorkDirs);
   }
   ```

5. Add a new method `startPeriodicCleanup()`:
   ```typescript
   startPeriodicCleanup(): void {
     const intervalMs = 60 * 60 * 1000; // 1 hour
     this.cleanupInterval = setInterval(() => {
       log("Running periodic stale work directory cleanup");
       this.cleanupStale();
     }, intervalMs);
     // Allow the process to exit even if the interval is still active
     this.cleanupInterval.unref();
   }
   ```

6. Update the `stop()` method (line 56) to clear the interval:
   ```typescript
   stop(): void {
     this.stopped = true;
     if (this.cleanupInterval) {
       clearInterval(this.cleanupInterval);
       this.cleanupInterval = null;
     }
     for (const ac of this.activeProcesses) {
       ac.abort();
     }
   }
   ```

### `src/git.ts`

**Changes:**

1. Update `cleanupStaleWorkDirs` signature to accept an optional set of active directories to skip:
   ```typescript
   export function cleanupStaleWorkDirs(baseDir: string, activeWorkDirs?: Set<string>): void {
     if (!existsSync(baseDir)) return;
     const entries = readdirSync(baseDir, { encoding: "utf-8" });
     for (const entry of entries) {
       const fullPath = `${baseDir}/${entry}`;
       if (activeWorkDirs?.has(fullPath)) continue;
       cleanupWorkDir(fullPath);
     }
   }
   ```
   - The `activeWorkDirs` parameter is optional, so the existing startup call (which passes no active dirs since nothing is running) continues to work unchanged.
   - At startup, `activeWorkDirs` is an empty set, so all directories are cleaned — same behavior as before.

### `src/index.ts`

**Changes:**

1. After the existing `spawner.cleanupStale()` call (line 32), add:
   ```typescript
   spawner.startPeriodicCleanup();
   ```
   This starts the periodic cleanup right after the initial one-time cleanup.

No other shutdown changes needed — the interval is cleared via `spawner.stop()`, which is already called by `watcher.stop()` (line 36 of `watcher.ts`), which is called in the shutdown handler (line 41 of `index.ts`).

## Design decisions

- **Track active work directories in Spawner**: The Spawner already tracks `activeProcesses` for abort control. Adding `activeWorkDirs` follows the same pattern and is the most reliable way to protect in-progress work — no filesystem heuristics or marker files needed.
- **Optional parameter on `cleanupStaleWorkDirs`**: Keeps the function backward-compatible. At startup the set is empty (nothing running), so all directories are cleaned. During periodic runs, active dirs are skipped.
- **Interval in Spawner, not index.ts**: The Spawner already owns the `cleanupStale()` method and the `stop()` lifecycle. Keeping the interval in Spawner means it's co-located with its cleanup responsibility and properly cleared in `stop()`.
- **`unref()` on the timer**: Ensures the interval alone won't keep the process alive if all other work is done. Follows Node.js/Bun best practices for background timers.
- **1-hour interval**: Frequent enough to prevent large accumulation, infrequent enough to avoid unnecessary filesystem scanning. The interval is a constant, not a config value, since this is an internal maintenance concern.
- **No new config option**: Adding a config field for cleanup interval would be over-engineering. If it ever needs tuning, a constant is easy to change.
- **Existing shutdown path is sufficient**: `watcher.stop()` → `spawner.stop()` already handles cleanup. The `cleanupInterval` clear is added to `stop()`, which is already called on SIGINT/SIGTERM.

## Dependencies

None — uses only built-in `setInterval`/`clearInterval` and existing project functions.

## Testing approach

- **Manual**: Run the daemon, verify log output shows periodic cleanup messages at the expected interval (can temporarily reduce interval for testing).
- **Code review**: Verify that `stop()` clears the interval, `unref()` is called, and active work dirs are properly tracked (added before clone, removed in finally block).
- **Edge cases**:
  - `cleanupStaleWorkDirs` already handles the case where `workDir` doesn't exist (returns early), so periodic calls are safe even if the directory is removed externally.
  - Active work dirs are removed in the `finally` block of `runTask`, so they're always cleaned up even on failure/timeout.
  - At startup, `activeWorkDirs` is empty so all directories are cleaned — preserving existing behavior.
