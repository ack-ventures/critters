# ACK-64: Log warning when Claude JSON output parsing finds no data

## Summary

The `parseClaudeJsonLog()` function in `src/claude.ts` silently returns `{}` when expected fields (`numTurns`, token counts) aren't found in the Claude stream-json output. This makes it hard to diagnose issues when the output format changes or is corrupted. The fix adds a warning log when parsing completes without finding usage data, and adds a `logTaskWarn` helper to `src/logger.ts` to support task-scoped warnings.

## Files to modify

### 1. `src/logger.ts` — add `logTaskWarn`

Add a new exported function following the existing `logTask` / `logTaskError` pattern:

```typescript
export function logTaskWarn(identifier: string, message: string, ...args: unknown[]): void {
  console.warn(`[${timestamp()}] [${identifier}] WARN: ${message}`, ...args);
}
```

This goes after the `logTaskError` function (after line 18). It uses `console.warn` and a `WARN:` prefix to distinguish from errors, matching the existing pattern of `logTask` (no prefix) and `logTaskError` (`ERROR:` prefix).

### 2. `src/claude.ts` — add `identifier` parameter and warning log

**Change the function signature** (line 125):

```typescript
// Before:
function parseClaudeJsonLog(filePath: string): { numTurns?: number; totalTokens?: number }

// After:
function parseClaudeJsonLog(filePath: string, identifier: string): { numTurns?: number; totalTokens?: number }
```

**Add import** for `logTaskWarn` (line 4):

```typescript
// Before:
import { logTask, logTaskError } from "./logger.js";

// After:
import { logTask, logTaskError, logTaskWarn } from "./logger.js";
```

**Add warning after the parsing loop** — insert between line 149 (end of the `for` loop) and line 151 (`const totalTokens = ...`):

```typescript
    if (numTurns === undefined || (totalInput === 0 && totalOutput === 0)) {
      logTaskWarn(identifier, "Could not parse usage data from Claude output");
    }
```

This checks both conditions independently:
- `numTurns === undefined` means no `result` object with `num_turns` was found
- `totalInput === 0 && totalOutput === 0` means no `assistant` messages with `usage` data were found

Either condition alone warrants a warning since both pieces of data are expected in normal output.

**Update the call site** (line 120):

```typescript
// Before:
const { numTurns, totalTokens } = parseClaudeJsonLog(jsonLogFile);

// After:
const { numTurns, totalTokens } = parseClaudeJsonLog(jsonLogFile, identifier);
```

The `identifier` parameter is already available in the `spawnClaude` function scope (passed as a parameter on line 26).

**Note on the outer catch block** (lines 153-155): The existing catch block handles file read errors and returns `{}`. No warning is added here because `existsSync` already handles the missing-file case on line 126, and a file read error is a different class of problem (filesystem issue, not a parsing issue). The catch block stays as-is.

## Files NOT changed

- `src/types.ts` — no type changes needed; `SpawnResult` already has `numTurns?` and `totalTokens?` as optional
- `src/spawner.ts` — no changes; it receives `SpawnResult` from `spawnClaude` which is unchanged
- Other files — no changes needed

## Dependencies / setup

None. No new packages or configuration needed.

## Testing approach

1. **Smoke test**: Run `bun run src/index.ts` and confirm it starts without errors (the new logger function and parameter don't affect normal startup).
2. **Manual verification with empty output**: Create a test JSON log file with no `result` or `assistant` lines and confirm the warning appears in logs when `parseClaudeJsonLog` is called.
3. **Normal operation**: Process a real task through the system and confirm that when Claude produces valid stream-json output, no warning is logged (i.e., no false positives).
4. **Partial data**: Test with a JSON log that has `assistant` messages with usage but no `result` line — should warn about missing `numTurns`.
5. **Code review**: Verify the import is correct (`logTaskWarn` exported from `logger.ts` and imported in `claude.ts`), the function signature change is consistent, and the call site passes `identifier`.
