# Critters

TypeScript daemon that watches Linear for issues labeled "Critter", spawns Claude Code CLI instances to work on them, and produces draft PRs.

## Stack
- Runtime: Bun
- Language: TypeScript (strict)
- Package manager: bun
- Key deps: @linear/sdk, yaml
- Run: `bun run src/index.ts` (or `tmux new -s critters 'bun run src/index.ts'`)

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
    │  5. detect PR via `gh pr list`, update Linear → "In Review"
    ▼
  ReviewWatcher (src/review-watcher.ts) — polls "Critter Review" label in "In Review"
    │  → extracts PR URL from comments, dedup by issue ID
    ▼
  ReviewSpawner (src/review-spawner.ts) — max 2 concurrent
    │  1. shallow clone, checkout PR branch
    │  2. single Claude phase: review diff, approve/request changes
    │  3. If approved + CI green → merge PR → "Done"
    │  4. If needs changes or CI fails → "Human Review"
    ▼
  Human reviews (if needed)
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

## Creating review tickets

To trigger an automated review of a critter's PR:
- **Label**: "Critter Review" (exact match, configurable via `reviewTriggerLabel`)
- **Status**: "In Review"
- The issue must have a comment containing `PR created: <url>` (created automatically by the create critter)

The review watcher picks up matching issues and dispatches a review critter that:
1. Checks out the PR branch and reviews the diff
2. If the code looks good: approves, waits for CI, and merges (squash)
3. If the code needs changes: requests changes on the PR and moves the issue to "Human Review"

Status flow: "In Review" → "Done" (merged) | "Human Review" (needs changes) | "Critter Failed" (error)

## Config (`critters.config.yaml`)

| Field | Default | Description |
|---|---|---|
| `pollIntervalSeconds` | 120 | How often to poll Linear |
| `concurrency` | 2 | Max parallel critters |
| `timeoutMinutes` | 30 | Total timeout per task (both phases) |
| `workDir` | /tmp/critters-work | Temp clone directory |
| `triggerLabel` | "Critter" | Label that triggers pickup |
| `maxPlanningTurns` | 50 | Max Claude turns for planning phase |
| `maxExecutionTurns` | 75 | Max Claude turns for execution phase |
| `defaultAllowedTools` | see file | Tools critters can use |
| `repos` | {} | Project ID → repo URL + extra tools |
| `tmuxSession` | "critters" | Name of the tmux session to use |
| `teamRepos` | {} | Team ID → fallback repo URL |
| `planningModel` | "opus" | Claude model for planning phase |
| `executionModel` | "opus" | Claude model for execution phase |
| `reviewTriggerLabel` | "Critter Review" | Label that triggers review pickup |
| `reviewModel` | "opus" | Claude model for reviews |
| `reviewConcurrency` | 2 | Max parallel review critters |
| `reviewTimeoutMinutes` | 15 | Timeout per review (increase for slow CI) |
| `maxReviewTurns` | 30 | Max Claude turns per review |
| `healthPort` | 3847 | HTTP server port for dashboard and health checks (0 to disable) |
| `maxLogSizeMb` | 10 | Max log file size in MB before rotation (with `--no-tmux`) |
| `hooks` | {} | Shell commands run on lifecycle events |

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
| `src/review-prompt.ts` | Build review prompt, review allowed tools |
| `src/review-spawner.ts` | Review queue, lifecycle, outcome parsing |
| `src/review-watcher.ts` | Review poll loop, PR URL extraction |
| `src/slack.ts` | Webhook notifications |
| `src/dashboard.ts` | Web dashboard HTML rendering |
| `src/health.ts` | HTTP health/dashboard/metrics server |
| `src/metrics.ts` | Metrics recording and retrieval (JSONL) |
| `src/status.ts` | `critters status` CLI command |
| `src/hooks.ts` | Shell hook execution on lifecycle events |
| `src/retry.ts` | Retry logic with exponential backoff |
| `src/cli-retry.ts` | `critters retry` CLI command |
| `src/logs.ts` | `critters logs` CLI command |
| `src/cli-kickoff.ts` | `critters kickoff` CLI command |
| `src/init-repo.ts` | `critters init-repo` CLI command |
| `src/repo-config.ts` | Per-repo `.critters.yaml` loader |
| `src/types.ts` | Shared TypeScript type definitions |
| `src/utils.ts` | Shared utility functions |
| `src/version.ts` | Version constant |
| `src/updater.ts` | Self-update check logic |
| `src/prerequisites.ts` | Startup prerequisite checks |
| `src/init.ts` | `critters init` CLI command |
| `src/jq-filter.ts` | jq filter string for stream-json display |
| `critters/plans/<ID>.md` | Planning phase output — critters write their implementation plans here, committed to the repo |

## Environment variables

- `LINEAR_API_KEY` (required) — in `.env` file
- `SLACK_WEBHOOK_URL` (optional) — for completion notifications

## Build & Binary

- Build: `bun build --compile src/index.ts --outfile dist/critters`
- Also available via: `bun run build`
- Release CI builds for `darwin-arm64` and `linux-x64`
- Bun compiled binaries use virtual paths in `process.argv` (e.g. `/$bunfs/`); use `process.execPath` for the real binary path
- `--no-tmux` flag runs the daemon without tmux, logging to file instead (rotated at `maxLogSizeMb`)
- Auto-update only works when running as a compiled binary (detected by checking `process.execPath` basename isn't `bun`)

## CLI Commands

Usage: `critters [command] [flags]`

| Command | Description |
|---|---|
| *(none)* | Start the daemon |
| `status` | Show daemon status (active/queued critters, uptime, today's stats) |
| `logs <ID>` | View critter logs (`--phase planning\|execution\|review`, `--follow\|-f`) |
| `retry <ID>` | Reset a failed critter to Todo for re-pickup (`--force` to override non-failed states) |
| `kickoff` | Trigger an immediate poll cycle via the health server |
| `init` | Interactive setup — creates `~/.critters/` with config, env, and prompt template files |
| `init-repo` | Scaffold `.critters.yaml` in the current repo |
| `update` | Check for and apply binary updates |
| `version` | Print version |
| `help` | Show help |

### Daemon Flags

| Flag | Description |
|---|---|
| `--dry-run` | Poll once, show what would happen, exit |
| `--no-tmux` | Run without tmux (log to file) |
| `--skip-update` | Skip auto-update check on startup |
| `--config PATH` | Use a custom config file |

## Release / Versioning

- Version constant lives in `src/version.ts` (set to `"dev"` in source; CI embeds the real version at build time)
- `package.json` `version` field must match the git tag (verified by release CI)
- Use `/release` to create a release — it bumps the version in `package.json`, opens a PR, and after merge you tag to trigger the release build
- Release CI (`.github/workflows/release.yml`): triggered by `v*` tags, builds binaries for `darwin-arm64` and `linux-x64`, creates a GitHub Release with SHA-256 checksums
- PR CI (`.github/workflows/ci.yml`): runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun test`
- **Gotcha**: CI checks may fail or not appear on PRs with merge conflicts — resolve conflicts before expecting checks to pass

## Per-repo Configuration (`.critters.yaml`)

Repos can include a `.critters.yaml` at the root to customize critter behavior. The file is loaded after cloning (see `src/repo-config.ts`).

| Field | Type | Description |
|---|---|---|
| `extraAllowedTools` | `string[]` | Additional tools merged with daemon defaults |
| `planningPrompt` | `string` | Custom prompt appended to the planning phase |
| `executionPrompt` | `string` | Custom prompt appended to the execution phase |
| `reviewPrompt` | `string` | Custom prompt appended to the review phase |

All fields are optional. Run `critters init-repo` to scaffold the file.

Daemon-level prompt customization is also available via `~/.critters/planning-prompt.md`, `execution-prompt.md`, and `review-prompt.md` (created by `critters init`).

## Hooks

Shell commands run on lifecycle events. Configure in `critters.config.yaml` under `hooks`:

```yaml
hooks:
  onTaskStarted: "curl -s https://example.com/notify"
  onPrCreated: "echo $CRITTER_PR_URL"
```

| Hook | Triggered when |
|---|---|
| `onTaskStarted` | Critter begins working on an issue |
| `onPrCreated` | PR is successfully created |
| `onTaskFailed` | Task fails (any phase) |
| `onReviewStarted` | Review critter picks up a PR |
| `onMerged` | Review critter merges a PR |
| `onNeedsChanges` | Review critter requests changes |

Each hook receives environment variables: `CRITTER_ISSUE_ID`, `CRITTER_IDENTIFIER`, `CRITTER_TITLE`, `CRITTER_REPO_URL`, `CRITTER_BRANCH`. PR-related hooks (`onPrCreated`, `onReviewStarted`, `onMerged`, `onNeedsChanges`) also get `CRITTER_PR_URL`. Hooks time out after 30 seconds. Failures are logged as warnings but don't fail the task.

## Slack Notifications

Set `SLACK_WEBHOOK_URL` in `.env` to receive Slack messages. Notifications are sent for:

- Task picked up (cloning started)
- Planning complete
- PR created (success)
- Task failed
- Timeout warning (at 80% of `timeoutMinutes`)
- Review started
- Review merged
- Review needs changes
- Review failed

Messages use Slack incoming webhook format (`{ text: "..." }`). Failed sends are retried up to 2 times with exponential backoff. Notification failures are logged but don't fail the task.

## Dashboard & Health Server

An HTTP server starts on `healthPort` (default 3847, set to 0 to disable).

| Endpoint | Method | Description |
|---|---|---|
| `/` or `/dashboard` | GET | HTML dashboard with summary stats, charts (14-day tasks/cost), and recent activity table. Auto-refreshes every 30s. |
| `/healthz` | GET | JSON health check: uptime, version, active/queued counts, last poll time, metrics summary |
| `/metrics` | GET | JSON array of recent metric events (last 100) |
| `/poll` | POST | Trigger an immediate critter poll cycle |
| `/review-poll` | POST | Trigger an immediate review poll cycle |

Metrics are stored in `~/.critters/metrics.jsonl` (JSONL format). Events: `task_started`, `task_completed`, `task_failed`, `review_started`, `review_completed`, `review_failed`, `poll_completed`.
