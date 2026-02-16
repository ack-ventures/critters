# ACK-49: Set up Husky pre-commit hook with Biome lint and typecheck

## Summary

Add Husky and lint-staged to the project so every commit is automatically checked for lint errors (via Biome) and type errors (via `tsc --noEmit`) before it lands. This catches issues locally before they reach CI.

## Dependencies to install

- `husky` (devDependency) — Git hook manager
- `lint-staged` (devDependency) — Run linters on staged files only

Install command: `bun add -d husky lint-staged`

## Files to create/modify

### 1. `package.json` — modify

Add the `prepare` script and the `lint-staged` configuration block.

**Changes:**

- Add `"prepare": "husky"` to the `scripts` section
- Add a top-level `"lint-staged"` key

Result should look like:

```json
{
  "scripts": {
    "start": "bun run src/index.ts",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src/",
    "prepare": "husky"
  },
  "lint-staged": {
    "src/**/*.ts": ["biome check"]
  },
  "dependencies": { ... },
  "devDependencies": { ... }
}
```

**Notes:**
- The `lint-staged` glob `src/**/*.ts` matches the Biome `files.includes` pattern in `biome.json`, keeping things consistent.
- `biome check` is check-only (no auto-fix), matching the task requirement.
- The `prepare` script ensures `husky` hooks are installed automatically when anyone runs `bun install`.

### 2. `.husky/pre-commit` — create

Created by `bunx husky init`, then edited to contain:

```sh
bunx lint-staged
bun run typecheck
```

**Notes:**
- `bunx lint-staged` runs Biome check only on staged `src/**/*.ts` files — fast feedback loop.
- `bun run typecheck` runs `tsc --noEmit` on the full project — this is expected since type errors can span files.
- If either command fails (non-zero exit), the commit is aborted.
- The file should be executable (husky init handles this).

### 3. `bun.lock` — auto-updated

Will be updated by `bun add` with the new devDependencies. No manual changes needed.

## Implementation steps

1. `bun add -d husky lint-staged` — install dependencies
2. Add `"prepare": "husky"` script to `package.json`
3. `bunx husky init` — creates `.husky/` directory and a default `.husky/pre-commit` file
4. Edit `.husky/pre-commit` to contain `bunx lint-staged` and `bun run typecheck`
5. Add `lint-staged` config block to `package.json`

## What NOT to change

- `.github/workflows/ci.yml` — already configured with `bun run lint` and `bun run typecheck`
- `biome.json` — already configured correctly
- `tsconfig.json` — no changes needed

## Testing approach

1. **Verify hook installation**: Confirm `.husky/pre-commit` exists and is executable
2. **Test with a clean commit**: Stage a valid TypeScript file change, run `git commit` — should pass both lint-staged and typecheck, and commit succeeds
3. **Test lint failure**: Introduce a lint error in a staged file (e.g., unused variable), attempt to commit — should fail with Biome error and abort the commit
4. **Test type error**: Introduce a type error (e.g., assign string to number), attempt to commit — should fail with TypeScript error and abort the commit
5. **Verify `bun install` installs hooks**: Delete `.husky/_/` and run `bun install` — the `prepare` script should recreate the hooks
