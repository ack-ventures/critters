# ACK-55: Set tmux main-horizontal layout after spawning a new pane

## Summary

After each new tmux pane is created in `src/claude.ts`, apply the `main-horizontal` layout to the critters session. This keeps the main watcher/spawner pane across the top with critter panes arranged side-by-side below it, instead of the default repeated horizontal splits that make panes increasingly narrow.

Target layout:
```
┌──────────────────────────┐
│   watcher / spawner      │
├────────────┬─────────────┤
│  critter 1 │  critter 2  │
└────────────┴─────────────┘
```

## Files to modify

### 1. `src/claude.ts` — modify

**Change:** Add a single `select-layout` call after the successful `split-window` on line 86, before reading the pane ID on line 93.

Specifically, insert after the error-check block (line 88–91) and before `const paneId = tmuxResult.stdout.trim();` (line 93):

```typescript
  // Apply main-horizontal layout so the watcher stays on top
  await runCommand("tmux", ["select-layout", "-t", TMUX_SESSION, "main-horizontal"]).catch(() => {});
```

**Why `.catch(() => {})`:** The layout command is cosmetic — if it fails (e.g., only one pane exists), it should not abort the critter spawn. This matches the existing pattern at line 116 where `kill-pane` also uses `.catch(() => {})`.

**No other changes needed.** No new imports, no new functions, no config changes.

## What NOT to change

- No changes to `critters.config.yaml`
- No changes to `src/spawner.ts` or any other files
- No changes to the `split-window` arguments (the `-h` flag is fine — `select-layout` will rearrange everything afterward)

## Dependencies / setup

None. `tmux select-layout` is a built-in tmux command available in all versions.

## Testing approach

1. **Manual verification**: Run `bun run src/index.ts` inside a tmux session named `critters`, trigger two critter tasks, and visually confirm the main-horizontal layout is applied (top pane stays full-width, bottom panes are side-by-side).
2. **Typecheck**: Run `bun run typecheck` to confirm no type errors are introduced.
3. **Lint**: Run `bun run lint` to confirm no lint violations.
4. **Single pane case**: Confirm that when only one critter pane exists, the layout command doesn't error out (the `.catch(() => {})` handles this gracefully).
