# ACK-77: Add test step to CI workflow

## Summary

Add a `test` script to `package.json` and a corresponding test step to the CI workflow so that `bun test` runs automatically on pull requests. The existing test file (`src/config.test.ts`) already uses Bun's built-in test runner, which auto-discovers `*.test.ts` files — no extra configuration is needed.

## Files to modify

### 1. `package.json`

**Change:** Add `"test": "bun test"` to the `scripts` section.

**Before:**
```json
"scripts": {
  "start": "bun run src/index.ts",
  "typecheck": "tsc --noEmit",
  "lint": "biome check src/",
  "prepare": "husky"
}
```

**After:**
```json
"scripts": {
  "start": "bun run src/index.ts",
  "typecheck": "tsc --noEmit",
  "lint": "biome check src/",
  "test": "bun test",
  "prepare": "husky"
}
```

Insert `"test": "bun test"` after the `"lint"` line and before `"prepare"`. This keeps `prepare` last (it's a lifecycle hook, not a user-facing command) and groups the check scripts together.

### 2. `.github/workflows/ci.yml`

**Change:** Append `- run: bun test` after the existing `bun run typecheck` step.

**Before:**
```yaml
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.x"
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run typecheck
```

**After:**
```yaml
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.x"
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run typecheck
      - run: bun test
```

Uses `bun test` directly (not `bun run test`) to match the pattern used by Bun's test runner. Both would work, but `bun test` is the canonical invocation.

## Dependencies / setup

None. Bun's built-in test runner requires no additional packages or configuration. The existing `@types/bun` dev dependency already provides the `bun:test` types used by `src/config.test.ts`.

## Testing approach

- The existing `src/config.test.ts` file (31 tests across 3 describe blocks) will be picked up automatically by `bun test`.
- Verify locally by running `bun test` — all tests should pass.
- The CI workflow will run `bun test` after typecheck, so any test failures will block PR merges just like lint and typecheck failures do.

## No files to create

This change only modifies two existing files. No new files are needed.
