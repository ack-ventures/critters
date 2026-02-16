# ACK-69: Distinguish "no data" from "corrupted data" in Claude JSON log parsing

## Summary

In `src/claude.ts`, `parseClaudeJsonLog()` silently swallows two categories of errors, making it impossible to distinguish between "no output data" and "corrupted/unparseable output". Fix this by:

1. Tracking per-line JSON parse failures and logging a warning when any lines fail to parse.
2. Logging the outer file-read catch with `logTaskWarn` instead of silently returning empty.

## Files to modify

### 1. `src/claude.ts` — `parseClaudeJsonLog()` (lines 131–187)

#### Change A: Track and report unparseable lines (lines 143–169)

**Add** a counter before the `for` loop to track parse failures.

**Before (lines 143–169):**
```typescript
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "result") {
          // ... existing result handling ...
        }
      } catch {
        // Skip non-JSON lines
      }
    }
```

**After:**
```typescript
    let skippedLines = 0;

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "result") {
          // ... existing result handling (unchanged) ...
        }
      } catch {
        skippedLines++;
      }
    }

    if (skippedLines > 0) {
      logTaskWarn(identifier, `Skipped ${skippedLines} unparseable lines in Claude output`);
    }
```

#### Change B: Log file-read errors (lines 183–185)

**Before:**
```typescript
  } catch {
    // File read error — non-fatal
  }
```

**After:**
```typescript
  } catch (err) {
    logTaskWarn(identifier, `Failed to read Claude output log: ${err}`);
  }
```

## Dependencies / setup

None. Both `logTaskWarn` and `identifier` are already available in scope — `logTaskWarn` is imported at line 4, and `identifier` is a parameter of `parseClaudeJsonLog`.

## Testing approach

- **TypeScript check:** Run `bun run --bun tsc --noEmit` to verify the project compiles without errors.
- **Code review:** Verify `skippedLines` counter is declared before the loop, incremented in the catch block, and checked after the loop completes.
- **Behavioral verification:** The changes are additive (logging only) and do not alter return values or control flow, so there is no risk of breaking existing behavior.
