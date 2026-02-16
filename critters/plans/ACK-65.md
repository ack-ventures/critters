# ACK-65: Add .catch() handler for dispatch promise in watcher

## Summary

The `dispatch()` promise chain in `src/watcher.ts:66-73` has a `.then()` but no `.catch()`. If the promise rejects unexpectedly, two things go wrong:

1. The error is silently swallowed (unhandled promise rejection)
2. `activeIssueIds.delete(task.issueId)` never runs, so the issue is permanently stuck and will never be retried

## Files to modify

### `src/watcher.ts`

**Change 1: Update import (line 2)**

Add `logTaskError` to the import from `./logger.js`:

```typescript
// Before:
import { log, logError, logTask } from "./logger.js";

// After:
import { log, logError, logTask, logTaskError } from "./logger.js";
```

**Change 2: Add `.catch()` handler (after line 73)**

Append a `.catch()` to the existing `.then()` chain on `this.spawner.dispatch(task)`:

```typescript
// Before (lines 66-73):
this.spawner.dispatch(task).then((result) => {
  this.activeIssueIds.delete(task.issueId);
  if (result.success) {
    logTask(task.identifier, "Completed successfully");
  } else {
    logTask(task.identifier, `Failed: ${result.error}`);
  }
});

// After:
this.spawner.dispatch(task).then((result) => {
  this.activeIssueIds.delete(task.issueId);
  if (result.success) {
    logTask(task.identifier, "Completed successfully");
  } else {
    logTask(task.identifier, `Failed: ${result.error}`);
  }
}).catch((err) => {
  this.activeIssueIds.delete(task.issueId);
  logTaskError(task.identifier, `Dispatch failed: ${err}`);
});
```

## Why this is correct

- **Cleanup**: The `.catch()` calls `this.activeIssueIds.delete(task.issueId)` so the issue can be retried on the next poll cycle, matching the cleanup in the `.then()` handler.
- **Logging**: Uses `logTaskError(task.identifier, ...)` which is the established error-logging pattern in the codebase (see `src/spawner.ts:227`, `src/spawner.ts:237`, etc.).
- **Import**: `logTaskError` is already exported from `src/logger.ts:21` but not currently imported in `watcher.ts` — the import must be added.

## Dependencies / setup

None — this is a self-contained change in a single file.

## Testing approach

1. **Type check**: Run `bun tsc --noEmit` (or equivalent) to verify the code compiles without errors.
2. **Manual verification**: Read the modified file to confirm the `.catch()` handler is syntactically correct and properly chained.
3. **Behavioral reasoning**: The `Spawner.dispatch()` method (spawner.ts:59-65) wraps `runTask` in a Promise that resolves via `item.resolve(result)`. The `runTask` method has a try/catch/finally that always returns a `CritterResult`. Under normal operation, `dispatch()` should never reject. However, catastrophic failures (e.g., the promise constructor throwing, or the queue processing hitting an unexpected error) could cause a rejection. The `.catch()` ensures these edge cases are handled gracefully.
