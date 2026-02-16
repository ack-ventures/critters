# ACK-82: Prep codebase for standalone binary compilation

## Summary

Make the critters codebase compilable into a standalone binary via `bun build --compile` that works without a repo checkout. Four changes are needed:

1. Embed the `stream-filter.jq` file as a string constant (currently read from disk relative to source)
2. Add config file search order with CLI flag support (currently hardcoded to CWD)
3. Add `.env` fallback resolution for installed binary usage
4. Add `"build"` script to `package.json` and verify compilation works

## Files to create/modify

### 1. Create `src/jq-filter.ts` — Embed the jq filter

Create a new file exporting the jq filter as a string constant:

```ts
// Embedded copy of stream-filter.jq for standalone binary usage
export const STREAM_FILTER = `<contents of src/stream-filter.jq>`;
```

The full contents of `src/stream-filter.jq` (82 lines) will be embedded as a template literal string.

### 2. Modify `src/claude.ts` — Use embedded filter instead of filesystem copy

**Remove:**
- `copyFileSync` from the `"node:fs"` destructured imports (keep other fs imports)
- `import { dirname, join } from "node:path"` — neither is used elsewhere
- `import { fileURLToPath } from "node:url"`
- `const __dirname = dirname(fileURLToPath(import.meta.url));` (line 8)
- `copyFileSync(join(__dirname, "stream-filter.jq"), filterFile);` (line 38)

**Add:**
- `import { STREAM_FILTER } from "./jq-filter.js";`
- Replace the `copyFileSync` call with `writeFileSync(filterFile, STREAM_FILTER);`

The `writeFileSync` import already exists on line 1. The `filterFile` variable already exists on line 37. This is a minimal change — the rest of `spawnClaude` stays the same.

Note: `spawnClaudeSubprocess` (line 209) does not use the jq filter (it writes raw JSON to a log file), so no changes needed there.

### 3. Modify `src/config.ts` — Config file search order with CLI flag

**Change the `loadConfig` function signature and body:**

Current (line 52):
```ts
export function loadConfig(configPath = "critters.config.yaml"): Config {
  const raw = readFileSync(configPath, "utf-8");
```

New behavior:
```ts
export function loadConfig(configPath?: string): Config {
```

Add a `resolveConfigPath` helper function that implements this search order:
1. If `configPath` argument is provided (used by tests and the `--config` CLI flag), use it directly
2. `./critters.config.yaml` (CWD — for development)
3. `~/.critters/config.yaml` (user config — for installed binary usage)
4. If none found, throw an error with a helpful message listing the search locations and suggesting how to set up

Use `homedir()` (via `import { homedir } from "node:os"`) to resolve `~`. Add `existsSync` to the existing `node:fs` import on line 1 (it is **not** currently imported in `config.ts` — it needs to be added).

**Add `--config` CLI flag parsing in `src/index.ts`:**

Before the `loadConfig()` call (line 25), parse `Bun.argv` for `--config`:
```ts
const configIdx = Bun.argv.indexOf("--config");
const configPath = configIdx !== -1 && Bun.argv[configIdx + 1]
  ? Bun.argv[configIdx + 1]
  : undefined;
const config = loadConfig(configPath);
```

### 4. Modify `src/index.ts` — `.env` fallback resolution + package.json version

**`.env` loading:**

Bun automatically loads `.env` from CWD. For standalone binary usage, we need to also check `~/.critters/.env`. Add this near the top of `main()`, before `loadConfig`:

```ts
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

// Load ~/.critters/.env as fallback if CWD .env doesn't exist
const cwdEnv = "./.env";
const userEnv = `${homedir()}/.critters/.env`;
if (!existsSync(cwdEnv) && existsSync(userEnv)) {
  // Bun doesn't auto-load .env from non-CWD paths, so manually load it
  const envContent = readFileSync(userEnv, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    // Don't override existing env vars (explicit exports take precedence)
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
```

**`package.json` version reading:**

Line 18 currently uses:
```ts
const { version } = await Bun.file(new URL("../package.json", import.meta.url)).json();
```

In a compiled binary, `import.meta.url` may not resolve correctly relative to the source tree. Use a try/catch fallback to handle both dev and binary contexts:

```ts
let version = "unknown";
try {
  const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
  version = pkg.version;
} catch {
  // In compiled binary, import.meta.url won't resolve to the source tree
}
```

Note: A static `import packageJson from "../package.json"` would be cleaner, but the current `tsconfig.json` has `"rootDir": "src"` which prevents importing files outside `src/`, and lacks `"resolveJsonModule": true`. Changing the tsconfig to support this is unnecessary complexity for a version string. The try/catch approach works in both dev (resolves fine) and binary (gracefully falls back to "unknown") without any tsconfig changes.

### 5. Modify `package.json` — Add build script

Add to `"scripts"`:
```json
"build": "bun build --compile src/index.ts --outfile critters"
```

### 6. Add `/critters` to `.gitignore`

The compiled binary should not be committed. Add `/critters` (with leading slash) to `.gitignore`.

**Important:** The entry must be `/critters` (with leading slash), not bare `critters`. A bare `critters` pattern would also match the `critters/` directory that stores committed plan files (`critters/plans/*.md`), breaking the plan-file workflow. The leading slash restricts the match to only the binary at the repository root.

### 7. Update `src/config.test.ts` — Adjust tests for new signature

The existing tests pass `configPath` explicitly (e.g., `loadConfig(path)`), so they will continue to work since the parameter is still accepted. No test changes needed for existing cases.

Add a test for the config search order behavior when no path is provided — specifically, that a helpful error is thrown when no config file is found:

```ts
test("throws helpful error when no config file found", () => {
  const origCwd = process.cwd();
  const emptyDir = `${tmpDir}/empty`;
  mkdirSync(emptyDir, { recursive: true });
  process.chdir(emptyDir);
  try {
    expect(() => loadConfig()).toThrow(/config.*not found/i);
  } finally {
    process.chdir(origCwd);
  }
});
```

Since existing tests all pass explicit paths and the new behavior only activates when `configPath` is `undefined`, existing tests won't break.

## Dependencies / setup

- No new npm dependencies needed (`yaml`, `node:os`, `node:fs` are already available)
- `bun build --compile` requires Bun v1.0+ (already in use)
- No `tsconfig.json` changes needed

## Testing approach

1. **Existing tests pass:** Run `bun test` to verify no regressions in config validation tests
2. **Type check:** Run `tsc --noEmit` (the `typecheck` script)
3. **Build compiles:** Run `bun run build` and verify it produces a `critters` binary
4. **Binary starts:** Run `./critters` briefly — it will fail on missing LINEAR_API_KEY if no env is set, which is expected. The key test is that it starts and gets to the config-loading stage without crashing on missing embedded files.
5. **Manual verification:**
   - Verify the jq filter is embedded (no file-not-found errors for stream-filter.jq)
   - Verify `--config /path/to/config.yaml` works
   - Verify `~/.critters/config.yaml` fallback works
   - Verify `~/.critters/.env` fallback works

## Change summary

| File | Action | Description |
|------|--------|-------------|
| `src/jq-filter.ts` | Create | Embedded jq filter string constant |
| `src/claude.ts` | Modify | Use embedded filter via `writeFileSync` instead of `copyFileSync` from `__dirname` |
| `src/config.ts` | Modify | Add `existsSync` to imports; config search order: CLI flag → CWD → `~/.critters/config.yaml` → error |
| `src/index.ts` | Modify | Parse `--config` flag, `.env` fallback from `~/.critters/.env`, try/catch for version |
| `package.json` | Modify | Add `"build"` script |
| `.gitignore` | Modify | Add `/critters` (leading slash) to ignore compiled binary only |
| `src/config.test.ts` | Modify | Add test for config-not-found error message |
