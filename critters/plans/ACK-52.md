# ACK-52: Add error context logging in uploadFileToIssue

## Summary

The `uploadFileToIssue` function in `src/linear.ts` (lines 120–150) has three early-return `return null` paths with no logging. Add `logError()` calls before each `return null` so failures are diagnosable from logs.

## Files to modify

### 1. `src/linear.ts` — modify

**Change 1: Import `logError`** (line 2)

The file currently imports only `log` from `./logger.js`. Add `logError` to the import:

```typescript
// Before
import { log } from "./logger.js";

// After
import { log, logError } from "./logger.js";
```

**Change 2: Log before `return null` on missing `uploadFile`** (line 128)

```typescript
// Before
if (!uploadFile) return null;

// After
if (!uploadFile) {
  logError("File upload failed: no uploadFile in payload");
  return null;
}
```

**Change 3: Log before `return null` on failed PUT request** (line 141)

```typescript
// Before
if (!resp.ok) return null;

// After
if (!resp.ok) {
  logError(`File upload failed: PUT request returned HTTP ${resp.status}`);
  return null;
}
```

**Notes:**
- There are exactly two `return null` statements in the function (lines 128 and 141). The third scenario mentioned in the task guidance ("no assetUrl in response") does not exist in the current code — the function uses `uploadFile.assetUrl` directly without a null check after the PUT succeeds. Adding a guard for that would change control flow, which the task explicitly prohibits.
- No other files need changes. `logError` is already defined in `src/logger.ts` (line 9).
- The function's return type (`Promise<string | null>`) and control flow are unchanged — only logging is added.

## What NOT to change

- `src/logger.ts` — already has `logError`, no changes needed
- Return type or control flow of `uploadFileToIssue` — task explicitly says don't change these
- No new dependencies or setup required

## Testing approach

1. **Typecheck**: Run `bun run typecheck` — should pass with no errors (the added import and calls use existing types)
2. **Lint**: Run `bun run lint` — should pass (template literal and block formatting match codebase conventions)
3. **Manual verification**: Read the modified file to confirm each `return null` is preceded by a `logError()` call with a descriptive message, and that the import is correct
