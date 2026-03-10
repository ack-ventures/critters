# Critters

TypeScript daemon that watches issue trackers (Linear and Jira) for issues labeled "Critter", spawns Claude Code CLI instances to work on them, and produces draft PRs.

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
   Required (for Linear): `LINEAR_API_KEY` — your Linear API key
   Required (for Jira): `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_API_TOKEN`
   Optional: `SLACK_WEBHOOK_URL` — for Slack notifications
   Optional: `SLACK_BOT_TOKEN` + `SLACK_CHANNEL` — for threaded Slack notifications
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
Linear / Jira (issues matching any critter type trigger)
    │  ← polls every 120s (per-type, per-provider)
    ▼
  UnifiedWatcher (src/unified-watcher.ts)
    │  → per-type dedup, resolves repo URL
    │  → type-specific enrichment (e.g., extractPrUrl for review)
    ▼
  UnifiedSpawner (src/unified-spawner.ts) — per-type queues
    │  1. shallow clone → /tmp/critters-work/<ID>-<timestamp>
    │  2. create branch (if type.repo.branch)
    │  3. run phase pipeline sequentially
    │  4. handle outcomes (status update, report upload, comment)
    ▼
  Phase Runners (src/runner/)
    ├─ PlanningPhaseRunner  (builtin:planning — plan + reviewer loop)
    ├─ ExecutionPhaseRunner (builtin:execution — implement, commit, push, PR)
    ├─ ReviewPhaseRunner    (builtin:review — review diff, approve/merge)
    └─ GenericPhaseRunner   (custom prompts → .critter-report.md)
```

Each phase runs `claude -p` with `--output-format stream-json` in a tmux pane. Output is piped through `jq` using `src/stream-filter.jq` for readable display.

## Creating tickets for critters

Works with both Linear and Jira. Issues must have:
- **Label**: "Critter" (exact match, configurable via `trigger.label`)
- **Status**: "Todo" (Linear) or the mapped Jira status (configurable via `jiraStatusMap`)
- **Description**: must include `repo: git@github.com:org/repo.git` on its own line (unless a project/team mapping exists in config)

Optional but recommended:
- **Project**: assign to the relevant project
- Put implementation guidance in the description — the critter reads it as its task spec

The unified watcher picks up matching issues every 120 seconds. Once picked up, status moves to "In Progress" → "In Review" (on PR) or "Critter Failed" (on error).

## Creating review tickets

To trigger an automated review of a critter's PR:
- **Label**: "Critter Review" (exact match, configurable via `reviewTriggerLabel` or `trigger.label`)
- **Status**: "In Review"
- The issue must have a comment containing `PR created: <url>` (created automatically by the create critter)

The unified watcher picks up matching issues and dispatches a review critter that:
1. Checks out the PR branch and reviews the diff
2. If the code looks good: approves, waits for CI, and merges (squash)
3. If the code needs changes: requests changes on the PR and moves the issue to "Human Review"

Status flow: "In Review" → "Done" (merged) | "Human Review" (needs changes) | "Critter Failed" (error)

## Custom Critter Types

The `critterTypes` config section lets you define custom agent types beyond the built-in `create` and `review`. Each type has its own trigger, phase pipeline, tools, concurrency, and outcomes.

If `critterTypes` is omitted, the daemon synthesizes the default `create` and `review` types from the flat config fields (full backward compatibility).

### Example: read-only audit type

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

### Custom type behavior

- **Prompt files** support `{{var}}` substitution: `{{identifier}}`, `{{title}}`, `{{description}}`, `{{branch}}`, `{{repoUrl}}`, `{{workDir}}`, `{{group}}`, `{{groupId}}`
- The generic runner automatically appends an instruction for Claude to write `.critter-report.md` and adds `Write` to the allowed tools
- On completion, the report is uploaded as a `.md` attachment and posted as an inline comment on the issue
- If Claude doesn't write the file (can happen with weaker models), the runner falls back to extracting text from the stream-json output

### Model guidance

- **opus**: Best for complex tasks — planning, execution, code review. Use for anything that modifies code or needs multi-step reasoning
- **sonnet**: Good for read-only analysis tasks — audits, triage, doc checks. Reliably follows the report-writing instruction. Good cost/quality tradeoff
- **haiku**: Not recommended for critter types. It often ignores tool-use instructions (e.g., won't write `.critter-report.md`) and produces shallow analysis. Stick with sonnet as the minimum for custom types

### Critter type config reference

| Field | Required | Default | Description |
|---|---|---|---|
| `provider` | no | top-level `provider` | `"linear"`, `"jira"`, or an array like `[linear, jira]` to poll both providers with the same config |
| `trigger.label` | yes | — | Label that triggers this type |
| `trigger.status` | yes | — | Status name to match (e.g., "Todo", "In Review") |
| `trigger.statusType` | no | — | Linear status type to match (e.g., "unstarted"). More reliable than matching by name. Linear-only |
| `trigger.assignee` | no | — | Only pick up issues assigned to this user. Email address, or `"me"` for the authenticated user |
| `repo.clone` | no | true | Whether to shallow clone the repo |
| `repo.branch` | no | — | Whether to create a feature branch (needed for PR-creating types) |
| `repo.depth` | no | 1 | Git clone depth (increase for repos that need history) |
| `repo.localPath` | no | — | Clone from a local path instead of remote (sets remote to `repoUrl` after clone) |
| `repo.commitPlans` | no | true | Whether to commit plan/checkpoint files to the target repo |
| `phases` | yes | — | Array of phases to run sequentially (at least one) |
| `phases[].name` | yes | — | Phase name (used in logs, tmux pane titles, output filenames) |
| `phases[].prompt` | yes | — | `builtin:planning`, `builtin:execution`, `builtin:review`, or a file path (`~` expanded) |
| `phases[].model` | yes | — | Claude model: `opus`, `sonnet`, or `haiku` |
| `phases[].maxTurns` | yes | — | Max Claude API round-trips for this phase |
| `phases[].tools` | no | `default` | `readonly`, `default`, `review`, or explicit array of tool names |
| `phases[].skills` | no | — | Array of skill file paths appended to the phase prompt (supports `{{var}}` substitution) |
| `phases[].comment` | no | false | Post the phase's report text as an issue comment |
| `outcomes.success` | no | — | Status to set on success. `comment: true` is now implicit for custom types |
| `outcomes.failure` | no | — | Status to set on failure |
| `outcomes.merged` | no | — | Status to set when a PR is merged (review type) |
| `outcomes.needsChanges` | no | — | Status to set when changes are requested (review type) |
| `outcomes.prCreated` | no | falls back to `success` | Status to set when a PR is created (overrides `success` for PR-creating types) |
| `outcomes.*.status` | no | — | Status to transition to. Optional — outcomes can act (remove labels, post comments) without changing status |
| `outcomes.*.removeLabel` | no | false | Strip the trigger label from the issue on this outcome (prevents re-pickup) |
| `concurrency` | no | 2 | Max parallel instances of this type |
| `timeoutMinutes` | no | 30 | Total timeout for all phases |
| `enrichment` | no | — | `extractPrUrl` to extract PR URL from issue comments (for review types) |
| `mcpConfig` | no | global `mcpConfig` | Path(s) to MCP config JSON file(s) — fully replaces global |
| `strictMcpConfig` | no | global `strictMcpConfig` | Per-type override for strict MCP config mode |

### Phases

Each type defines one or more phases. Built-in prompts (`builtin:planning`, `builtin:execution`, `builtin:review`) use dedicated runners with battle-tested logic. Custom prompts use the generic runner.

Tool presets: `readonly` (planning tools), `default` (execution tools from config), `review` (review tools), or an explicit array of tool names.

### Skills

Skills are reusable prompt fragments (markdown files) that can be injected into any phase via the `skills` field. Each skill file is read, has `{{var}}` substitution applied (same variables as prompts), and is appended to the phase prompt with a separator:

```
---

## Skill: <filename-without-extension>

<skill content>
```

Skills are appended in array order after the main prompt content. For built-in phases, skills are appended after the built-in prompt. For custom phases, skills are appended before the report instruction.

Recommended file locations: `~/.critters/skills/` for global skills, `.critters/skills/` for per-repo skills. Use `~`-prefixed or absolute paths for skills outside the cloned repo, since relative paths resolve against the daemon's CWD.

Example:
```yaml
phases:
  - name: audit
    prompt: ~/.critters/prompts/code-audit.md
    model: sonnet
    maxTurns: 20
    skills:
      - ~/.critters/skills/output-format.md
      - ~/.critters/skills/security-checklist.md
```

### Testing custom types

Use `--dry-run` to verify the daemon picks up the right issues for each type without actually running them:

```
bun run src/index.ts --config test-configs/custom-types.yaml --dry-run
bun run src/index.ts --config test-configs/custom-types.yaml --dry-run --type code-audit
```

A sample config with multiple custom types lives at `test-configs/custom-types.yaml`. A multi-provider example is at `test-configs/multi-provider.yaml`. Prompt templates for testing are at `~/.critters/prompts/`.

## Use Cases

Critters is a general-purpose agent orchestrator. The built-in `create` and `review` types are just defaults — any workflow matching "watch for trigger → run Claude with a prompt → produce an outcome" can be built with custom critter types, no code changes needed.

### Issue triage bot

Automatically reads new issues, adds labels, sets priority, and posts a triage summary comment. Uses read-only tools and sonnet for fast, cheap analysis.

```yaml
critterTypes:
  triage:
    trigger: { label: "Needs Triage", status: "Triage", statusType: "triage" }
    repo: { clone: true }
    phases:
      - name: triage
        prompt: ~/.critters/prompts/triage.md
        model: sonnet
        maxTurns: 10
        tools: [Read, Glob, Grep, "Bash(git:*)", "Bash(ls:*)"]
    outcomes:
      success: { status: "Todo", comment: true }
      failure: { status: "Critter Failed", comment: true }
    concurrency: 5
    timeoutMinutes: 5
```

Sonnet is the right choice here — triage is pattern matching and classification, not multi-step reasoning.

### Documentation writer

Watches for issues labeled "Docs Needed", reads the relevant code, and generates or updates markdown documentation. Creates a PR with the changes.

```yaml
critterTypes:
  docs:
    trigger: { label: "Docs Needed", status: "Todo", statusType: "unstarted" }
    repo: { clone: true, branch: true }
    phases:
      - name: docs
        prompt: ~/.critters/prompts/docs-writer.md
        model: opus
        maxTurns: 40
        tools: default
    outcomes:
      success: { status: "In Review" }
      failure: { status: "Critter Failed", comment: true }
    concurrency: 2
    timeoutMinutes: 20
```

Opus is recommended — writing good documentation requires understanding code structure and producing clear, well-organized prose.

### Security auditor

Scans a repo for OWASP top 10 vulnerabilities, dependency issues, and hardcoded secrets. Produces a `.critter-report.md` with findings and severity ratings.

```yaml
critterTypes:
  security-audit:
    trigger: { label: "Security Audit", status: "Todo", statusType: "unstarted" }
    repo: { clone: true }
    phases:
      - name: audit
        prompt: ~/.critters/prompts/security-audit.md
        model: sonnet
        maxTurns: 25
        tools: [Read, Glob, Grep, "Bash(git:*)", "Bash(ls:*)", "Bash(cat:*)"]
    outcomes:
      success: { status: "Done", comment: true }
      failure: { status: "Critter Failed", comment: true }
    concurrency: 3
    timeoutMinutes: 15
```

Sonnet provides a good cost/quality tradeoff for analysis tasks. The report is automatically uploaded as an attachment and posted as a comment.

### Test generator

Picks up issues labeled "Needs Tests", reads the implementation, and writes missing test cases. Creates a PR with the new tests.

```yaml
critterTypes:
  test-gen:
    trigger: { label: "Needs Tests", status: "Todo", statusType: "unstarted" }
    repo: { clone: true, branch: true }
    phases:
      - name: generate-tests
        prompt: ~/.critters/prompts/test-generator.md
        model: opus
        maxTurns: 50
        tools: default
    outcomes:
      success: { status: "In Review" }
      failure: { status: "Critter Failed", comment: true }
    concurrency: 2
    timeoutMinutes: 25
```

Opus is recommended for code generation — writing correct, meaningful tests requires understanding the code under test and producing valid assertions.

### Multi-step workflow (chaining critter types)

You can chain critter types using Linear/Jira blocking relationships. For example, a "plan" critter creates an implementation plan and spawns sub-tickets, then "implement" critters pick up each sub-ticket independently.

```yaml
critterTypes:
  plan:
    trigger: { label: "Critter Plan", status: "Todo", statusType: "unstarted" }
    repo: { clone: true }
    phases:
      - name: plan
        prompt: ~/.critters/prompts/plan-and-split.md
        model: opus
        maxTurns: 30
        tools: [Read, Glob, Grep, "Bash(git:*)", "Bash(ls:*)"]
    outcomes:
      success: { status: "Done", comment: true }
      failure: { status: "Critter Failed", comment: true }
    concurrency: 2
    timeoutMinutes: 15

  implement:
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
    concurrency: 3
    timeoutMinutes: 30
```

The "plan" critter's prompt instructs Claude to create sub-issues (via the Linear/Jira API tools or `gh`) with `blocks`/`blockedBy` relationships. The daemon won't pick up blocked issues until their blockers are resolved, so ordering is enforced automatically.

See [Critter type config reference](#critter-type-config-reference) for the full list of configuration fields.

## Multi-Provider Support

A single daemon can poll both Linear and Jira simultaneously. Each critter type specifies which provider(s) to use via the `provider` field.

### Provider setup

Set `provider` at the top level for the default, then override per critter type:

```yaml
provider: linear  # default for types that don't specify

jiraStatusMap:
  "Todo": "To Do"
  "In Progress": "In Progress"
  "In Review": "In Review"
  "Done": "Done"
  "Critter Failed": "Failed"
  "Human Review": "Needs Review"
```

### Per-type provider

Each critter type can set `provider` to a single value or an array:

```yaml
critterTypes:
  create:
    provider: jira              # only polls Jira
    trigger: { label: "Critter", status: "To Do" }
    # ...

  review:
    provider: [linear, jira]    # polls both providers
    trigger: { label: "Critter Review", status: "In Review" }
    # ...
```

When `provider` is an array, the type is expanded internally — `create` with `provider: [linear, jira]` becomes `create:linear` and `create:jira`, each polling its own tracker with the same phases, tools, and outcomes. This avoids duplicating config.

### Jira status mapping

Jira workflows use different status names than Linear. The `jiraStatusMap` translates critter's internal status names (used in `outcomes`) to your Jira workflow's status names. The map is used when transitioning issues. If a status isn't in the map, the name is used as-is.

### Jira differences from Linear

- **Statuses**: Jira statuses are workflow-managed. The daemon can't create new statuses (unlike Linear where it auto-creates "Critter Failed" etc). Your Jira workflow must already have the target statuses.
- **Labels**: Jira labels auto-create when applied — no setup needed.
- **Descriptions**: Jira uses ADF (Atlassian Document Format). The tracker converts ADF to plain text automatically, so `repo: <url>` lines in descriptions work the same way.
- **Status transitions**: Jira requires using the transitions API rather than setting status directly. The tracker finds the matching transition automatically.
- **Blockers**: Detected via Jira issue links of type "is blocked by".

### Example: Linear-only (default, backward compatible)

```yaml
defaultAllowedTools:
  - "Read"
  - "Write"
  - "Edit"
  - "Glob"
  - "Grep"
  - "Bash(git:*)"
  - "Bash(gh:*)"
  - "Bash(bun:*)"
```

No `provider` or `critterTypes` needed — defaults to Linear with built-in create + review types.

### Example: Jira-only

```yaml
provider: jira

jiraStatusMap:
  "Todo": "To Do"
  "In Progress": "In Progress"
  "In Review": "In Review"
  "Done": "Done"
  "Critter Failed": "Failed"

defaultAllowedTools:
  - "Read"
  - "Write"
  - "Edit"
  - "Glob"
  - "Grep"
  - "Bash(git:*)"
  - "Bash(gh:*)"
  - "Bash(bun:*)"

critterTypes:
  create:
    trigger: { label: "Critter", status: "To Do" }
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

### Example: Both providers, same config

```yaml
provider: linear

jiraStatusMap:
  "Todo": "To Do"
  "In Progress": "In Progress"
  "In Review": "In Review"
  "Done": "Done"
  "Critter Failed": "Failed"
  "Human Review": "Needs Review"

defaultAllowedTools:
  - "Read"
  - "Write"
  - "Edit"
  - "Glob"
  - "Grep"
  - "Bash(git:*)"
  - "Bash(gh:*)"
  - "Bash(bun:*)"

critterTypes:
  create:
    provider: [linear, jira]
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

  review:
    provider: [linear, jira]
    trigger: { label: "Critter Review", status: "In Review" }
    repo: { clone: true }
    phases:
      - name: review
        prompt: builtin:review
        model: opus
        maxTurns: 30
        tools: review
    outcomes:
      merged: { status: "Done" }
      needsChanges: { status: "Human Review" }
      failure: { status: "Critter Failed" }
    concurrency: 2
    timeoutMinutes: 15
    enrichment: extractPrUrl
```

## Config (`critters.config.yaml`)

| Field | Default | Description |
|---|---|---|
| `provider` | "linear" | Default issue tracker provider: `"linear"` or `"jira"` |
| `pollIntervalSeconds` | 120 | How often to poll for issues |
| `concurrency` | 2 | Max parallel critters |
| `timeoutMinutes` | 30 | Total timeout per task (both phases) |
| `workDir` | /tmp/critters-work | Temp clone directory |
| `triggerLabel` | "Critter" | Label that triggers pickup |
| `maxPlanningTurns` | 50 | Max Claude turns for planning phase |
| `maxExecutionTurns` | 75 | Max Claude turns for execution phase |
| `defaultAllowedTools` | see file | Tools critters can use |
| `repos` | {} | Project ID → repo URL + extra tools |
| `tmuxSession` | "critters" | Name of the tmux session to use |
| `branchPrefix` | "critter" | Prefix for feature branch names (`<prefix>/<ID>-<slug>`) |
| `teamRepos` | {} | Team ID → fallback repo URL |
| `defaultRepo` | — | Final fallback repo URL when not in description, project config, or team config |
| `planningModel` | "opus" | Claude model for planning phase |
| `executionModel` | "opus" | Claude model for execution phase |
| `reviewTriggerLabel` | "Critter Review" | Label that triggers review pickup |
| `reviewModel` | "opus" | Claude model for reviews |
| `reviewConcurrency` | 2 | Max parallel review critters |
| `reviewTimeoutMinutes` | 15 | Timeout per review (increase for slow CI) |
| `maxReviewTurns` | 30 | Max Claude turns per review |
| `healthPort` | 3847 | HTTP server port for dashboard and health checks (0 to disable) |
| `dashboardToken` | — | Shared secret for dashboard POST endpoints (also reads `DASHBOARD_TOKEN` env var) |
| `maxLogSizeMb` | 10 | Max log file size in MB before rotation (with `--no-tmux`) |
| `jiraStatusMap` | {} | Map critter status names to Jira status names (e.g., `"Todo": "To Do"`) |
| `hooks` | {} | Shell commands run on lifecycle events |
| `costAlertThreshold` | — | Cost (USD) per task that triggers a Slack alert |
| `mcpConfig` | — | Path(s) to MCP config JSON file(s), applied to all critters |
| `strictMcpConfig` | false | When true, passes `--strict-mcp-config` to prevent inheriting operator's MCP servers |
| `metricsRetentionDays` | 90 | Days to retain metrics data before pruning |
| `tunnel` | — | Tunnel configuration for remote dashboard access |
| `tunnel.enabled` | false | Enable ngrok tunnel |
| `tunnel.auth` | — | Basic auth credentials (`user:password`) |
| `tunnel.domain` | — | Static ngrok domain (free tier gives one) |

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
| `src/unified-watcher.ts` | Single poll loop for all critter types, per-type dedup |
| `src/unified-spawner.ts` | Per-type queues, common lifecycle, phase pipeline execution |
| `src/critter-type.ts` | CritterTypeConfig definitions, synthesizeDefaultTypes(), parsing |
| `src/tracker/types.ts` | IssueTracker interface, TrackerTask, ProviderConfig |
| `src/tracker/linear.ts` | LinearTracker class (wraps Linear SDK) |
| `src/tracker/jira.ts` | JiraTracker class (Jira Cloud REST API v3) |
| `src/tracker/index.ts` | createTracker() factory |
| `src/runner/types.ts` | PhaseRunner interface, PhaseContext, PhaseResult |
| `src/runner/planning.ts` | PlanningPhaseRunner (plan + reviewer subagent loop) |
| `src/runner/execution.ts` | ExecutionPhaseRunner (implement, commit, push, PR) |
| `src/runner/review.ts` | ReviewPhaseRunner (review diff, approve/merge) |
| `src/runner/generic.ts` | GenericPhaseRunner (custom types, writes .critter-report.md) |
| `src/runner/index.ts` | Runner registry (builtin → dedicated runner, else → generic) |
| `src/prompt-template.ts` | resolvePrompt(), resolveTools(), variable substitution |
| `src/claude.ts` | tmux pane spawning, stream-json piping |
| `src/prompt.ts` | Build planning/execution prompts, parse repo URL |
| `src/linear.ts` | Linear SDK wrapper (legacy, mostly unused — tracker abstraction preferred) |
| `src/review-prompt.ts` | Build review prompt, review allowed tools |
| `src/git.ts` | Clone, branch, commit, cleanup |
| `src/config.ts` | Load YAML + env, parse critterTypes |
| `src/logger.ts` | Timestamped console logging |
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
| `src/cli-restart.ts` | `critters restart` CLI command |
| `src/cli-clean.ts` | `critters clean` CLI command |
| `src/cli-tail.ts` | `critters tail` CLI command |
| `src/init-repo.ts` | `critters init-repo` CLI command |
| `src/log-resolver.ts` | Log file reading, formatting, and `formatToolUse()` helper |
| `src/repo-config.ts` | Per-repo `.critters.yaml` loader |
| `src/types.ts` | Shared TypeScript type definitions |
| `src/utils.ts` | Shared utility functions |
| `src/tunnel.ts` | ngrok tunnel management for remote dashboard access |
| `src/version.ts` | Version constant |
| `src/validate.ts` | `critters validate` CLI command |
| `src/cli-release-notes.ts` | `critters release-notes` CLI command |
| `src/release-notes.ts` | Release notes data (bundled at build time by `scripts/bundle-release-notes.js`) |
| `src/env.ts` | Shared `.env` fallback loader |
| `src/updater.ts` | Self-update check logic |
| `src/prerequisites.ts` | Startup prerequisite checks |
| `src/init.ts` | `critters init` CLI command |
| `src/jq-filter.ts` | jq filter string for stream-json display |
| `critters/plans/<ID>.md` | Planning phase output — critters write their implementation plans here, committed to the repo |

## Environment variables

- `LINEAR_API_KEY` — required when using `provider: linear` (default)
- `JIRA_HOST` — Jira Cloud hostname (e.g., `mycompany.atlassian.net`), required when using `provider: jira`
- `JIRA_EMAIL` — Jira user email, required when using `provider: jira`
- `JIRA_API_TOKEN` — Jira API token (from https://id.atlassian.com), required when using `provider: jira`
- `SLACK_WEBHOOK_URL` (optional) — for completion notifications
- `SLACK_BOT_TOKEN` (optional) — Slack bot token (`xoxb-...`) for threaded notifications
- `SLACK_CHANNEL` (optional, required with `SLACK_BOT_TOKEN`) — Slack channel ID for bot notifications
- `DASHBOARD_TOKEN` (optional) — bearer token for dashboard POST endpoints

Only the credentials for providers actually referenced by your `critterTypes` are required. A Linear-only config doesn't need Jira vars and vice versa.

## Build & Binary

- Build: `bun build --compile src/index.ts --outfile dist/critters`
- Also available via: `bun run build`
- Release CI builds for `darwin-arm64` and `linux-x64`
- Bun compiled binaries use virtual paths in `process.argv` (e.g. `/$bunfs/`); use `process.execPath` for the real binary path
- The daemon always logs to `~/.critters/critters.log` (rotated at `maxLogSizeMb`), regardless of whether tmux is used
- `--no-tmux` flag runs the daemon without tmux, using only file logging (no console output)
- Auto-update only works when running as a compiled binary (detected by checking `process.execPath` basename isn't `bun`)

## CLI Commands

Usage: `critters [command] [flags]`

| Command | Description |
|---|---|
| *(none)* | Start the daemon |
| `status` | Show daemon status (active/queued critters, uptime, today's stats) |
| `logs <ID>` | View critter logs (`--phase planning\|execution\|review`, `--follow\|-f`) |
| `retry <ID>` | Reset a failed critter to Todo for re-pickup (`--force` to override non-failed states) |
| `restart` | Restart the daemon |
| `kickoff` | Trigger an immediate poll cycle via the health server |
| `tail` | Live-stream output from all active critters |
| `list-types` | Show configured critter types |
| `init` | Interactive setup — creates `~/.critters/` with config, env, and prompt template files |
| `init-repo` | Scaffold `.critters.yaml` in the current repo |
| `prompt-help` | Launch Claude to help configure critter types and prompts |
| `clean` | Clean up stale work directories (`--all`, `--dry-run`) |
| `release-notes` | Show release notes for recent versions |
| `validate` | Validate config file without starting daemon |
| `update` | Check for and apply binary updates (requires manual daemon restart) |
| `version` | Print version |
| `help` | Show help |

### Daemon Flags

| Flag | Description |
|---|---|
| `--dry-run` | Poll once, show what would happen, exit |
| `--no-tmux` | Run without tmux (log to file) |
| `--skip-update` | Skip auto-update check on startup |
| `--config PATH` | Use a custom config file |
| `--type NAME` | Filter dry-run to a specific critter type |
| `--json-logs` | Output structured JSON logs (one object per line) |

### JSON Log Format

When `--json-logs` is enabled, each log line is a JSON object:

```json
{"timestamp":"2026-03-05T12:00:00.000Z","level":"info","message":"..."}
```

Fields: `timestamp` (ISO 8601), `level` (`"info"`, `"warn"`, or `"error"`), `message` (log text), and optionally `identifier` (e.g., `"ACK-123"` for task-scoped logs). Info/warn logs go to stdout; error logs go to stderr. Works with both stdout and file logging (`--no-tmux`).

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
| `onPlanningCompleted` | Planning phase finishes (create type) |
| `onExecutionStarted` | Execution phase begins (create type) |

Each hook receives environment variables: `CRITTER_ISSUE_ID`, `CRITTER_IDENTIFIER`, `CRITTER_TITLE`, `CRITTER_REPO_URL`, `CRITTER_BRANCH`. PR-related hooks (`onPrCreated`, `onReviewStarted`, `onMerged`, `onNeedsChanges`) also get `CRITTER_PR_URL`. Hooks time out after 30 seconds. Failures are logged as warnings but don't fail the task.

## Slack Notifications

Set `SLACK_WEBHOOK_URL` in `.env` to receive Slack messages. For **threaded notifications** (all updates for an issue grouped under one message), set `SLACK_BOT_TOKEN` and `SLACK_CHANNEL` instead. When a bot token is configured, the daemon uses the Slack Web API (`chat.postMessage`) and threads subsequent notifications under the initial message for each issue. If only `SLACK_WEBHOOK_URL` is set, notifications are sent as separate top-level messages (no threading).

Notifications are sent for:

- Task picked up (cloning started)
- Planning complete
- PR created (success)
- Task failed
- Timeout warning (at 80% of `timeoutMinutes`)
- Review started
- Review merged
- Review needs changes
- Review failed

Messages are retried up to 2 times with exponential backoff. Notification failures are logged but don't fail the task.

## Dashboard & Health Server

An HTTP server starts on `healthPort` (default 3847, set to 0 to disable).

| Endpoint | Method | Description |
|---|---|---|
| `/` or `/dashboard` | GET | HTML dashboard with summary stats, charts (14-day tasks/cost), and recent activity table. Auto-refreshes every 30s. |
| `/healthz` | GET | JSON health check: uptime, version, active/queued counts (per-type and flat), active critter details, last poll time, metrics summary |
| `/metrics` | GET | JSON array of recent metric events (last 100) |
| `/poll` | POST | Trigger an immediate critter poll cycle |
| `/review-poll` | POST | Trigger an immediate review poll cycle |
| `/restart` | POST | Restart the daemon process (re-exec). Requires auth if configured |
| `/api/v1/auth-check` | GET | JSON `{ required: boolean }` — whether auth is configured |
| `/api/v1/metadata` | GET | JSON metadata: providers with teams, critter types |
| `/api/v1/issues` | POST | Create a critter issue. Body: `{ provider, teamId, title, description, critterType }` |

The dashboard includes a "New Critter" button in the header that opens a modal form for creating critter tickets. The form populates provider, team, and critter type dropdowns from `/api/v1/metadata` and submits to `/api/v1/issues`. When `dashboardToken` is configured, the dashboard handles auth via `localStorage` — prompting users for a token if needed and including it in all POST requests.

Metrics are stored in `~/.critters/metrics.jsonl` (JSONL format). Events: `task_started`, `task_completed`, `task_failed`, `review_started`, `review_completed`, `review_failed`, `poll_completed`.

## Remote Access (ngrok)

Enable `tunnel.enabled` in config to automatically start an ngrok tunnel to the dashboard. Requires `ngrok` CLI installed. The public URL is logged on startup. Use `tunnel.auth` for basic auth protection and `tunnel.domain` for a static URL.
