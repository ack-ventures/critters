# ACK-75: Increase poll interval to 120 seconds

## Summary

Change the Linear polling interval from 30 seconds to 120 seconds. The current 30s interval is too aggressive — the Mac mini goes to sleep and may cause issues (e.g., 500 errors from Linear) when it wakes up. 120s is plenty fast for picking up new tickets.

## Files to modify

### 1. `critters.config.yaml` (line 1)

Change:
```yaml
pollIntervalSeconds: 30
```
To:
```yaml
pollIntervalSeconds: 120
```

### 2. `CLAUDE.md` — Architecture diagram (line 23)

Update the comment in the ASCII architecture diagram from:
```
    │  ← polls every 30s
```
To:
```
    │  ← polls every 120s
```

### 3. `CLAUDE.md` — Config table (line 57)

Update the default value in the config documentation table from:
```
| `pollIntervalSeconds` | 30 | How often to poll Linear |
```
To:
```
| `pollIntervalSeconds` | 120 | How often to poll Linear |
```

### 4. `CLAUDE.md` — Creating Linear tickets section (line 51)

Update the prose from:
```
The watcher picks up matching issues every 30 seconds.
```
To:
```
The watcher picks up matching issues every 120 seconds.
```

## Files NOT changed (and why)

- **`src/config.ts`** (line 85): The fallback default `?? 30` is only used when the YAML key is missing entirely. Since we're setting the value explicitly in the config file, this fallback is not reached. Changing it is out of scope — the task only asks to change the config value.
- **`src/watcher.ts`**: Reads `config.pollIntervalSeconds` dynamically — no hardcoded values to update.
- **`src/config.ts` validation** (line 126): The minimum is `>= 5`, so 120 passes validation with no issue.

## Dependencies / setup

None. This is a config-only change with a documentation update.

## Testing approach

1. Verify `critters.config.yaml` has `pollIntervalSeconds: 120`
2. Verify all three references in `CLAUDE.md` are updated to reflect 120s
3. Confirm `src/config.ts` validation still passes (120 >= 5 ✓)
4. No runtime tests needed — this is a static config value read at startup
