# ACK-60: Extract shared phase error handling helper in spawner

## Summary

The planning phase (lines 129-136) and execution phase (lines 173-180) in `src/spawner.ts` have nearly identical error handling: both check `timedOut`, then check `exitCode !== 0`, call `tailLines()` on stderr/stdout, and throw an error. Extract a single `validatePhaseResult()` helper function to eliminate the duplication.

## Files to modify

### 1. `src/spawner.ts` — modify

**Add helper function** (file-private, not exported) after the `Spawner` class and before `uploadFailureLogs`:

```typescript
function validatePhaseResult(
  result: SpawnResult,
  phaseName: string,
  identifier: string,
): void {
  if (result.timedOut) {
    throw new Error(`Timed out during ${phaseName} phase`);
  }

  if (result.exitCode !== 0) {
    const errTail = tailLines(result.stderr || result.stdout, 20);
    throw new Error(`${phaseName} failed (exit ${result.exitCode}):\n${errTail}`);
  }
}
```

**Design notes:**
- The `phaseName` parameter is a capitalized string like `"Planning"` or `"Execution"` — this preserves the exact error message format from the existing code.
- The `identifier` parameter is accepted for potential future logging but is not used in the current implementation. **Update**: On reflection, since the codebase avoids over-engineering, the `identifier` parameter should be omitted — it's not used and can be added later if needed.

**Revised helper signature:**

```typescript
function validatePhaseResult(
  result: SpawnResult,
  phaseName: string,
): void {
  if (result.timedOut) {
    throw new Error(`Timed out during ${phaseName} phase`);
  }

  if (result.exitCode !== 0) {
    const errTail = tailLines(result.stderr || result.stdout, 20);
    throw new Error(`${phaseName} failed (exit ${result.exitCode}):\n${errTail}`);
  }
}
```

**Replace planning phase error handling** (lines 129-136):

Before:
```typescript
      if (planResult.timedOut) {
        throw new Error("Timed out during planning phase");
      }

      if (planResult.exitCode !== 0) {
        const errTail = tailLines(planResult.stderr || planResult.stdout, 20);
        throw new Error(`Planning failed (exit ${planResult.exitCode}):\n${errTail}`);
      }
```

After:
```typescript
      validatePhaseResult(planResult, "Planning");
```

**Replace execution phase error handling** (lines 173-180):

Before:
```typescript
      if (execResult.timedOut) {
        throw new Error("Timed out during execution phase");
      }

      if (execResult.exitCode !== 0) {
        const errTail = tailLines(execResult.stderr || execResult.stdout, 20);
        throw new Error(`Execution failed (exit ${execResult.exitCode}):\n${errTail}`);
      }
```

After:
```typescript
      validatePhaseResult(execResult, "Execution");
```

**Import note:** `SpawnResult` must be added to the existing import from `./types.js` (line 23). Currently the file imports `Config`, `CritterResult`, `CritterTask`, and `TeamStatuses`. Add `SpawnResult` to that list. The `tailLines` import on line 24 is already present.

Updated import (line 23):
```typescript
import type { Config, CritterResult, CritterTask, SpawnResult, TeamStatuses } from "./types.js";
```

## Files NOT changed

- `src/types.ts` — `SpawnResult` is already defined there; no changes needed
- `src/utils.ts` — `tailLines` is already exported; no changes needed
- `src/claude.ts` — not affected

## Error message preservation

The existing error messages follow these exact patterns:
- `"Timed out during planning phase"` / `"Timed out during execution phase"`
- `"Planning failed (exit N):\n..."` / `"Execution failed (exit N):\n..."`

The helper reproduces these exactly with `phaseName` = `"Planning"` or `"Execution"`:
- `"Timed out during ${phaseName} phase"` → `"Timed out during Planning phase"` ✓
  - **Note**: This changes the casing slightly — original has lowercase "planning"/"execution", but the helper uses the capitalized `phaseName`. To preserve exact messages, pass lowercase phase names (`"planning"`, `"execution"`) and capitalize only where needed for the failure message prefix.

**Final decision — use lowercase phase names to preserve exact error messages:**

```typescript
function validatePhaseResult(
  result: SpawnResult,
  phaseName: string,
): void {
  if (result.timedOut) {
    throw new Error(`Timed out during ${phaseName} phase`);
  }

  if (result.exitCode !== 0) {
    const errTail = tailLines(result.stderr || result.stdout, 20);
    const label = phaseName.charAt(0).toUpperCase() + phaseName.slice(1);
    throw new Error(`${label} failed (exit ${result.exitCode}):\n${errTail}`);
  }
}
```

Call sites:
```typescript
validatePhaseResult(planResult, "planning");
validatePhaseResult(execResult, "execution");
```

This produces:
- `"Timed out during planning phase"` ✓ (exact match)
- `"Planning failed (exit N):\n..."` ✓ (exact match)
- `"Timed out during execution phase"` ✓ (exact match)
- `"Execution failed (exit N):\n..."` ✓ (exact match)

## Dependencies / setup

None. No new packages or configuration needed.

## Testing approach

1. **Type check**: Run `bunx tsc --noEmit` to verify no type errors are introduced.
2. **Error message verification**: The extracted helper must produce identical error messages to the original inline code. The plan specifies lowercase `phaseName` with capitalization only in the failure prefix to match exactly.
3. **Behavioral equivalence**: The refactoring is purely structural — no logic changes. The same errors are thrown under the same conditions with the same messages.
4. **Smoke test**: Run `bun run src/index.ts` briefly to confirm the daemon starts without import or syntax errors.
