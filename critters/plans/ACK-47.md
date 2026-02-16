# ACK-47: Add Biome linter and lint CI check on PRs

## Summary

Install Biome as a dev dependency, configure it with recommended lint rules (formatter disabled), add a `lint` script to `package.json`, add a lint job to the existing CI workflow, and fix any lint errors in the current codebase.

## Dependencies / Setup

- Install `@biomejs/biome` as a dev dependency: `bun add -d @biomejs/biome`

## Files to Create

### `biome.json`

Biome configuration at the project root:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "formatter": {
    "enabled": false
  },
  "files": {
    "include": ["src/**/*.ts"]
  }
}
```

**Key decisions:**
- Formatter disabled (not needed per task spec)
- Linter with recommended rules enabled
- Organize imports enabled
- Scoped to `src/**/*.ts` only (excludes config files, dist, node_modules)

## Files to Modify

### `package.json`

Add `"lint"` script:

```diff
  "scripts": {
    "start": "bun run src/index.ts",
-   "typecheck": "tsc --noEmit"
+   "typecheck": "tsc --noEmit",
+   "lint": "biome check src/"
  },
```

### `.github/workflows/ci.yml`

Add a `lint` job alongside the existing `typecheck` job:

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.x"
      - run: bun install --frozen-lockfile
      - run: bun run typecheck

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.x"
      - run: bun install --frozen-lockfile
      - run: bun run lint
```

**Details:**
- Separate `lint` job (runs in parallel with `typecheck`)
- Same setup pattern: checkout → setup-bun → install → run
- Uses `bun run lint` which invokes `biome check src/`

### Source files — lint fixes

Anticipated issues that Biome's recommended rules will flag:

1. **`src/watcher.ts`** — Duplicate import source. Lines 3 and 5 both import from `"./linear.js"`. Merge them into a single import statement:
   ```diff
   -import { findCritterIssues } from "./linear.js";
   -import { resolveRepoUrl } from "./prompt.js";
   -import { commentOnIssue } from "./linear.js";
   +import { findCritterIssues, commentOnIssue } from "./linear.js";
   +import { resolveRepoUrl } from "./prompt.js";
   ```

2. **`src/git.ts:108`** — `require("fs")` is a CJS-style require in an ESM file. Biome's `noCommonJs` rule will flag this. Fix by using the already-imported `readdirSync` from `"fs"`:
   ```diff
   -import { existsSync, rmSync } from "fs";
   +import { existsSync, rmSync, readdirSync } from "fs";
   ```
   And in `cleanupStaleWorkDirs`:
   ```diff
   -  const { readdirSync } = require("fs");
   -  const entries = readdirSync(baseDir) as string[];
   +  const entries = readdirSync(baseDir, { encoding: "utf-8" });
   ```

3. **`src/utils.ts:39-40`** — `== null` loose equality comparisons. Biome's `useExplicitLengthCheck` or `noDoubleEquals` rule may flag `result.numTurns == null` and `result.totalTokens != null`. These are intentional (checking both `null` and `undefined`), so if Biome flags them, suppress with `// biome-ignore` inline comment or handle by converting to explicit `=== null || === undefined` checks. Alternatively, since Biome's recommended rules allow `== null` as a special case (it's excluded from `noDoubleEquals`), this may not need changes.

4. **Other potential issues** — Empty `catch` blocks (e.g., `src/spawner.ts:226-228`, `src/claude.ts:141-142,146-147`, `src/watcher.ts:58-60`) may trigger `noEmptyBlockStatements` but Biome's default recommended rules do not include this as an error — they are nursery-level. If they do trigger, add brief comments inside each empty catch.

The exact set of fixes will be confirmed by running `bun run lint` locally after installation.

## Testing Approach

1. Run `bun add -d @biomejs/biome` to install
2. Create `biome.json` with the config above
3. Add the `lint` script to `package.json`
4. Run `bun run lint` to discover all issues
5. Fix each issue (merge duplicate imports, replace `require`, etc.)
6. Run `bun run lint` again to confirm zero errors
7. Run `bun run typecheck` to confirm no type regressions from the fixes
8. Validate CI workflow YAML is well-formed
