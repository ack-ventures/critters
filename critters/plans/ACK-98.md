# ACK-98: Add a 5th color to the critter pane rotation

## Summary

Add a 5th entry to the `PANE_COLORS` array in `src/claude.ts` so the color rotation covers 5 concurrent critters without repeating. The new color is a **white/bright white** theme with a dark grey background to contrast with the existing palette (cyan, yellow, green, magenta).

## Files to modify

### `src/claude.ts` (line ~12)

Add a new entry to the `PANE_COLORS` array after the magenta entry (line 12), before the closing `];` (line 13):

```typescript
{ bg: "colour234", fg: "colour255", label: "\x1b[1;37m", toolColor: "\x1b[37m"  },  // white
```

**Details:**
- `bg: "colour234"` — dark grey background (matches the task spec and contrasts well in terminal)
- `fg: "colour255"` — bright white foreground text
- `label: "\x1b[1;37m"` — bold white ANSI escape for the pane header labels (follows the existing pattern of bold + color)
- `toolColor: "\x1b[37m"` — white ANSI escape for tool output coloring (non-bold variant, consistent with other entries where `toolColor` is the non-bold version of `label`)

**Why `toolColor` is included:** Every existing entry has a `toolColor` property, and it is passed to jq at line 60 (`--arg tool_color '${color.toolColor}'`). Omitting it would cause `undefined` to be interpolated into the shell command, breaking the jq filter for every 5th critter.

## No other files need changes

The `PANE_COLORS` array is only consumed in `src/claude.ts` via `PANE_COLORS[colorIndex % PANE_COLORS.length]` (line 37). Increasing the array length from 4 to 5 requires no changes elsewhere — the modular indexing handles it automatically.

## Dependencies / setup

None. This is a single-line addition to an existing array.

## Testing approach

1. **Visual verification:** The change is a static data addition. Confirm the array has 5 entries and each has all 4 required properties (`bg`, `fg`, `label`, `toolColor`).
2. **Type check:** Run `bunx tsc --noEmit` to ensure no TypeScript errors.
3. **Runtime check:** With 5 critters running, verify each gets a distinct color and the 5th critter uses the white theme (dark grey bg, bright white text).
4. **Modular arithmetic:** With the array length now 5, `colorIndex % 5` cycles through indices 0–4, so the 6th critter wraps back to cyan (index 0). No off-by-one issues.
