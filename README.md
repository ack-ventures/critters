# Critters

Critters is a TypeScript daemon that polls issue trackers ([Linear](https://linear.app) and [Jira](https://www.atlassian.com/software/jira)) for issues labeled "Critter", spawns [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI instances to plan and implement the work, and opens draft pull requests for human review. It runs on [Bun](https://bun.sh) and orchestrates everything through `tmux` panes.

Inspired by [Stripe's Minions](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/ack-ventures/critters/main/install.sh | bash
```

This downloads the latest binary, installs it to your PATH, and walks you through initial setup.

### Commands

- `critters` — start the daemon
- `critters version` — show version
- `critters update` — check for and apply updates
- `critters init` — (re-)configure `~/.critters/`
- `critters status` — show daemon status (active/queued critters, today's stats)
- `critters retry <ID>` — retry a failed critter (reset to Todo)
- `critters logs <ID>` — show logs for a critter run
- `critters kickoff` — trigger an immediate poll (instead of waiting for the next interval)
- `critters init-repo` — scaffold `.critters.yaml` in the current repo
- `critters validate` — validate config file without starting daemon
- `critters help` — show usage

### Flags

- `--dry-run` — poll once, show what would happen, and exit
- `--no-tmux` — run without tmux (log to file instead)
- `--skip-update` — skip auto-update check on startup
- `--config PATH` — use a custom config file

## Development quick start

**Prerequisites:** [Bun](https://bun.sh), [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code), [`gh` CLI](https://cli.github.com) (authenticated), `tmux`, `jq`

```bash
# Clone and install
git clone https://github.com/ack-ventures/critters && cd critters
bun install

# Configure
cp .env.example .env
# Edit .env and set LINEAR_API_KEY (for Linear) and/or JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN (for Jira)
# Optionally set SLACK_WEBHOOK_URL for completion notifications

# Optionally tweak critters.config.yaml

# Run
bun start
# or: bun run src/index.ts
```

## How it works

1. **Watcher** polls your issue tracker (Linear and/or Jira) every 120 seconds for issues with the "Critter" label in "Todo" status.
2. **Spawner** shallow-clones the target repo into a temp directory and creates a feature branch.
3. **Phase 1 (Planning):** A Claude instance explores the codebase and writes an implementation plan.
4. **Phase 2 (Execution):** A second Claude instance implements the plan, commits, pushes, and opens a draft PR.
5. Status updates flow back to the issue tracker: Todo &rarr; In Progress &rarr; In Review (on PR) or Critter Failed (on error).

## Configuration

Settings live in `critters.config.yaml`:

| Field | Default | Description |
|---|---|---|
| `provider` | "linear" | Default issue tracker: `"linear"` or `"jira"` |
| `pollIntervalSeconds` | 120 | How often to poll for issues |
| `concurrency` | 2 | Max parallel critters |
| `timeoutMinutes` | 30 | Total timeout per task (both phases) |
| `workDir` | /tmp/critters-work | Temp clone directory |
| `triggerLabel` | "Critter" | Label that triggers pickup |
| `maxPlanningTurns` | 50 | Max Claude turns for planning phase |
| `maxExecutionTurns` | 75 | Max Claude turns for execution phase |
| `defaultAllowedTools` | see file | Tools critters can use |
| `repos` | {} | Project ID &rarr; repo URL + extra tools |
| `teamRepos` | {} | Team ID &rarr; fallback repo URL |
| `tmuxSession` | "critters" | Name of the tmux session to use |
| `planningModel` | "opus" | Claude model for planning phase |
| `executionModel` | "opus" | Claude model for execution phase |
| `healthPort` | 3847 | HTTP server port for dashboard and health checks (0 to disable) |
| `maxLogSizeMb` | 10 | Max log file size in MB before rotation (with `--no-tmux`) |
| `jiraStatusMap` | {} | Map critter status names to Jira workflow status names |
| `hooks` | {} | Shell commands run on lifecycle events (see below) |

Per-repo tool overrides merge with the defaults:

```yaml
repos:
  "project-uuid":
    url: "git@github.com:org/repo.git"
    extraAllowedTools:
      - "Bash(python:*)"
      - "Bash(pip:*)"
```

### Hooks

Shell commands that run on lifecycle events. Environment variables available: `CRITTER_ISSUE_ID`, `CRITTER_IDENTIFIER`, `CRITTER_TITLE`, `CRITTER_REPO_URL`, `CRITTER_BRANCH`, `CRITTER_PR_URL` (when applicable).

```yaml
hooks:
  onTaskStarted: "echo 'Task started'"
  onPrCreated: "curl -X POST https://example.com/notify"
  onMerged: "./scripts/post-merge.sh"
  onTaskFailed: ""
  onReviewStarted: ""
  onNeedsChanges: ""
```

## Web Dashboard

The daemon runs an HTTP server on port 3847 (configurable via `healthPort`, set to 0 to disable).

| Route | Description |
|---|---|
| `/` or `/dashboard` | Live dashboard with task stats, charts, and recent activity |
| `/healthz` | JSON health check (uptime, version, per-type active/queued counts, active critter details, metrics summary) |
| `/metrics` | JSON array of recent metric events |

`critters status` queries the health endpoint to display a quick summary in the terminal.

## Creating tickets

Works with both Linear and Jira. For a critter to pick up an issue, it needs:

- **Label:** "Critter" (exact match, configurable)
- **Status:** "Todo" (Linear) or the mapped status via `jiraStatusMap` (Jira)
- **Description:** must include `repo: git@github.com:org/repo.git` on its own line (unless a project or team mapping exists in the config)

Optionally, assign the issue to the relevant project and include implementation guidance in the description -- the critter reads it as its task spec.

## Custom critter types

Beyond the built-in create and review flows, you can define custom critter types in `critters.config.yaml`. Each type gets its own trigger label, phase pipeline, model, tools, and outcome statuses.

```yaml
critterTypes:
  code-audit:
    trigger: { label: "Code Audit", status: "Todo", statusType: "unstarted" }
    repo: { clone: true }
    phases:
      - name: audit
        prompt: ~/.critters/prompts/code-audit.md
        model: sonnet
        maxTurns: 20
        tools: [Read, Glob, Grep, "Bash(git:*)", "Bash(ls:*)"]
    outcomes:
      success: { status: "Done", comment: true }
      failure: { status: "Critter Failed", comment: true }
    concurrency: 3
    timeoutMinutes: 10
```

Custom types automatically:
- Prompt Claude to write a `.critter-report.md` file
- Upload the report as a `.md` attachment on the issue
- Post the report as an inline comment

Prompt files support `{{identifier}}`, `{{title}}`, `{{description}}`, and other variables. See [CLAUDE.md](CLAUDE.md) for the full reference.

**Assignee filtering:** Add `trigger.assignee` to only pick up issues assigned to a specific user. Use an email address (e.g., `"alice@company.com"`) or `"me"` for the authenticated user. Useful in shared projects where you don't want critters picking up every labeled issue.

**Model guidance:** Use sonnet or opus for custom types. Haiku often ignores tool-use instructions and produces shallow output.

If `critterTypes` is omitted from config, the daemon synthesizes the default `create` and `review` types from the flat config fields — fully backward compatible.

## Multi-provider (Linear + Jira)

A single daemon can poll both Linear and Jira. Set the default provider at the top level, then use `provider` on each critter type to override:

```yaml
provider: linear  # default

jiraStatusMap:
  "Todo": "To Do"
  "In Progress": "In Progress"
  "In Review": "In Review"
  "Done": "Done"
  "Critter Failed": "Failed"

critterTypes:
  create:
    provider: [linear, jira]   # polls both trackers with the same config
    trigger: { label: "Critter", status: "Todo", statusType: "unstarted" }
    repo: { clone: true, branch: true }
    phases:
      - name: planning
        prompt: builtin:planning
        model: opus
        maxTurns: 50
        tools: readonly
      - name: execution
        prompt: builtin:execution
        model: opus
        maxTurns: 75
        tools: default
    outcomes:
      success: { status: "In Review" }
      failure: { status: "Critter Failed" }
    concurrency: 2
    timeoutMinutes: 30
```

`provider` accepts a single value (`"linear"`, `"jira"`) or an array (`[linear, jira]`). When an array is used, the type is expanded internally so each provider is polled independently — no need to duplicate config.

Only the env vars for providers you actually use are required. A Linear-only config doesn't need `JIRA_*` vars.

See [CLAUDE.md](CLAUDE.md) for full multi-provider docs, Jira differences, and more config examples.

## Tips from usage

- **Create a `/critter` slash command in Claude Code** to speed up ticket creation. Instead of manually formatting Linear issues, describe what you want and let Claude create the ticket with the right label, status, and `repo:` line. You can batch-create several at once.

- **Claude Max 20x is ideal for running lots of critters.** Each critter spawns `claude -p` under the hood, so having lots of tokens to available to you is a good thing.

- **Map projects to repos in the config** so you don't need a `repo:` line in every ticket description. Once a project is mapped, any "Critter"-labeled issue in that project automatically targets the right repo.

- **Put a sentence or two of direction in the ticket description.** "Use the existing `AuthService` pattern" or "add tests in `__tests__/`" makes a real difference in PR quality. Vague tickets produce vague PRs.

- **Set up a Slack webhook** to get notified when critters finish or fail, so you don't have to watch the tmux session.

- **Plans are committed to `critters/plans/`** in the target repo's branch. You can review what the critter intended before looking at the code diff.

- **Use a `/batch-review` slash command with Claude Code agent teams** to review multiple critter PRs at once. Spin up one agent per PR in separate git worktrees and let them review, fix, and merge in parallel.

---

See [CLAUDE.md](CLAUDE.md) for detailed developer docs, architecture diagrams, and contributor conventions.
