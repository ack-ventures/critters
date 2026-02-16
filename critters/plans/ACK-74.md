# ACK-74: Set tmux pane titles for critter processes

## Summary

Add tmux pane titles so each critter pane is labeled with its identifier and phase (e.g. `ACK-74-plan`). This involves two changes: (1) set the pane title via `select-pane -T` after each pane is created in `src/claude.ts`, and (2) enable pane border status once at startup in `src/index.ts` so the titles are visible.

## Files to modify

### 1. `src/claude.ts` — after line 95

**Change:** After `paneId` is captured and before the polling loop, add a `select-pane -T` call to set the pane's title to `windowName`.

**Add after line 95 (`const paneId = tmuxResult.stdout.trim();`):**
```typescript
  // Label the pane so it's identifiable in the tmux UI
  await runCommand("tmux", ["select-pane", "-t", paneId, "-T", windowName]);
```

This uses the existing `windowName` variable (line 30: `` `${identifier}-${phase}` ``) which already has the right format.

### 2. `src/index.ts` — after line 14 (after `checkPrerequisites()`)

**Change:** Add one-time tmux session configuration to enable pane border display. This should happen early in startup, after prerequisites are verified but before any critters are spawned.

**Add after the `await checkPrerequisites();` line:**
```typescript
  // Enable pane titles in the tmux session (best-effort — may fail if not running in tmux)
  await runCommand("tmux", ["set", "-t", "critters", "pane-border-status", "top"]).catch(() => {});
  await runCommand("tmux", ["set", "-t", "critters", "pane-border-format", "#{pane_title}"]).catch(() => {});
```

The `.catch(() => {})` follows the same pattern used at `src/claude.ts:93` for the `select-layout` call. If the tmux session doesn't exist (e.g. during development), these calls fail silently rather than crashing the daemon at startup. The spawner will produce its own errors later when it actually tries to create panes.

**Also add the import** for `runCommand` at the top of `src/index.ts`:
```typescript
import { runCommand } from "./utils.js";
```

## Dependencies / setup

None. Both `runCommand` and the `tmux` CLI are already used throughout the codebase. The tmux `set` commands are idempotent — running them multiple times (e.g. on restart) has no ill effect.

## Testing approach

- **TypeScript check:** Run `bun run --bun tsc --noEmit` to verify the project compiles without errors.
- **Manual verification:** Start the critters tmux session and confirm that:
  1. Pane borders appear at the top of each pane
  2. Each critter pane shows its `identifier-phase` label (e.g. `ACK-74-plan`)
  3. The watcher/main pane is unaffected (it will show a default or empty title, which is fine)
- **Restart resilience:** The `tmux set` calls are idempotent, so restarting critters won't cause errors even if the session settings are already configured.
