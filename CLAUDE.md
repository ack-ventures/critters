# Critters

TypeScript daemon that watches issue trackers (Linear/Jira) for labeled issues, spawns Claude Code CLI instances to work on them, and produces draft PRs.

## Stack
- Runtime: Bun
- Language: TypeScript (strict)
- Package manager: bun
- Key deps: @linear/sdk, yaml

## Commands
- `bun install` — install dependencies
- `bun start` — run the daemon (or `bun run src/index.ts`)
- `bun run build` — compile binary
- `bun run lint` — lint
- `bun run typecheck` — type check
- `bun test` — run tests

## Conventions
- All source in `src/`
- No default exports — use named exports
- Use `console` via `src/logger.ts` wrapper (timestamped)
- Config loaded from `critters.config.yaml` + `.env`
- jq filter for stream output lives in `src/stream-filter.jq` (not a JS template — edit directly)

## Architecture

```
Watcher (src/unified-watcher.ts) — polls trackers per critter type
    ▼
Spawner (src/unified-spawner.ts) — per-type queues, lifecycle
    │  clone → branch → run phases → handle outcomes
    ▼
Phase Runners (src/runner/)
    ├─ PlanningPhaseRunner  (builtin:planning)
    ├─ ExecutionPhaseRunner (builtin:execution)
    ├─ ReviewPhaseRunner    (builtin:review)
    └─ GenericPhaseRunner   (custom prompts → .critter-report.md)
```

Each phase runs `claude -p` with `--output-format stream-json` in a tmux pane, piped through jq for display.

## Key files

| File | Purpose |
|---|---|
| `src/index.ts` | Entry point, wiring, signal handlers |
| `src/unified-watcher.ts` | Single poll loop for all critter types |
| `src/unified-spawner.ts` | Per-type queues, lifecycle, phase pipeline |
| `src/critter-type.ts` | CritterTypeConfig, synthesizeDefaultTypes() |
| `src/tracker/types.ts` | IssueTracker interface, TrackerTask |
| `src/tracker/linear.ts` | LinearTracker (wraps Linear SDK) |
| `src/tracker/jira.ts` | JiraTracker (Jira Cloud REST API) |
| `src/runner/types.ts` | PhaseRunner interface, PhaseContext |
| `src/runner/planning.ts` | Planning phase (plan + reviewer loop) |
| `src/runner/execution.ts` | Execution phase (implement, commit, push, PR) |
| `src/runner/review.ts` | Review phase (diff review, approve/merge) |
| `src/runner/generic.ts` | Generic phase (custom types, .critter-report.md) |
| `src/cli/claude.ts` | ClaudeCodeAdapter (CLI integration) |
| `src/cli/spawn.ts` | tmux/subprocess spawning |
| `src/prompt-template.ts` | resolvePrompt(), variable substitution |
| `src/config.ts` | Load YAML + env, parse critterTypes |
| `src/git.ts` | Clone, branch, commit, cleanup |
| `critters/plans/<ID>.md` | Planning phase output (committed to target repo) |

See `README.md` for setup, configuration, CLI commands, custom types, and usage docs.
