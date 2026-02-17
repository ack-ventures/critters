# Critters

Critters is a TypeScript daemon that polls [Linear](https://linear.app) for issues labeled "Critter", spawns [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI instances to plan and implement the work, and opens draft pull requests for human review. It runs on [Bun](https://bun.sh) and orchestrates everything through `tmux` panes.

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
- `critters help` — show usage

## Development quick start

**Prerequisites:** [Bun](https://bun.sh), [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code), [`gh` CLI](https://cli.github.com) (authenticated), `tmux`, `jq`

```bash
# Clone and install
git clone https://github.com/ack-ventures/critters && cd critters
bun install

# Configure
cp .env.example .env
# Edit .env and set LINEAR_API_KEY (required)
# Optionally set SLACK_WEBHOOK_URL for completion notifications

# Optionally tweak critters.config.yaml

# Run
bun start
# or: bun run src/index.ts
```

## How it works

1. **Watcher** polls Linear every 120 seconds for issues with the "Critter" label in "Todo" status.
2. **Spawner** shallow-clones the target repo into a temp directory and creates a feature branch.
3. **Phase 1 (Planning):** A Claude instance explores the codebase and writes an implementation plan.
4. **Phase 2 (Execution):** A second Claude instance implements the plan, commits, pushes, and opens a draft PR.
5. Status updates flow back to Linear: Todo &rarr; In Progress &rarr; In Review (on PR) or Critter Failed (on error).

## Configuration

Settings live in `critters.config.yaml`:

| Field | Default | Description |
|---|---|---|
| `pollIntervalSeconds` | 120 | How often to poll Linear |
| `concurrency` | 2 | Max parallel critters |
| `timeoutMinutes` | 30 | Total timeout per task (both phases) |
| `workDir` | /tmp/critters-work | Temp clone directory |
| `triggerLabel` | "Critter" | Label that triggers pickup |
| `maxTurns` | 50 | Max Claude turns per phase |
| `defaultAllowedTools` | see file | Tools critters can use |
| `repos` | {} | Project ID &rarr; repo URL + extra tools |
| `teamRepos` | {} | Team ID &rarr; fallback repo URL |

Per-repo tool overrides merge with the defaults:

```yaml
repos:
  "project-uuid":
    url: "git@github.com:org/repo.git"
    extraAllowedTools:
      - "Bash(python:*)"
      - "Bash(pip:*)"
```

## Creating tickets

For a critter to pick up a Linear issue, it needs:

- **Label:** "Critter" (exact match)
- **Status:** "Todo"
- **Description:** must include `repo: git@github.com:org/repo.git` on its own line (unless a project or team mapping exists in the config)

Optionally, assign the issue to the relevant Linear project and include implementation guidance in the description -- the critter reads it as its task spec.

## Tips from usage

- **Create a `/critter` slash command in Claude Code** to speed up ticket creation. Instead of manually formatting Linear issues, describe what you want and let Claude create the ticket with the right label, status, and `repo:` line. You can batch-create several at once.

- **Claude Max 20x is ideal for running lots of critters.** Each critter spawns `claude -p` under the hood, so having lots of tokens to available to you is a good thing.

- **Map Linear projects to repos in the config** so you don't need a `repo:` line in every ticket description. Once a project is mapped, any "Critter"-labeled issue in that project automatically targets the right repo.

- **Put a sentence or two of direction in the ticket description.** "Use the existing `AuthService` pattern" or "add tests in `__tests__/`" makes a real difference in PR quality. Vague tickets produce vague PRs.

- **Set up a Slack webhook** to get notified when critters finish or fail, so you don't have to watch the tmux session.

- **Plans are committed to `critters/plans/`** in the target repo's branch. You can review what the critter intended before looking at the code diff.

- **Use a `/batch-review` slash command with Claude Code agent teams** to review multiple critter PRs at once. Spin up one agent per PR in separate git worktrees and let them review, fix, and merge in parallel.

---

See [CLAUDE.md](CLAUDE.md) for detailed developer docs, architecture diagrams, and contributor conventions.
