# ACK-53: Add config value validation in loadConfig

## Summary

Add runtime validation of numeric config values at the end of `loadConfig()` in `src/config.ts`. Currently, invalid values like negative numbers or zero concurrency silently produce a config object that causes confusing failures later at runtime. Instead, the process should fail fast at startup with a clear error message.

## Files to modify

### 1. `src/config.ts` — modify

Add validation checks after the config object is constructed but before it's returned. Build the config into a local variable, validate it, then return it.

**Changes:**

- Assign the return object to a `const config: Config` variable instead of returning it directly
- Add a `validateConfig(config)` call before `return config`
- Add a `validateConfig` function with these checks:
  - `concurrency` must be >= 1 (zero or negative means no work can happen)
  - `timeoutMinutes` must be > 0 (zero or negative timeout is nonsensical)
  - `pollIntervalSeconds` must be >= 5 (protect against Linear API rate limiting)
  - `maxPlanningTurns` must be > 0 (zero turns means Claude can't do anything)
  - `maxExecutionTurns` must be > 0 (same reason)

**Error format:** Each check throws immediately with a message like:
```
Invalid config: concurrency must be >= 1, got -1
```

**Implementation sketch:**

```typescript
function validateConfig(config: Config): void {
  if (config.concurrency < 1) {
    throw new Error(`Invalid config: concurrency must be >= 1, got ${config.concurrency}`);
  }
  if (config.timeoutMinutes <= 0) {
    throw new Error(`Invalid config: timeoutMinutes must be > 0, got ${config.timeoutMinutes}`);
  }
  if (config.pollIntervalSeconds < 5) {
    throw new Error(`Invalid config: pollIntervalSeconds must be >= 5, got ${config.pollIntervalSeconds}`);
  }
  if (config.maxPlanningTurns <= 0) {
    throw new Error(`Invalid config: maxPlanningTurns must be > 0, got ${config.maxPlanningTurns}`);
  }
  if (config.maxExecutionTurns <= 0) {
    throw new Error(`Invalid config: maxExecutionTurns must be > 0, got ${config.maxExecutionTurns}`);
  }
}
```

**In `loadConfig()`**, change the tail from:

```typescript
  return {
    pollIntervalSeconds: ...
    ...
  };
```

to:

```typescript
  const config: Config = {
    pollIntervalSeconds: ...
    ...
  };

  validateConfig(config);
  return config;
```

## Files NOT to change

- `src/types.ts` — the `Config` interface stays the same; these are runtime checks, not type changes
- `critters.config.yaml` — the default values are already valid
- No new files or dependencies needed

## Dependencies / setup

None. No new packages or setup required.

## Testing approach

1. **Existing behavior preserved**: Run `bun run typecheck` to confirm no type errors introduced
2. **Manual validation**: Temporarily set an invalid value in `critters.config.yaml` (e.g., `concurrency: 0`) and run `bun run src/index.ts` — should fail immediately with `Invalid config: concurrency must be >= 1, got 0`
3. **Test each boundary**:
   - `concurrency: 0` → error
   - `concurrency: 1` → passes
   - `timeoutMinutes: 0` → error
   - `timeoutMinutes: 1` → passes
   - `pollIntervalSeconds: 4` → error
   - `pollIntervalSeconds: 5` → passes
   - `maxPlanningTurns: 0` → error
   - `maxPlanningTurns: 1` → passes
   - `maxExecutionTurns: 0` → error
   - `maxExecutionTurns: 1` → passes
4. **Negative values**: Verify that negative numbers also trigger the appropriate errors (e.g., `concurrency: -1`)
5. **Default config works**: Run with the unmodified `critters.config.yaml` to confirm all defaults pass validation
