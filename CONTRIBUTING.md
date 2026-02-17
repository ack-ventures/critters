# Contributing to Critters

## Getting started

You'll need:

- [Bun](https://bun.sh) (runtime & package manager)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude` command)
- [GitHub CLI](https://cli.github.com) (`gh`) — authenticated via `gh auth login`
- `git`, `tmux`, `jq`

```bash
git clone git@github.com:ack-ventures/critters.git && cd critters
bun install
cp .env.example .env
# Set LINEAR_API_KEY in .env (required)
```

## Development workflow

```bash
bun start              # Run the daemon
bun test               # Run tests
bun run lint           # Lint with Biome
bun run typecheck      # TypeScript type checking
```

The daemon needs a tmux session running (defaults to "critters"):

```bash
tmux new -s critters
bun start
```

## Project structure

| File | What it does |
|---|---|
| `src/index.ts` | Entry point, wiring, signal handlers |
| `src/watcher.ts` | Polls Linear, deduplicates, dispatches to spawner |
| `src/spawner.ts` | Manages the queue, lifecycle, and PR detection |
| `src/claude.ts` | Spawns Claude Code in tmux panes |
| `src/prompt.ts` | Builds planning and execution prompts |
| `src/linear.ts` | Linear SDK wrapper |
| `src/git.ts` | Clone, branch, push, cleanup |
| `src/config.ts` | Loads YAML config + env vars |
| `src/logger.ts` | Timestamped console logging |
| `src/slack.ts` | Slack webhook notifications |
| `src/stream-filter.jq` | jq filter for pretty-printing Claude's stream-json output |

Plans written by critters live in `critters/plans/` and are committed to the repo.

## How it works

1. **Watcher** polls Linear for issues labeled "Critter" in "Todo" status
2. **Spawner** clones the target repo, creates a branch
3. **Planning phase** — Claude explores the codebase and writes an implementation plan
4. **Execution phase** — Claude implements the plan, commits, pushes, and opens a draft PR
5. Linear status updates throughout: Todo → In Progress → In Review (or Critter Failed)

Each phase runs `claude -p` with `--output-format stream-json` in its own tmux pane.

## Submitting changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Make sure `bun test`, `bun run lint`, and `bun run typecheck` pass — CI checks all three
4. Open a pull request against `main`

## Conventions

- All source lives in `src/`
- Named exports only (no default exports)
- Use the logger from `src/logger.ts` instead of bare `console`
- Config comes from `critters.config.yaml` + `.env`

## Critter tickets

Issues labeled "Critter" in Linear get picked up automatically by the daemon. See the [README](README.md#creating-tickets) for details on how to create them.
