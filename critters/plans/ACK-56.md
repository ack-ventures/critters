# ACK-56: Add retry logic to PR detection in detectPr

## Summary

The `detectPr()` function in `src/spawner.ts` (lines 300–329) calls `gh pr list` once after pushing. If GitHub's API hasn't indexed the PR yet, it returns `null` — a false negative that causes the task to fail with "no PR was detected" even though the PR exists. Additionally, JSON parse errors are silently swallowed without logging what `gh` actually returned.

## Changes

### File: `src/spawner.ts`

#### 1. Refactor `detectPr` to use `runCommand` from `src/utils.ts`

Replace the manual `spawn` + event-listener approach with the existing `runCommand` utility, matching the pattern used throughout `src/git.ts`. This also captures `stderr`, which the current implementation ignores.

**Before (lines 305–328):**
```ts
return new Promise((resolve) => {
  const proc = spawn("gh", [...], { cwd: workDir });
  let stdout = "";
  proc.stdout.on("data", (d) => (stdout += d));
  proc.on("close", (code) => { ... });
});
```

**After:**
```ts
const { code, stdout, stderr } = await runCommand(
  "gh",
  ["pr", "list", "--head", branch, "--json", "url", "--limit", "1"],
  { cwd: workDir },
);
```

#### 2. Add retry loop with configurable attempts and delay

Wrap the `runCommand` call in a retry loop:
- **Max attempts**: 5
- **Delay between attempts**: 3 seconds (using the existing `sleep` utility from `src/utils.ts`)
- Log each retry attempt via `logTask` so operators can see what's happening

```ts
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  const { code, stdout, stderr } = await runCommand(...);

  if (code !== 0) {
    logTaskError(identifier, `gh pr list failed (attempt ${attempt}/${MAX_RETRIES}): ${stderr}`);
  } else {
    try {
      const prs = JSON.parse(stdout);
      if (prs.length > 0) {
        return prs[0].url;
      }
    } catch {
      logTaskError(identifier, `Failed to parse gh pr list output: ${stdout}`);
    }
  }

  if (attempt < MAX_RETRIES) {
    logTask(identifier, `PR not found yet, retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_RETRIES})`);
    await sleep(RETRY_DELAY_MS);
  }
}

return null;
```

#### 3. Log JSON parse failures with actual stdout content

On JSON parse failure, log the raw stdout so operators can diagnose issues:
```ts
logTaskError(identifier, `Failed to parse gh pr list output: ${stdout}`);
```

This matches the format specified in the issue description.

#### 4. Update imports

- Add `runCommand` and `sleep` to the import from `./utils.js` (line 24)
- Remove the `spawn` import from `node:child_process` (line 1), since `detectPr` is the only consumer and the rest of the file doesn't use it

**Import line changes:**
```ts
// Remove:
import { spawn } from "node:child_process";

// Update existing import:
import { branchName, formatDuration, formatPhaseStats, sleep, tailLines } from "./utils.js";

// Add new import:
import { runCommand } from "./utils.js";
```

Since `branchName`, `formatDuration`, `formatPhaseStats`, and `tailLines` are already imported from `./utils.js`, we add `runCommand` and `sleep` to that same import statement.

## Full replacement for `detectPr` function

```ts
async function detectPr(
  workDir: string,
  branch: string,
  identifier: string,
): Promise<string | null> {
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 3000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { code, stdout, stderr } = await runCommand(
      "gh",
      ["pr", "list", "--head", branch, "--json", "url", "--limit", "1"],
      { cwd: workDir },
    );

    if (code !== 0) {
      logTaskError(identifier, `gh pr list failed (attempt ${attempt}/${MAX_RETRIES}): ${stderr}`);
    } else {
      try {
        const prs = JSON.parse(stdout);
        if (prs.length > 0) {
          return prs[0].url;
        }
      } catch {
        logTaskError(identifier, `Failed to parse gh pr list output: ${stdout}`);
      }
    }

    if (attempt < MAX_RETRIES) {
      logTask(identifier, `PR not found yet, retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_RETRIES})`);
      await sleep(RETRY_DELAY_MS);
    }
  }

  logTaskError(identifier, `PR not detected after ${MAX_RETRIES} attempts`);
  return null;
}
```

## Dependencies

- No new dependencies required
- Uses existing `runCommand` and `sleep` from `src/utils.ts`
- Uses existing `logTask` and `logTaskError` from `src/logger.ts`

## Testing approach

1. **Manual verification**: Run `bun run src/index.ts` with a test Linear issue that triggers a critter, confirm logs show retry attempts and that PRs are eventually detected
2. **Simulated delay**: To test the retry path, temporarily add a delay before the PR is created (or test against a repo where `gh pr list` initially returns `[]` due to API indexing lag)
3. **Parse error path**: Verify that a malformed response from `gh` is logged with the actual stdout content
4. **TypeScript check**: Run `bun run --bun tsc --noEmit` to confirm no type errors
