# ACK-54: Extract shared `runCommand` utility from duplicated implementations

## Summary

Three files contain nearly identical process-spawning helpers that wrap Node's `child_process.spawn` in a Promise returning `{ code, stdout, stderr }`. Extract a single shared `runCommand` into `src/utils.ts` and update all callers to use it. This eliminates ~30 lines of duplicated boilerplate.

### Current duplicates

| File | Function | Differences from baseline |
|---|---|---|
| `src/prerequisites.ts:4-16` | `runCommand(command, args)` | Has `proc.on("error", ...)` handler |
| `src/claude.ts:161-170` | `runCommand(cmd, args)` | Uses optional chaining (`proc.stdout?.on`) |
| `src/git.ts:5-14` | `run(args, cwd)` | Hardcodes `"git"` as command; accepts `cwd` option |

Additionally, `src/spawner.ts:297-326` has an inline spawn in `detectPr()` that could use the shared utility, but the task description only calls out `prerequisites.ts` and `claude.ts`. We will also refactor `git.ts` since it has the same pattern and the `cwd` option is a useful addition to the shared function. We will **not** refactor `spawner.ts:detectPr` since it has custom per-line JSON parsing logic interleaved with the spawn — changing it would be a larger refactor beyond the scope of this task.

## Shared function design

The shared `runCommand` in `src/utils.ts` should be the **superset** of all three implementations:

```typescript
import { spawn } from "node:child_process";

export function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, options?.cwd ? { cwd: options.cwd } : undefined);
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d));
    proc.stderr?.on("data", (d) => (stderr += d));
    proc.on("error", (err) => {
      resolve({ code: 1, stdout, stderr: stderr || err.message });
    });
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
```

Key design decisions:
- **Optional chaining** (`proc.stdout?.on`) — from `claude.ts`. Safely handles edge cases where stdio streams may be null (e.g., if spawn options change in the future). Harmless when streams exist.
- **`proc.on("error")` handler** — from `prerequisites.ts`. Handles spawn failures (e.g., command not found). Without this, the promise hangs forever if the command doesn't exist. This is the most important capability to include.
- **Optional `cwd`** — from `git.ts`. Passes through to `spawn` options. Only passed when provided, so existing callers without `cwd` are unaffected.
- **Return type** `{ code: number; stdout: string; stderr: string }` — identical across all three.

## Files to modify

### 1. `src/utils.ts` — modify (add `runCommand`)

Add the shared `runCommand` function and the `import { spawn }` at the top.

**Changes:**
- Add `import { spawn } from "node:child_process";` at the top of the file
- Add the `runCommand` function (as shown above) after the existing exports

### 2. `src/prerequisites.ts` — modify (remove local `runCommand`, import shared)

**Changes:**
- Remove `import { spawn } from "node:child_process";` (line 1)
- Remove the local `runCommand` function (lines 4-16)
- Add `import { runCommand } from "./utils.js";` alongside the existing logger import
- All call sites (`runCommand("claude", ...)`, `runCommand("gh", ...)`) remain unchanged — the signature is identical

### 3. `src/claude.ts` — modify (remove local `runCommand`, import shared)

**Changes:**
- Remove `import { spawn } from "node:child_process";` (line 1) — note: this is the only `spawn` import; the script-building code in `spawnClaude` doesn't use Node's `spawn` directly, it writes a bash script
- Remove the local `runCommand` function (lines 161-170)
- Add `runCommand` to the existing `import { sleep } from "./utils.js";` line, making it `import { runCommand, sleep } from "./utils.js";`
- All call sites (`runCommand("tmux", ...)`) remain unchanged — the signature is compatible (the shared version adds optional chaining + error handler, both safe additions)

### 4. `src/git.ts` — modify (remove local `run`, import shared `runCommand`)

**Changes:**
- Remove `import { spawn } from "node:child_process";` (line 1)
- Remove the local `run` function (lines 5-14)
- Add `import { runCommand } from "./utils.js";` alongside the existing imports
- Replace all `run(args, cwd)` calls with `runCommand("git", args, { cwd })`:
  - `shallowClone` (line 22): `run(["clone", ...], process.cwd())` → `runCommand("git", ["clone", ...], { cwd: process.cwd() })`
  - `createBranch` (line 37): `run(["checkout", ...], workDir)` → `runCommand("git", ["checkout", ...], { cwd: workDir })`
  - `hasCommitsOnBranch` (line 45): `run(["log", ...], workDir)` → `runCommand("git", ["log", ...], { cwd: workDir })`
  - `getDefaultBranch` (line 54): `run(["rev-parse", ...], workDir)` → `runCommand("git", ["rev-parse", ...], { cwd: workDir })`
  - `hasUncommittedChanges` (line 60): `run(["status", ...], workDir)` → `runCommand("git", ["status", ...], { cwd: workDir })`
  - `autoCommit` (line 70-71): two `run(...)` calls → `runCommand("git", ...)`
  - `commitFile` (lines 84, 89, 94): three `run(...)` calls → `runCommand("git", ...)`

The return type `{ code, stdout, stderr }` is identical, so all destructuring at call sites works without changes.

## What NOT to change

- `src/spawner.ts` — the `detectPr` function has custom inline JSON parsing logic. Refactoring it would change behavior and is out of scope.
- No new files created — `runCommand` goes into the existing `src/utils.ts`.
- No changes to `src/types.ts` — no new types needed; the return type is an inline object type.

## Testing approach

1. **Type check**: Run `bun run typecheck` (i.e., `tsc --noEmit`) — confirms all imports resolve and call sites match the shared function signature
2. **Lint**: Run `bun run lint` — confirms no Biome errors from the refactor
3. **Smoke test**: Run `bun run src/index.ts` briefly to confirm the prerequisites check passes (this exercises `runCommand` from `src/prerequisites.ts` immediately on startup, calling `claude --version` and `gh auth status`)
4. **Manual review**: Verify that all `spawn` imports in `prerequisites.ts`, `claude.ts`, and `git.ts` are removed and replaced by the `runCommand` import from `utils.js`
