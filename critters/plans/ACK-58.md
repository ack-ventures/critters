# ACK-58: Clean up /tmp/critter-err-*.log files after task completion

## Summary

The stderr log files created by `spawnClaude()` in `src/claude.ts` are written to `/tmp/critter-err-{identifier}-{phase}.log` (line 45). These files live outside the task's work directory, so when `cleanupWorkDir()` runs in the `finally` block of `processTask()` (line 257), the error logs are left behind. On a long-running daemon, they accumulate indefinitely.

**Approach: Option A** — Move the error log files into the task's work directory so they are automatically cleaned up by the existing `cleanupWorkDir()` call. This is the cleanest solution because it requires no new cleanup logic and keeps all task artifacts co-located.

## Files to modify

### 1. `src/claude.ts` — modify

**Change the `errLog` path** (line 45) from a fixed `/tmp/` location to a path inside the work directory:

```typescript
// Before (line 45):
const errLog = `/tmp/critter-err-${identifier}-${phase}.log`;

// After:
const errLog = `${workDir}/.critter-err-${phase}.log`;
```

The `workDir` parameter is already available in `spawnClaude()` (line 24). The file is prefixed with `.critter-` to stay consistent with the other dotfiles already written to `workDir` (`.critter-prompt-{phase}`, `.critter-exit-code-{phase}`, `.critter-run-{phase}.sh`, `.critter-output-{phase}.json`, `.critter-filter.jq`). No need to include `identifier` in the filename since each task gets its own `workDir`.

No other changes in this file are needed — the `errLog` variable is used in the bash script template (lines 61, 69) and is already referenced via the `shellEscape(errLog)` calls, which will work identically with the new path.

### 2. `src/spawner.ts` — modify

**Update the `uploadFailureLogs()` function** (lines 271-276) to reference the new error log paths inside workDir instead of `/tmp/`:

```typescript
// Before (lines 273, 275):
{ path: `/tmp/critter-err-${task.identifier}-plan.log`, name: `${task.identifier}-plan-stderr.txt` },
{ path: `/tmp/critter-err-${task.identifier}-exec.log`, name: `${task.identifier}-exec-stderr.txt` },

// After:
{ path: `${workDir}/.critter-err-plan.log`, name: `${task.identifier}-plan-stderr.txt` },
{ path: `${workDir}/.critter-err-exec.log`, name: `${task.identifier}-exec-stderr.txt` },
```

The `workDir` parameter is already available in `uploadFailureLogs()` (line 267). The upload names (used as attachment display names in Linear) stay the same since they include the identifier for human readability.

## Files NOT changed

- `src/git.ts` — `cleanupWorkDir()` stays as-is; it already does `rmSync(dir, { recursive: true, force: true })` which will delete the new `.critter-err-*.log` files along with everything else in the work directory.
- `src/types.ts` — no type changes needed.
- `src/config.ts` — no configuration changes needed.
- `src/stream-filter.jq` — unrelated.

## Dependencies / setup

None. No new packages, configuration, or environment variables needed.

## Testing approach

1. **Path verification**: Inspect the generated bash script (`.critter-run-{phase}.sh`) in a task's work directory and confirm the `2>` redirect points to `{workDir}/.critter-err-{phase}.log` instead of `/tmp/critter-err-*`.
2. **Cleanup verification**: After a task completes (success or failure), confirm that no `critter-err-*.log` files remain in `/tmp/`. The work directory is removed by `cleanupWorkDir()` and the error logs go with it.
3. **Failure logs still uploaded**: Trigger a task failure and verify that the stderr logs are still uploaded to Linear as attachments (the `uploadFailureLogs()` function runs in the `catch` block _before_ `cleanupWorkDir()` runs in the `finally` block, so the files are still available at upload time).
4. **Smoke test**: Run `bun run src/index.ts`, let a task complete, and verify no orphaned error log files in `/tmp/`.
