# Configuration Reference

Complete reference for all critters configuration options.

## Config file location

The daemon searches for config files in this order:

1. `--config PATH` flag (explicit override)
2. `./critters.config.yaml` (current working directory)
3. `~/.critters/config.yaml` (user home)

Run `critters init` to create the default config at `~/.critters/config.yaml`.

### Hot-reload

The daemon watches the config file and applies changes without restart. The following fields are **immutable at runtime** and require a daemon restart to take effect:

- `workDir`
- `healthPort`
- `tmuxSession`
- `tunnel.enabled`

When the config file changes, a diff summary is logged showing what was updated.

## Top-level fields

| Field | Type | Default | Description |
|---|---|---|---|
| `provider` | `"linear"` \| `"jira"` | `"linear"` | Default issue tracker provider |
| `pollIntervalSeconds` | number | 120 | How often to poll for issues (minimum 5) |
| `concurrency` | number | 2 | Max parallel critters (minimum 1) |
| `timeoutMinutes` | number | 30 | Total timeout per task in minutes |
| `workDir` | string | `/tmp/critters-work` | Directory for temporary repo clones |
| `triggerLabel` | string | `"Critter"` | Label that triggers issue pickup (used when `critterTypes` is omitted) |
| `maxPlanningTurns` | number | 50 | Max Claude API round-trips for planning phase |
| `maxExecutionTurns` | number | 75 | Max Claude API round-trips for execution phase |
| `defaultAllowedTools` | string[] | *(see config file)* | Tools critters can use (must be non-empty) |
| `repos` | object | `{}` | Project ID to repo URL + extra tools mapping |
| `teamRepos` | object | `{}` | Team ID to fallback repo URL mapping |
| `tmuxSession` | string | `"critters"` | Name of the tmux session to use |
| `branchPrefix` | string | `"critter"` | Prefix for feature branch names (`<prefix>/<ID>-<slug>`). Must match `[a-zA-Z0-9._-]+` |
| `planningModel` | string | `"opus"` | Claude model for planning phase |
| `executionModel` | string | `"opus"` | Claude model for execution phase |
| `reviewTriggerLabel` | string | `"Critter Review"` | Label that triggers review pickup |
| `reviewModel` | string | `"opus"` | Claude model for reviews |
| `reviewConcurrency` | number | 2 | Max parallel review critters |
| `reviewTimeoutMinutes` | number | 15 | Timeout per review in minutes |
| `maxReviewTurns` | number | 30 | Max Claude turns per review |
| `healthPort` | number | 3847 | HTTP server port for dashboard and health checks. Set to 0 to disable. Must be 0 or 1024-65535 |
| `dashboardToken` | string | *(none)* | Shared secret for dashboard POST endpoints. Also reads `DASHBOARD_TOKEN` env var. When set, all POST endpoints require `Authorization: Bearer <token>` |
| `maxLogSizeMb` | number | 10 | Max log file size in MB before rotation (with `--no-tmux`) |
| `jiraStatusMap` | object | `{}` | Map critter status names to Jira workflow status names |
| `hooks` | object | `{}` | Shell commands run on lifecycle events |
| `costAlertThreshold` | number | *(none)* | Cost (USD) per task that triggers a Slack alert. Must be > 0 |
| `costBudget` | number | *(none)* | Cost (USD) per task that triggers a kill. Per-type override available via `critterTypes.<name>.costBudget`. Must be > 0 |
| `linearWebhookSecret` | string | *(none)* | Linear webhook signing secret (env: `LINEAR_WEBHOOK_SECRET`). Enables `/webhook/linear` endpoint for near-instant issue pickup |
| `jiraWebhookSecret` | string | *(none)* | Jira webhook secret (env: `JIRA_WEBHOOK_SECRET`). Enables `/webhook/jira` endpoint for near-instant issue pickup |
| `metricsRetentionDays` | number | 90 | Days to retain metrics data before pruning (minimum 1) |
| `mcpConfig` | string \| string[] | *(none)* | Path(s) to MCP config JSON file(s), applied to all critters |
| `strictMcpConfig` | boolean | `false` | When true, passes `--strict-mcp-config` to prevent inheriting operator's MCP servers |
| `autoRetry` | object | *(none)* | Automatic retry configuration for failed tasks |
| `tunnel` | object | *(none)* | ngrok tunnel configuration for remote dashboard access |

### `autoRetry`

| Field | Type | Default | Description |
|---|---|---|---|
| `maxRetries` | number | 1 | Maximum number of retry attempts (minimum 1) |
| `baseDelaySeconds` | number | 60 | Base delay between retries in seconds |
| `maxDelaySeconds` | number | 300 | Maximum delay between retries (must be >= `baseDelaySeconds`). Delay increases with exponential backoff |

### `tunnel`

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `false` | Enable ngrok tunnel to the dashboard |
| `auth` | string | *(none)* | Basic auth credentials in `"user:password"` format |
| `domain` | string | *(none)* | Static ngrok domain (free tier gives one) |

### Per-repo tool overrides

Per-repo overrides merge with the defaults:

```yaml
repos:
  "project-uuid":
    url: "git@github.com:org/repo.git"
    extraAllowedTools:
      - "Bash(python:*)"
      - "Bash(pip:*)"
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `LINEAR_API_KEY` | When using `provider: linear` | Linear API key |
| `JIRA_HOST` | When using `provider: jira` | Jira Cloud hostname (e.g., `mycompany.atlassian.net`) |
| `JIRA_EMAIL` | When using `provider: jira` | Jira user email |
| `JIRA_API_TOKEN` | When using `provider: jira` | Jira API token (from https://id.atlassian.com) |
| `SLACK_WEBHOOK_URL` | No | Slack webhook URL for basic notifications |
| `SLACK_BOT_TOKEN` | No | Slack bot token (`xoxb-...`) for threaded notifications |
| `SLACK_CHANNEL` | With `SLACK_BOT_TOKEN` | Slack channel ID (required when bot token is set) |

Environment variables can be set in:
- `.env` in the current working directory (loaded automatically by Bun)
- `~/.critters/.env` (fallback — only loaded if no `.env` exists in CWD)

Only the credentials for providers actually referenced by your `critterTypes` are required.

## Critter types (`critterTypes`)

The `critterTypes` config section defines custom agent types. Each type has its own trigger, phase pipeline, tools, concurrency, and outcomes.

If `critterTypes` is omitted, the daemon synthesizes the default `create` and `review` types from the flat config fields (full backward compatibility).

### Example

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

### Type fields

| Field | Required | Default | Description |
|---|---|---|---|
| `provider` | No | Top-level `provider` | `"linear"`, `"jira"`, or an array like `[linear, jira]` to poll both providers |
| `trigger.label` | Yes | — | Label that triggers this type |
| `trigger.status` | Yes | — | Status name to match (e.g., `"Todo"`, `"In Review"`) |
| `trigger.statusType` | No | — | Linear status type to match (e.g., `"unstarted"`). More reliable than name matching. Linear-only |
| `trigger.assignee` | No | — | Only pick up issues assigned to this user. Email address, or `"me"` for the authenticated user |
| `repo.clone` | No | `true` | Whether to shallow-clone the repo |
| `repo.branch` | No | — | Whether to create a feature branch (needed for PR-creating types) |
| `phases` | Yes | — | Array of phases to run sequentially (at least one) |
| `outcomes` | Yes | — | Map of outcome names to status/comment config |
| `concurrency` | No | 2 | Max parallel instances of this type |
| `timeoutMinutes` | No | 30 | Total timeout for all phases |
| `enrichment` | No | — | `"extractPrUrl"` to extract PR URL from issue comments (for review types) |
| `mcpConfig` | No | Global `mcpConfig` | Path(s) to MCP config JSON file(s) — fully replaces global |
| `strictMcpConfig` | No | Global `strictMcpConfig` | Per-type override for strict MCP config mode |
| `quietComments` | No | `false` | Suppress status/progress comments (pickup, phase stats, retry). Report and error comments still post |

### Phase config

Each phase in the `phases` array has:

| Field | Required | Default | Description |
|---|---|---|---|
| `name` | Yes | — | Phase name (used in logs, tmux pane titles, output filenames) |
| `prompt` | Yes | — | `builtin:planning`, `builtin:execution`, `builtin:review`, or a file path (`~` expanded) |
| `model` | Yes | — | Claude model: `opus`, `sonnet`, or `haiku` |
| `maxTurns` | Yes | — | Max Claude API round-trips for this phase |
| `tools` | No | `"default"` | Tool preset or explicit tool array |
| `skills` | No | — | Array of skill file paths appended to the phase prompt |

#### Built-in prompts

| Prompt | Runner | Description |
|---|---|---|
| `builtin:planning` | PlanningPhaseRunner | Explores codebase, writes implementation plan, runs reviewer subagent loop |
| `builtin:execution` | ExecutionPhaseRunner | Implements plan, commits, pushes, creates PR |
| `builtin:review` | ReviewPhaseRunner | Reviews PR diff, approves and merges or requests changes |

Custom prompt paths use the GenericPhaseRunner, which automatically instructs Claude to write a `.critter-report.md` file. The report is uploaded as an attachment and posted as a comment on the issue.

#### Tool presets

| Preset | Description |
|---|---|
| `readonly` | Read-only tools for planning (Read, Glob, Grep, Write, Task + basic Bash) |
| `default` | Full execution tools from `defaultAllowedTools` in config |
| `review` | Review-specific tools |
| *(array)* | Explicit array of tool names (e.g., `[Read, Glob, Grep, "Bash(git:*)"]`) |

#### Template variables

Prompt files support `{{var}}` substitution with these variables:

| Variable | Description |
|---|---|
| `{{identifier}}` | Issue identifier (e.g., `ACK-123`) |
| `{{title}}` | Issue title |
| `{{description}}` | Issue description |
| `{{branch}}` | Git branch name |
| `{{repoUrl}}` | Repository URL |
| `{{workDir}}` | Working directory path |
| `{{group}}` | Project/group name |
| `{{groupId}}` | Project/group ID |

### Skills

Skills are reusable prompt fragments (markdown files) injected into any phase via the `skills` field. Each skill file is read, has `{{var}}` substitution applied, and is appended to the phase prompt:

```
---

## Skill: <filename-without-extension>

<skill content>
```

Skills are appended in array order after the main prompt content. For built-in phases, skills are appended after the built-in prompt. For custom phases, skills are appended before the report instruction.

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

Recommended file locations:
- `~/.critters/skills/` — global skills
- `.critters/skills/` — per-repo skills

Use `~`-prefixed or absolute paths for skills outside the cloned repo, since relative paths resolve against the daemon's CWD.

### Outcomes

Each outcome maps a result name to a status transition and optional comment:

```yaml
outcomes:
  success: { status: "In Review" }
  failure: { status: "Critter Failed", comment: true }
  merged: { status: "Done" }
  needsChanges: { status: "Human Review" }
```

| Outcome | Used by | Description |
|---|---|---|
| `success` | Create and custom types | Task completed successfully |
| `failure` | All types | Task failed |
| `merged` | Review types | PR was approved and merged |
| `needsChanges` | Review types | PR needs changes, moved to human review |

Custom types have `comment: true` implicitly — the report is always posted as a comment.

## Per-repo configuration (`.critters.yaml`)

Repos can include a `.critters.yaml` at the root to customize critter behavior. The file is loaded after cloning.

| Field | Type | Description |
|---|---|---|
| `extraAllowedTools` | `string[]` | Additional tools merged with daemon defaults |
| `planningPrompt` | `string` | Custom prompt appended to the planning phase |
| `executionPrompt` | `string` | Custom prompt appended to the execution phase |
| `reviewPrompt` | `string` | Custom prompt appended to the review phase |

All fields are optional. Run `critters init-repo` to scaffold the file.

## Daemon-level prompt customization

After running `critters init`, these files are created in `~/.critters/`:

- `planning-prompt.md` — appended to the planning phase prompt
- `execution-prompt.md` — appended to the execution phase prompt
- `review-prompt.md` — appended to the review phase prompt

Edit these to add global instructions that apply to all repos.

## Hooks

Shell commands that run on lifecycle events. Configure in your config file:

```yaml
hooks:
  onTaskStarted: "curl -s https://example.com/notify"
  onPrCreated: "echo $CRITTER_PR_URL"
  onTaskFailed: "./scripts/alert.sh"
```

### Available hooks

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

### Hook environment variables

All hooks receive:

| Variable | Description |
|---|---|
| `CRITTER_ISSUE_ID` | Internal issue ID |
| `CRITTER_IDENTIFIER` | Issue identifier (e.g., `ACK-123`) |
| `CRITTER_TITLE` | Issue title |
| `CRITTER_REPO_URL` | Repository URL |
| `CRITTER_BRANCH` | Git branch name |

PR-related hooks (`onPrCreated`, `onReviewStarted`, `onMerged`, `onNeedsChanges`) also receive:

| Variable | Description |
|---|---|
| `CRITTER_PR_URL` | Pull request URL |

Hooks time out after 30 seconds. Failures are logged as warnings but never fail the task.

## Multi-provider setup (Linear + Jira)

### Setting the provider

Set `provider` at the top level for the default, then override per critter type:

```yaml
provider: linear  # default for types that don't specify

critterTypes:
  create:
    provider: jira              # only polls Jira
    # ...

  review:
    provider: [linear, jira]    # polls both providers
    # ...
```

When `provider` is an array, the type is expanded internally — `create` with `provider: [linear, jira]` becomes `create:linear` and `create:jira`, each polling its own tracker with the same phases, tools, and outcomes.

### Jira status mapping

Jira workflows use different status names than critters' internal names. The `jiraStatusMap` translates:

```yaml
jiraStatusMap:
  "Todo": "To Do"
  "In Progress": "In Progress"
  "In Review": "In Review"
  "Done": "Done"
  "Critter Failed": "Failed"
  "Human Review": "Needs Review"
```

If a status isn't in the map, the name is used as-is.

### Jira differences from Linear

| Feature | Linear | Jira |
|---|---|---|
| **Statuses** | Auto-creates missing statuses | Must pre-exist in your Jira workflow |
| **Labels** | Must be created manually | Auto-create when applied |
| **Descriptions** | Markdown | ADF (auto-converted to plain text by the tracker) |
| **Status transitions** | Set status directly | Uses Jira transitions API (finds matching transition automatically) |
| **Blockers** | Native blocking relationships | Detected via "is blocked by" issue links |

## MCP Servers

MCP (Model Context Protocol) servers are external tool servers that Claude Code can connect to, giving critters access to additional capabilities like databases, APIs, or custom tooling. Critters passes `--mcp-config` flags to the `claude` CLI, which handles the actual server connections.

### Global config

To enable MCP servers for all critter types, set `mcpConfig` at the top level:

```yaml
mcpConfig: ~/.critters/mcp.json
strictMcpConfig: false  # default
```

### MCP config JSON format

The config file uses the standard Claude Code MCP format. Critters doesn't interpret the file — it passes the path directly to `claude --mcp-config`.

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@example/mcp-server"],
      "env": {
        "API_KEY": "..."
      }
    }
  }
}
```

Each entry under `mcpServers` defines a server by its launch command, arguments, and optional environment variables. See the [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp) for the full format specification.

### Multiple config files

You can pass multiple MCP config files. Each becomes a separate `--mcp-config` flag:

```yaml
mcpConfig:
  - ~/.critters/mcp-base.json
  - ~/.critters/mcp-extra.json
```

This is useful for separating concerns — e.g., a base file with common servers and an extra file for specialized tools.

### Per-type override

Each critter type can specify its own MCP config, which **fully replaces** the global config (configs are not merged):

```yaml
critterTypes:
  code-audit:
    mcpConfig: ~/.critters/mcp-audit.json
    strictMcpConfig: true
    # ...
```

If a type needs both global and extra servers, it must list all files explicitly:

```yaml
critterTypes:
  code-audit:
    mcpConfig:
      - ~/.critters/mcp-base.json
      - ~/.critters/mcp-audit.json
    # ...
```

### Strict mode

When `strictMcpConfig` is `true`, critters passes `--strict-mcp-config` to prevent Claude Code from inheriting MCP servers from the operator's own configuration. This ensures critters only use the servers you explicitly configure.

```yaml
strictMcpConfig: true
```

Can be set globally or per-type. Per-type takes precedence over global. Default is `false`.

### Path resolution

- `~` is expanded to the home directory
- Absolute paths are used as-is
- Relative paths resolve against the daemon's working directory

### Resolution behavior

MCP config is resolved once per task at spawn time (not per phase). The same config applies to all phases of a task. Per-type config takes precedence over global — if a critter type defines `mcpConfig`, the global value is ignored entirely.

## Model guidance

| Model | Best for | Notes |
|---|---|---|
| `opus` | Complex tasks: planning, execution, code review, documentation writing | Best quality for anything that modifies code or needs multi-step reasoning |
| `sonnet` | Read-only analysis: audits, triage, doc checks | Good cost/quality tradeoff. Reliably follows report-writing instructions |
| `haiku` | Not recommended for critter types | Often ignores tool-use instructions and produces shallow analysis |

## Example configs

### Minimal Linear-only

```yaml
pollIntervalSeconds: 120
concurrency: 2
timeoutMinutes: 30
workDir: /tmp/critters-work

defaultAllowedTools:
  - "Read"
  - "Write"
  - "Edit"
  - "Glob"
  - "Grep"
  - "Bash(git:*)"
  - "Bash(gh:*)"
  - "Bash(bun:*)"

repos: {}
teamRepos: {}
```

No `provider` or `critterTypes` needed — defaults to Linear with built-in create + review types.

### Jira-only

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

### Multi-provider (Linear + Jira)

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

### Custom critter types

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

critterTypes:
  create:
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
