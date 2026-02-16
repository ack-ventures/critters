# ACK-68: Improve stderr capture in runCommand

## Summary

Fix the `runCommand` error handler in `src/utils.ts` so that both accumulated stderr output and the Node spawn error message are preserved. Currently, the `||` operator discards `err.message` whenever `stderr` is non-empty. The fix combines both strings when both are present.

## Files to modify

### 1. `src/utils.ts` — line 15

**Change:** Replace the `||` operator with a conditional that appends `err.message` to any existing stderr content, separated by a newline.

**Before:**
```typescript
resolve({ code: 1, stdout, stderr: stderr || err.message });
```

**After:**
```typescript
resolve({ code: 1, stdout, stderr: stderr ? `${stderr}\n${err.message}` : err.message });
```

**Rationale:** The `error` event on a child process fires for spawn failures (e.g., `ENOENT` when the command doesn't exist) or other OS-level errors. If the process had already written to stderr before the error occurred, the current code silently drops the spawn error. The fix ensures both pieces of diagnostic information are available to callers.

## Dependencies / setup

None. This is a single-line change with no new dependencies.

## Testing approach

- **TypeScript check:** Run `bun run --bun tsc --noEmit` to verify the project still compiles.
- **Grep verification:** Confirm the old pattern (`stderr || err.message`) no longer exists in `src/utils.ts`.
- **Behavioral reasoning:** The change is semantically safe — callers already expect `stderr` to be a string. The only difference is that in the error path, the string may now contain both the process stderr and the spawn error, newline-separated, instead of only one or the other.
