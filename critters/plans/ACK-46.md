# ACK-46: Add GitHub Actions CI workflow for typecheck on PRs

## Summary

Add a GitHub Actions workflow that runs TypeScript type checking (`tsc --noEmit`) on every pull request targeting `main`. This is the project's first CI workflow.

## Files to Create

### `.github/workflows/ci.yml`

A single-job workflow with:

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
      - run: bun install
      - run: bun run typecheck
```

**Details:**
- **Trigger:** `pull_request` events targeting the `main` branch
- **Runner:** `ubuntu-latest`
- **Steps:**
  1. `actions/checkout@v4` — check out the PR branch
  2. `oven-sh/setup-bun@v2` — install Bun (uses latest stable by default)
  3. `bun install` — install dependencies from `bun.lock`
  4. `bun run typecheck` — runs `tsc --noEmit` as defined in `package.json`

## Files Modified

None. This only adds a new file.

## Dependencies / Setup

- No new dependencies needed
- The `typecheck` script already exists in `package.json` (`tsc --noEmit`)
- No caching configuration needed per requirements
- No environment variables or secrets required (typecheck doesn't need `LINEAR_API_KEY` or `SLACK_WEBHOOK_URL`)

## Testing Approach

1. Verify the YAML is valid and well-formed
2. Confirm the workflow triggers only on PRs to `main` (not on push, not on PRs to other branches)
3. Confirm `bun run typecheck` works locally before relying on CI
4. After merging, open a test PR to verify the workflow runs successfully
