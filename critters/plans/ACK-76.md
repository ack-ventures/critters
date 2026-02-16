# ACK-76: Remove hardcoded macOS assumptions and add setup documentation

## Summary

Make the Critters project runnable by someone other than the original author by:
1. Removing hardcoded macOS PATH assumptions
2. Detecting OS at runtime instead of hardcoding "macOS"
3. Fixing a macOS-specific test path
4. Making the tmux session name configurable
5. `.env.example` already exists — no changes needed
6. Adding a "Getting Started" section to CLAUDE.md

## Files to modify

### 1. `src/claude.ts` — Remove hardcoded PATH (line 50)

**Current** (line 50):
```bash
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
```

**Change**: Replace the hardcoded PATH with one that preserves the user's existing PATH via `process.env.PATH`:
```typescript
const currentPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
```
Then in the bash script template:
```bash
export PATH="$HOME/.bun/bin:$HOME/.local/bin:${currentPath}"
```
This removes the macOS-specific `/opt/homebrew/bin` and `/usr/local/bin` hardcoding, while still prepending useful common locations for bun. The user's actual PATH (which already includes platform-appropriate directories) is used as the base.

### 2. `src/claude.ts` — Make tmux session name configurable (line 10, line 21+)

**Current** (line 10):
```typescript
const TMUX_SESSION = "critters";
```

**Change**: Remove the `TMUX_SESSION` constant. Add a `tmuxSession` parameter to `spawnClaude()`:
```typescript
export async function spawnClaude(
  prompt: string,
  allowedTools: string[],
  workDir: string,
  maxTurns: number,
  identifier: string,
  phase: string,
  tmuxSession: string,
  signal?: AbortSignal,
): Promise<SpawnResult> {
```
Replace all references to `TMUX_SESSION` with the `tmuxSession` parameter (lines 82, 93).

### 3. `src/claude.ts` — Auto-create tmux session if it doesn't exist

Before the `split-window` call (~line 81), add logic to check if the tmux session exists and create it if not:
```typescript
// Ensure tmux session exists
const checkSession = await runCommand("tmux", ["has-session", "-t", tmuxSession]);
if (checkSession.code !== 0) {
  logTask(identifier, `tmux session "${tmuxSession}" not found, creating it`);
  const createResult = await runCommand("tmux", ["new-session", "-d", "-s", tmuxSession]);
  if (createResult.code !== 0) {
    logTaskError(identifier, `Failed to create tmux session: ${createResult.stderr}`);
    return { exitCode: 1, stdout: "", stderr: createResult.stderr, timedOut: false };
  }
}
```

### 4. `src/types.ts` — Add `tmuxSession` to Config interface

Add to the `Config` interface:
```typescript
tmuxSession: string;
```

### 5. `src/config.ts` — Load `tmuxSession` from config

In `loadConfig()`, add to the config object construction (~line 84-97):
```typescript
tmuxSession: (yaml.tmuxSession as string) ?? "critters",
```

### 6. `src/index.ts` — Pass `tmuxSession` from config to tmux setup commands (lines 17-18)

**Current**:
```typescript
await runCommand("tmux", ["set", "-t", "critters", "pane-border-status", "top"]).catch(() => {});
await runCommand("tmux", ["set", "-t", "critters", "pane-border-format", "#{pane_title}"]).catch(() => {});
```

**Change**: Use `config.tmuxSession` instead of the hardcoded `"critters"`:
```typescript
await runCommand("tmux", ["set", "-t", config.tmuxSession, "pane-border-status", "top"]).catch(() => {});
await runCommand("tmux", ["set", "-t", config.tmuxSession, "pane-border-format", "#{pane_title}"]).catch(() => {});
```

Note: These lines run after `loadConfig()` so `config` is available. Move these lines after the config loading block (after line 22) if needed, or reorder slightly.

### 7. `src/spawner.ts` — Pass `tmuxSession` through to `spawnClaude()`

Update both `spawnClaude()` calls in `runTask()` to pass `this.config.tmuxSession`:

Planning phase call (~line 141):
```typescript
const planResult = await spawnClaude(
  buildPlanningPrompt(task),
  planAllowedTools,
  workDir,
  this.config.maxPlanningTurns,
  task.identifier,
  "plan",
  this.config.tmuxSession,
  abortController.signal,
);
```

Execution phase call (~line 179):
```typescript
const execResult = await spawnClaude(
  buildExecutionPrompt(task, execAllowedTools),
  execAllowedTools,
  workDir,
  this.config.maxExecutionTurns,
  task.identifier,
  "exec",
  this.config.tmuxSession,
  abortController.signal,
);
```

### 8. `src/prompt.ts` — Detect OS at runtime (line 113)

**Current** (line 113):
```typescript
You are running on macOS — some GNU-specific flags (like \`cat -A\`, \`grep -P\`) are not available.
```

**Change**: Use `process.platform` to generate the appropriate OS guidance:
```typescript
function getOsGuidance(): string {
  if (process.platform === "darwin") {
    return "You are running on macOS — some GNU-specific flags (like `cat -A`, `grep -P`) are not available.";
  }
  return "You are running on Linux.";
}
```

Then in `buildExecutionPrompt()`, replace the hardcoded line with:
```typescript
${getOsGuidance()}
```

### 9. `src/config.test.ts` — Replace `/Users/andrew` with generic path (line 31)

**Current** (line 31):
```typescript
test("rejects /Users/andrew (home directory)", () => {
  const path = writeYaml("home.yaml", "workDir: /Users/andrew\n");
  expect(() => loadConfig(path)).toThrow("must not be a home directory");
});
```

**Change**: Replace `/Users/andrew` with `/Users/testuser`:
```typescript
test("rejects /Users/testuser (home directory)", () => {
  const path = writeYaml("home.yaml", "workDir: /Users/testuser\n");
  expect(() => loadConfig(path)).toThrow("must not be a home directory");
});
```

This test validates that any path matching `/Users/<username>` is rejected, not a specific user's home directory.

### 10. `critters.config.yaml` — Add `tmuxSession` field

Add after the existing config fields (e.g., after `maxExecutionTurns`):
```yaml
tmuxSession: critters
```

### 11. `CLAUDE.md` — Add Getting Started section and update tmux session config docs

Add a new "Getting Started" section near the top of `CLAUDE.md` (after the "## Stack" section):

```markdown
## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) (runtime & package manager)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude` command)
- [GitHub CLI](https://cli.github.com/) (`gh`) — must be authenticated (`gh auth login`)
- `git`
- `tmux`
- `jq`

### Setup
1. Clone the repo and install dependencies:
   ```
   git clone <repo-url> && cd critters
   bun install
   ```
2. Copy `.env.example` to `.env` and fill in your values:
   ```
   cp .env.example .env
   ```
   Required: `LINEAR_API_KEY` — your Linear API key
   Optional: `SLACK_WEBHOOK_URL` — for Slack notifications
3. Review `critters.config.yaml` and adjust settings as needed.
4. Start a tmux session (name must match `tmuxSession` in config, defaults to "critters"):
   ```
   tmux new -s critters
   ```
5. Run the daemon:
   ```
   bun run src/index.ts
   ```
```

Also update the Config table to include the new `tmuxSession` field:
```
| `tmuxSession` | "critters" | Name of the tmux session to use |
```

Update the Run command in the Stack section to use a generic path:
```
- Run: `bun run src/index.ts` (or `tmux new -s critters 'bun run src/index.ts'`)
```

### 12. `.env.example` — Already exists, no changes needed

The file already contains:
```
LINEAR_API_KEY=lin_api_xxx
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz
```

This is sufficient.

## Dependencies / setup needed

No new dependencies are required. All changes use existing Node.js/Bun APIs (`process.platform`, `process.env.PATH`).

## Testing approach

1. **Unit tests**: Run `bun test` to verify the config test change (`/Users/testuser`) still passes. The home directory rejection logic in `config.ts` uses a regex `/^\/(Users|home)(\/[^/]+)?$/` so `/Users/testuser` is a valid test case.
2. **Manual verification**:
   - Verify the generated bash script in `.critter-run-*.sh` uses `process.env.PATH` rather than hardcoded macOS paths.
   - Verify OS detection by checking `process.platform` output on both macOS and Linux.
   - Verify tmux session auto-creation works when no session exists.
   - Verify config loading accepts the new `tmuxSession` field and defaults to `"critters"`.
3. **Type checking**: Run `bun run tsc --noEmit` (or equivalent) to ensure the new `tmuxSession` field on Config doesn't break types.

## Order of changes

1. `src/types.ts` — add `tmuxSession` field to Config
2. `src/config.ts` — load `tmuxSession` from YAML
3. `critters.config.yaml` — add `tmuxSession` field
4. `src/claude.ts` — accept `tmuxSession` param, remove constant, use `process.env.PATH`, add session auto-create
5. `src/spawner.ts` — pass `tmuxSession` to `spawnClaude()`
6. `src/index.ts` — use `config.tmuxSession` instead of hardcoded `"critters"`
7. `src/prompt.ts` — OS detection via `process.platform`
8. `src/config.test.ts` — replace `/Users/andrew` with `/Users/testuser`
9. `CLAUDE.md` — add Getting Started section, update config table and run command
