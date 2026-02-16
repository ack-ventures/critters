# ACK-50: Add safety validation for workDir config path

## Summary

Add a validation function in `src/config.ts` that checks the resolved `workDir` value before returning the config. If `workDir` points to a dangerous path (root, home directory, system directory), the cleanup logic in `src/git.ts` (`cleanupWorkDir` uses `rmSync` with `{ recursive: true, force: true }`, and `cleanupStaleWorkDirs` iterates entries in the base dir and deletes each one) could destroy critical files. The fix is a simple set of string checks that throw an error for unsafe paths.

## Files to modify

### 1. `src/config.ts` — modify

Add a `validateWorkDir(workDir: string): void` function and call it inside `loadConfig()` after the `workDir` value is resolved (line 38) but before returning the config object.

**New function — `validateWorkDir`:**

```typescript
function validateWorkDir(workDir: string): void {
  const resolved = workDir.startsWith("/") ? workDir : `${process.cwd()}/${workDir}`;
  // Normalize: remove trailing slashes, collapse double slashes
  const normalized = resolved.replace(/\/+/g, "/").replace(/\/$/, "");

  // Block root
  if (normalized === "" || normalized === "/") {
    throw new Error(`Unsafe workDir "${workDir}": must not be the root directory`);
  }

  // Block home directories
  if (/^\/(Users|home)(\/[^/]+)?$/.test(normalized)) {
    throw new Error(`Unsafe workDir "${workDir}": must not be a home directory`);
  }

  // Block system directories
  const systemPrefixes = ["/etc", "/var", "/usr", "/bin", "/sbin", "/lib", "/opt", "/System", "/Library", "/Applications"];
  for (const prefix of systemPrefixes) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      throw new Error(`Unsafe workDir "${workDir}": must not be inside system directory ${prefix}`);
    }
  }

  // Must be under /tmp/ or contain "critters" in the path
  const isUnderTmp = normalized.startsWith("/tmp/") || normalized.startsWith("/private/tmp/");
  const containsCritters = normalized.toLowerCase().includes("critters");
  if (!isUnderTmp && !containsCritters) {
    throw new Error(
      `Unsafe workDir "${workDir}": must be under /tmp/ or contain "critters" in the path`,
    );
  }
}
```

**Call site — inside `loadConfig()`:**

Add the call right after line 38 (where `workDir` is resolved) and before the `return` statement:

```typescript
  const workDir = (yaml.workDir as string) ?? "/tmp/critters-work";
  validateWorkDir(workDir);

  return {
    pollIntervalSeconds: (yaml.pollIntervalSeconds as number) ?? 30,
    // ... rest unchanged, but use the workDir variable
    workDir,
    // ...
  };
```

This requires extracting `workDir` into a local variable (currently it's inline in the return object), which is a minor refactor of the return statement.

**Key design decisions:**
- The function is not exported — it's an internal validation detail of `loadConfig()`.
- Path normalization handles trailing slashes and relative paths so that `//` or `/tmp/critters-work/` don't bypass checks.
- The regex for home directories matches both `/Users` and `/Users/andrew` (but not `/Users/andrew/projects/critters-work`, which would fail the "must contain critters or be under /tmp" check anyway — though it would pass if the path contained "critters"). The two-tier check (block dangerous prefixes + require safe indicators) provides defense in depth.
- `/private/tmp/` is allowed alongside `/tmp/` since macOS symlinks `/tmp` → `/private/tmp`.

## Files NOT changed

- `src/types.ts` — `Config.workDir` stays `string`, no type changes needed
- `src/git.ts` — cleanup functions stay as-is; the safety check is at config load time
- `src/spawner.ts` — no changes; it already uses `this.config.workDir` which is now guaranteed safe

## Dependencies / setup

None. No new packages or configuration needed.

## Testing approach

1. **Unit-level verification**: The validation function can be tested by calling `loadConfig()` with a custom YAML file that sets various dangerous `workDir` values and confirming each throws:
   - `workDir: /` → throws (root)
   - `workDir: /Users/andrew` → throws (home directory)
   - `workDir: /home/deploy` → throws (home directory)
   - `workDir: /etc/critters` → throws (system directory, even though it contains "critters")
   - `workDir: /var/lib/something` → throws (system directory)
   - `workDir: /Users` → throws (home parent)
   - `workDir: /opt/something` → throws (system directory)
2. **Valid paths pass**:
   - `workDir: /tmp/critters-work` → passes (under /tmp)
   - `workDir: /private/tmp/critters-work` → passes (macOS /tmp)
   - `workDir: /data/critters-workspace` → passes (contains "critters")
3. **Default still works**: Omitting `workDir` from config uses `/tmp/critters-work`, which passes validation.
4. **Smoke test**: Run `bun run src/index.ts` with the existing config and confirm it starts without errors (existing `workDir: /tmp/critters-work` passes).
