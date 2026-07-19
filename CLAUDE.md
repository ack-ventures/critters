# Critters

TypeScript daemon that watches issue trackers (Linear/Jira/GitHub Issues) for labeled issues, spawns Claude Code CLI instances to work on them, and produces draft PRs.

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
- Dashboard client code (`src/dashboard/client/**`, including `styles.css`) is bundled into `src/dashboard/bundle.ts` at build time. After editing anything under `client/`, run `bun run build:dashboard` and commit the regenerated `bundle.ts` alongside your change — the daemon serves from `bundle.ts`, not the source files.

## Architecture

```
CLI (src/index.ts) — thin entry point
    ├─ cli-router.ts — subcommand dispatch (kill, retry, list, etc.)
    └─ daemon.ts — wiring, signal handlers, daemon lifecycle
         ▼
Watcher (src/unified-watcher.ts) — polls trackers per critter type
         ▼
Spawner (src/unified-spawner.ts) — per-type queues, lifecycle
    │  clone → branch → run phases → handle outcomes
    ├─ task-outcome.ts — applyOutcome(), post-phase result handling
    └─ task-salvage.ts — salvagePartialProgress(), timeout recovery
         ▼
Phase Runners (src/runner/)
    ├─ PlanningPhaseRunner  (builtin:planning)
    ├─ ExecutionPhaseRunner (builtin:execution)
    ├─ ReviewPhaseRunner    (builtin:review)
    ├─ GenericPhaseRunner   (custom prompts → .critter-report.md)
    └─ validate.ts          (phase config validation)
```

Each phase runs `claude -p` with `--output-format stream-json` in a tmux pane, piped through jq for display.

## Key files

| File | Purpose |
|---|---|
| `src/index.ts` | Thin entry point (routes to cli-router or daemon) |
| `src/cli-router.ts` | Subcommand dispatch (kill, retry, list, etc.) |
| `src/daemon.ts` | Daemon lifecycle, wiring, signal handlers |
| `src/unified-watcher.ts` | Single poll loop for all critter types |
| `src/unified-spawner.ts` | Per-type queues, lifecycle, phase pipeline |
| `src/task-outcome.ts` | applyOutcome(), post-phase result handling |
| `src/task-salvage.ts` | salvagePartialProgress(), timeout recovery, log files |
| `src/critter-type.ts` | CritterTypeConfig, synthesizeDefaultTypes() |
| `src/enums.ts` | Shared enums (PhaseStatus, etc.) |
| `src/config.ts` | Load YAML + env, parse critterTypes |
| `src/config-reload.ts` | Hot-reload config on SIGHUP |
| `src/circuit-breaker-factory.ts` | Per-tracker circuit breaker creation |
| `src/tracker/types.ts` | IssueTracker interface, TrackerTask |
| `src/tracker/linear.ts` | LinearTracker (wraps Linear SDK) |
| `src/tracker/jira.ts` | JiraTracker (Jira Cloud REST API) |
| `src/tracker/github.ts` | GitHubTracker (GitHub Issues REST; dual-mode statuses: org issue field or status:* labels) |
| `src/tracker/provider-config.ts` | buildProviderConfig() — single ProviderConfig construction point |
| `src/runner/types.ts` | PhaseRunner interface, PhaseContext |
| `src/runner/planning.ts` | Planning phase (plan + reviewer loop) |
| `src/runner/execution.ts` | Execution phase (implement, commit, push, PR) |
| `src/runner/review.ts` | Review phase (diff review, approve/merge) |
| `src/runner/generic.ts` | Generic phase (custom types, .critter-report.md) |
| `src/runner/validate.ts` | Phase configuration validation |
| `src/cli/claude.ts` | ClaudeCodeAdapter (CLI integration) |
| `src/cli/spawn.ts` | tmux/subprocess spawning |
| `src/cli/parse-review.ts` | Parse review CLI output |
| `src/dashboard/` | Dashboard UI (main-page, issue-page, log-page, helpers) |
| `src/prompt-template.ts` | resolvePrompt(), variable substitution |
| `src/git.ts` | Clone, branch, commit, cleanup |
| `critters/plans/<ID>.md` | Planning phase output (committed to target repo) |

See `README.md` for setup, configuration, CLI commands, custom types, and usage docs.
