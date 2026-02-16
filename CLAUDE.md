# Critters

TypeScript daemon that watches Linear for issues labeled "Critter", spawns Claude Code CLI instances to work on them, and produces draft PRs.

## Stack
- Runtime: Bun
- Language: TypeScript (strict)
- Package manager: bun
- Key deps: @linear/sdk, yaml
- Run: `bun run src/index.ts` (or `tmux new -s critters 'cd /Users/andrew/dev/critters && bun run src/index.ts'`)

## Conventions
- All source in `src/`
- No default exports — use named exports
- Use `console` via `src/logger.ts` wrapper (timestamped)
- Config loaded from `critters.config.yaml` + `.env`
- jq filter for stream output lives in `src/stream-filter.jq` (not a JS template — edit directly)

## Architecture

```
Linear (issues with "Critter" label in "Todo")
    │  ← polls every 120s
    ▼
  Watcher (src/watcher.ts)
    │  → dedup by issue ID, resolve repo URL
    ▼
  Spawner (src/spawner.ts) — max 2 concurrent
    │  1. shallow clone → /tmp/critters-work/<ID>-<timestamp>
    │  2. create branch critter/<ID>-<slug>
    │  3. Phase 1: planning Claude (explores, writes plan, reviewer loop)
    │  4. Phase 2: execution Claude (implements plan, commits, pushes, creates PR)
    │  5. detect PR via `gh pr list`, update Linear
    ▼
  Human reviews draft PR
```

Each phase runs `claude -p` with `--output-format stream-json` in a tmux pane. Output is piped through `jq` using `src/stream-filter.jq` for readable display.

## Creating Linear tickets for critters

Issues must have:
- **Label**: "Critter" (exact match)
- **Status**: "Todo"
- **Description**: must include `repo: git@github.com:org/repo.git` on its own line (unless a project/team mapping exists in config)

Optional but recommended:
- **Project**: assign to the relevant Linear project
- Put implementation guidance in the description — the critter reads it as its task spec

The watcher picks up matching issues every 120 seconds. Once picked up, status moves to "In Progress" → "In Review" (on PR) or "Critter Failed" (on error).

## Config (`critters.config.yaml`)

| Field | Default | Description |
|---|---|---|
| `pollIntervalSeconds` | 120 | How often to poll Linear |
| `concurrency` | 2 | Max parallel critters |
| `timeoutMinutes` | 30 | Total timeout per task (both phases) |
| `workDir` | /tmp/critters-work | Temp clone directory |
| `triggerLabel` | "Critter" | Label that triggers pickup |
| `maxTurns` | 50 | Max Claude turns per phase |
| `defaultAllowedTools` | see file | Tools critters can use |
| `repos` | {} | Project ID → repo URL + extra tools |
| `teamRepos` | {} | Team ID → fallback repo URL |

### Allowed tools

Critters run with `--allowedTools` restricting what they can do. The default set is in `critters.config.yaml`. Per-repo overrides merge with defaults:

```yaml
repos:
  "project-uuid":
    url: "git@github.com:org/repo.git"
    extraAllowedTools:
      - "Bash(python:*)"
      - "Bash(pip:*)"
```

Planning phase gets a read-only subset (Read, Glob, Grep, Write, Task + basic Bash).

## Key files

| File | Purpose |
|---|---|
| `src/index.ts` | Entry point, wiring, signal handlers |
| `src/watcher.ts` | Poll loop, dedup, dispatch |
| `src/spawner.ts` | Queue, lifecycle, PR detection |
| `src/claude.ts` | tmux pane spawning, stream-json piping |
| `src/prompt.ts` | Build planning/execution prompts, parse repo URL |
| `src/linear.ts` | Linear SDK wrapper (issues, statuses, comments) |
| `src/git.ts` | Clone, branch, commit, cleanup |
| `src/stream-filter.jq` | jq filter for pretty-printing stream-json |
| `src/config.ts` | Load YAML + env |
| `src/logger.ts` | Timestamped console logging |
| `src/slack.ts` | Webhook notifications |
| `critters/plans/<ID>.md` | Planning phase output — critters write their implementation plans here, committed to the repo |

## Environment variables

- `LINEAR_API_KEY` (required) — in `.env` file
- `SLACK_WEBHOOK_URL` (optional) — for completion notifications
