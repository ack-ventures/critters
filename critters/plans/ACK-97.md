# ACK-97: Give each critter pane a distinct color scheme for streamed output

## Summary

Replace the hardcoded cyan (`\u001b[36m`) tool-call color in the jq filter with a `$tool_color` variable, passed per-pane via `jq --arg`. This makes concurrent critter panes visually distinguishable by giving each one a unique tool-call color.

**Color assignment is per-pane, not per-critter.** The existing `PANE_COLORS` array rotates via a module-level `colorIndex` that increments on every `spawnClaude()` call. Since each critter runs two phases (planning + execution), each phase gets a separate pane with its own color. This is the existing behavior for `label` and tmux styling — the `toolColor` follows the same pattern. With 4 entries in `PANE_COLORS` and `concurrency: 2`, the colors wrap around naturally.

## Files to modify

### 1. `src/claude.ts`

**Add `toolColor` to each `PANE_COLORS` entry (line 8–13):**

```ts
const PANE_COLORS = [
  { bg: "colour17",  fg: "colour39",  label: "\x1b[1;36m", toolColor: "\x1b[36m"  },  // cyan
  { bg: "colour52",  fg: "colour209", label: "\x1b[1;33m", toolColor: "\x1b[33m"  },  // yellow
  { bg: "colour22",  fg: "colour119", label: "\x1b[1;32m", toolColor: "\x1b[32m"  },  // green
  { bg: "colour53",  fg: "colour177", label: "\x1b[1;35m", toolColor: "\x1b[35m"  },  // magenta
];
```

**Pass `--arg tool_color` to the jq invocation (line 60):**

Change:
```bash
jq --unbuffered -cr -f ${shellEscape(filterFile)}
```

To:
```bash
jq --unbuffered -cr --arg tool_color '${color.toolColor}' -f ${shellEscape(filterFile)}
```

The `color.toolColor` value is interpolated into the bash script template string (same pattern as `color.label` on lines 49/64). TypeScript's `\x1b` produces a real ESC byte (0x1B), which gets written into the `.sh` script file. When bash passes this as a shell argument to `jq --arg`, the raw ESC byte is preserved and jq receives a proper ANSI escape sequence.

### 2. `src/stream-filter.jq`

**Replace the hardcoded tool-call color with `$tool_color`:**

On line 24, change:
```jq
"\u001b[36m\u2192 " + .name +
```
To:
```jq
$tool_color + "\u2192 " + .name +
```

That's the only instance of `\u001b[36m` in the file. The reset code (`\u001b[0m`) on line 36 stays — it terminates whatever color was active.

**Colors left unchanged (as specified in the task):**
- `\u001b[31m` (red) — used for stderr and tool errors — stays hardcoded
- `\u001b[2m` (dim) — used for muted/meta text — stays hardcoded
- `\u001b[1;32m` (bold green) — "Done" message — stays hardcoded
- `\u001b[2;35m` (dim magenta) — subagent model tag — stays hardcoded

### 3. `src/jq-filter.ts`

**Mirror the same change as `stream-filter.jq`:**

This file is an embedded TypeScript string copy of the jq filter. On line 25, change:
```
"\\u001b[36m\\u2192 " + .name +
```
To:
```
$tool_color + "\\u2192 " + .name +
```

Note the escaped backslashes (`\\u001b`) are specific to the TS template literal — the replacement with `$tool_color` requires no escaping since it's a jq variable reference.

## Dependencies / setup

None. No new packages, no config changes, no new files.

## Constraints

- **`$tool_color` must be passed via `--arg` whenever the jq filter is used.** After this change, both `src/stream-filter.jq` and the embedded `STREAM_FILTER` in `src/jq-filter.ts` reference `$tool_color`, which is only defined when `jq --arg tool_color '...'` is provided. The sole call site is `spawnClaude()` in `src/claude.ts`, which always passes the arg. The filter is not used standalone elsewhere, so this is safe.
- **Tmux pane background/foreground styling is out of scope.** The `bg`/`fg` fields in `PANE_COLORS` exist but are not currently applied to tmux panes (no `select-pane -P` call). This is a pre-existing gap unrelated to this task, which focuses on the jq-filtered output colors.

## What does NOT change

- `spawnClaudeSubprocess()` (line 206–268) — this function doesn't use the jq filter (it writes raw JSON to a file), so no changes needed there.
- The tmux pane background/foreground colors (`bg`/`fg` in `PANE_COLORS`) — unchanged.
- The label color (`label` in `PANE_COLORS`) — unchanged.
- Error colors (red `\u001b[31m`) — stay hardcoded across all critters.
- Dim/muted text (`\u001b[2m`) — stays hardcoded across all critters.

## Testing approach

1. **Manual visual test**: Run two critters concurrently and confirm tool-call lines appear in different colors (cyan vs yellow for panes 0 and 1).
2. **Verify jq filter syntax**: Run `echo '{}' | jq --arg tool_color $'\x1b[36m' -f src/stream-filter.jq` to confirm the filter parses without errors (it should output nothing for `{}`, but shouldn't error). Note: use bash `$'...'` ANSI-C quoting to pass a real ESC byte.
3. **Verify files stay in sync**: Confirm `src/jq-filter.ts` and `src/stream-filter.jq` contain equivalent content (the only difference being TS string escaping).
