# ACK-70: Log a warning in getDefaultBranch when falling back to "main"

## Summary

`getDefaultBranch()` in `src/git.ts` silently falls back to `"main"` when `git rev-parse --abbrev-ref origin/HEAD` fails or returns empty (common with shallow clones). Add an `identifier` parameter so it can log a warning via `logTaskWarn` before falling back. Update the internal caller `hasCommitsOnBranch` to pass the identifier through.

## Files to modify

### 1. `src/git.ts` — line 2 (import)

**Change:** Add `logTaskWarn` to the existing import from `./logger.js`.

**Before:**
```typescript
import { logTask, logTaskError } from "./logger.js";
```

**After:**
```typescript
import { logTask, logTaskError, logTaskWarn } from "./logger.js";
```

### 2. `src/git.ts` — lines 44-48 (`getDefaultBranch`)

**Change:** Add an `identifier` parameter. Check if the branch resolved to a non-empty value; if not, log a warning before returning `"main"`.

**Before:**
```typescript
export async function getDefaultBranch(workDir: string): Promise<string> {
  const { stdout } = await runCommand("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"], { cwd: workDir });
  const branch = stdout.trim().replace("origin/", "");
  return branch || "main";
}
```

**After:**
```typescript
export async function getDefaultBranch(workDir: string, identifier: string): Promise<string> {
  const { stdout } = await runCommand("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"], { cwd: workDir });
  const branch = stdout.trim().replace("origin/", "");
  if (!branch) {
    logTaskWarn(identifier, "Could not detect default branch, falling back to 'main'");
    return "main";
  }
  return branch;
}
```

### 3. `src/git.ts` — lines 33-34 (`hasCommitsOnBranch`)

**Change:** Add an `identifier` parameter and pass it through to `getDefaultBranch`.

**Before:**
```typescript
export async function hasCommitsOnBranch(workDir: string, branch: string): Promise<boolean> {
  const defaultBranch = await getDefaultBranch(workDir);
```

**After:**
```typescript
export async function hasCommitsOnBranch(workDir: string, branch: string, identifier: string): Promise<boolean> {
  const defaultBranch = await getDefaultBranch(workDir, identifier);
```

### 4. `src/spawner.ts` — line 198

**Change:** Pass `task.identifier` as the third argument to `hasCommitsOnBranch`.

**Before:**
```typescript
if (!(await hasCommitsOnBranch(workDir, branch))) {
```

**After:**
```typescript
if (!(await hasCommitsOnBranch(workDir, branch, task.identifier))) {
```

## Dependencies / setup

None. Only touches existing source files with no new dependencies.

## Testing approach

- **TypeScript check:** Run `bun run --bun tsc --noEmit` to verify the project compiles without errors after the changes.
- **Grep verification:** Grep for all call sites of `getDefaultBranch` and `hasCommitsOnBranch` to confirm no callers were missed (current grep shows only `spawner.ts:198` calls `hasCommitsOnBranch`, and only `hasCommitsOnBranch` calls `getDefaultBranch`).
- **Functional verification:** The change is small and well-scoped. Review the diffs to confirm the parameter was threaded through correctly and the warning message matches the task spec.
