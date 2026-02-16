# ACK-83: Add auto-updater to check GitHub Releases on startup

## Summary

Add a self-update mechanism so the compiled critters binary can check GitHub Releases on startup and replace itself with a newer version if available. The updater runs before the polling loop begins, downloads the platform-appropriate binary asset, and atomically replaces the current executable. Errors are non-fatal — if the update check fails for any reason, the daemon continues normally.

## Files to create

### 1. `src/updater.ts` — Auto-update module

Create a new module with a single exported `async checkForUpdate()` function.

**Imports:**
```ts
import { chmodSync, existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { log, logError } from "./logger.js";
```

No `node:os` import needed — `process.platform` and `process.arch` are globals.

**Constants:**
```ts
const RELEASES_URL = "https://api.github.com/repos/ack-ventures/critters/releases/latest";
```

**`checkForUpdate(currentVersion: string): Promise<void>`:**

Declare `tempPath` at the top of the function body so it's accessible in both the try and catch blocks:
```ts
const tempPath = `${process.execPath}.update`;
```

The rest of the function body is wrapped in a single top-level try/catch. On any error, log with `logError` (matching the pattern in `slack.ts` for non-fatal external service errors) and return. The function never throws.

1. **Fetch latest release** — `fetch(RELEASES_URL, { headers: { Accept: "application/vnd.github+json", "User-Agent": "critters-updater" }, signal: AbortSignal.timeout(10_000) })`. The `User-Agent` header is required by the GitHub API. `AbortSignal.timeout` is supported by Bun's fetch implementation. If the response is not ok, `logError` a message like `"Update check failed: GitHub API returned ${response.status}"` and return.

2. **Parse response and validate shape** — Extract `tag_name` and `assets` from the JSON body. Validate that `tag_name` is a string and `assets` is an array before proceeding. If the shape is unexpected, `logError("Update check failed: unexpected API response format")` and return.

3. **Compare versions** — Strip the leading `v` from `tag_name` (if present). Also strip any pre-release suffix (everything from the first `-` onwards, e.g., `0.2.0-beta.1` → `0.2.0`) to safely compare only the numeric portion. Compare against `currentVersion` using the `compareSemver` helper (see below). If the release version is not strictly newer, return silently.

4. **Log update availability** — `log("Update available: v${currentVersion} → v${latestVersion}")`.

5. **Find matching asset** — Construct the expected asset name as `critters-${process.platform}-${process.arch}` (e.g. `critters-darwin-arm64`, `critters-linux-x64`). Search the release `assets` array for an object whose `name` field matches. If no match, `logError("Update: no binary asset found for ${process.platform}-${process.arch}")` and return.

6. **Download the binary** — Fetch the asset's `browser_download_url` with a 60-second timeout (`AbortSignal.timeout(60_000)` — binaries can be large). If the fetch fails or returns a non-ok status, `logError` and return.

7. **Atomic replacement** (using `tempPath` declared at function top):
   - Write the downloaded `ArrayBuffer` to `tempPath` using `writeFileSync(tempPath, Buffer.from(arrayBuffer))`
   - `chmodSync(tempPath, 0o755)` — make executable
   - `renameSync(tempPath, process.execPath)` — atomic on same filesystem (temp file is in the same directory as the executable)
   - `log("Update applied (v${currentVersion} → v${latestVersion}). Will take effect on next restart.")`

8. **Error handling / cleanup** — In the catch block, if the temp file exists (`existsSync(tempPath)`), attempt cleanup with `unlinkSync(tempPath)` in a nested try/catch (best-effort). Then `logError("Update failed: ${err instanceof Error ? err.message : String(err)}")` and return.

**`compareSemver(a: string, b: string): number`** (unexported helper):

Simple semver comparison. Splits on `.`, parses each segment as a number, compares left-to-right. Returns negative if a < b, positive if a > b, zero if equal. Handles `major.minor.patch` only — pre-release suffixes are stripped by the caller before comparison.

```ts
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
```

## Files to modify

### 2. `src/index.ts` — Call updater on startup + add `--skip-update` flag

**Add import** (after existing imports, ~line 11):
```ts
import { checkForUpdate } from "./updater.js";
```

**Add `--skip-update` flag parsing** (after `noTmux` on line 15):
```ts
const skipUpdate = Bun.argv.includes("--skip-update");
```

**Call `checkForUpdate`** — Insert after the version is read and logged (after line 45, before `checkPrerequisites`):
```ts
if (!skipUpdate && version !== "unknown") {
  await checkForUpdate(version);
}
```

The guard `version !== "unknown"` ensures the updater only runs when we have a real version (i.e., when `package.json` was readable). This naturally skips the check when running in development from source where version resolution might fail in a compiled binary context.

**No other changes to `index.ts`.** The updater is called early, before config loading and Linear initialization, so it runs before any side effects. The placement after version logging but before prerequisites means the user sees "Critters v0.1.0 starting..." before any network call.

## Dependencies / setup

- **No new npm dependencies.** Uses only `fetch` (global in Bun), `node:fs` functions, and `process` globals for platform/arch.
- **No config changes.** The updater is controlled by the CLI flag only.
- **No type changes.** The updater module is self-contained.

## Detailed design notes

### Asset naming convention

The release asset names follow the pattern `critters-{os}-{arch}` where:
- `{os}` = `process.platform` (`darwin`, `linux`)
- `{arch}` = `process.arch` (`arm64`, `x64`)

This matches common conventions and is what the future CI release workflow (next ticket) will produce.

### Why `renameSync` for atomic replacement

On POSIX systems, `rename()` is atomic when source and destination are on the same filesystem. Since the temp file is written next to `process.execPath` (same directory = same filesystem), this guarantees no partial writes. The running process keeps its file descriptor to the old binary, so the replacement doesn't affect the current execution.

If the user lacks write permissions to the executable's directory, the `writeFileSync` or `renameSync` will throw, which is caught by the top-level try/catch and logged as a non-fatal error.

### Why `AbortSignal.timeout` for fetch

The GitHub API could be slow or unreachable. A 10-second timeout on the API call and 60-second timeout on the binary download prevent the daemon from hanging at startup. `AbortSignal.timeout` is supported by Bun's fetch implementation.

### Error resilience

Every external operation (fetch, file write, rename) is inside the top-level try/catch. The updater never throws — it always returns, either successfully or after logging a warning. This ensures a flaky network or GitHub outage never prevents the daemon from starting.

### Logging pattern

Following the `slack.ts` pattern: use `logError` for non-fatal external service errors (API failures, missing assets, download failures) and `log` for informational messages (update available, update applied). This is consistent since the updater is a top-level module, not task-scoped.

### `--skip-update` flag

Useful for development and testing. When running from source (`bun run src/index.ts`), the version will typically resolve fine (0.1.0), so the flag provides an explicit opt-out. The `version !== "unknown"` guard handles the case where `package.json` can't be read (compiled binary without embedded version).

### Pre-release version handling

The version comparison strips pre-release suffixes (everything after the first `-` in the version string) before comparing. This means `v0.2.0-beta.1` would compare as `0.2.0`. Since critters uses clean semver releases, this is a safety measure rather than a primary feature.

### GitHub API response validation

The plan includes explicit type checking of the API response shape (verifying `tag_name` is a string and `assets` is an array) before accessing properties. This guards against API changes or malformed responses without relying on TypeScript's compile-time types for runtime safety.

## Testing approach

1. **Type check:** `tsc --noEmit` — verify the new module compiles cleanly with strict TypeScript
2. **Lint:** `biome check src/` — verify code style
3. **Existing tests pass:** `bun test` — no regressions in existing functionality
4. **Manual smoke test (dev):** Run `bun run src/index.ts` — version resolves as "0.1.0", the updater will fetch from GitHub API (likely 404 since no releases exist yet) and continue silently
5. **Manual smoke test (skip flag):** Run `bun run src/index.ts --skip-update` — updater is bypassed entirely
6. **Integration test (future):** Once the CI release workflow is set up (next ticket), the updater can be verified end-to-end by publishing a release and running an older binary

## Change summary

| File | Action | Description |
|------|--------|-------------|
| `src/updater.ts` | Create | Auto-update module: fetch latest release, compare versions, download + atomically replace binary |
| `src/index.ts` | Modify | Import updater, add `--skip-update` flag, call `checkForUpdate()` before prerequisites check |
