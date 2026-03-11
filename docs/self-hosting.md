# Self-Hosting Guide

This guide covers everything you need to deploy and run critters on your own infrastructure.

## Prerequisites

Before installing critters, ensure these tools are available:

| Tool | Required | Purpose |
|---|---|---|
| [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`) | Yes | Runs the AI agent instances |
| [GitHub CLI](https://cli.github.com) (`gh`) | Yes | Creates PRs, manages repos (must be authenticated via `gh auth login`) |
| `git` | Yes | Clones repos and manages branches |
| `tmux` | Unless using `--no-tmux` | Manages panes for parallel critter output |
| `jq` | Yes | Formats stream-json output from Claude |
| `curl` | For install script | Downloads the binary |

The daemon checks for `claude` and `gh` on startup and will exit with a clear error if either is missing or not authenticated.

### Issue tracker credentials

You need credentials for at least one issue tracker:

**Linear:**
- `LINEAR_API_KEY` — your Linear API key

**Jira:**
- `JIRA_HOST` — your Jira Cloud hostname (e.g., `mycompany.atlassian.net`)
- `JIRA_EMAIL` — your Jira user email
- `JIRA_API_TOKEN` — a Jira API token (from https://id.atlassian.com)

Only the credentials for providers you actually use are required.

## Installation

### Binary install (recommended)

One-liner install from GitHub releases:

```bash
curl -fsSL https://raw.githubusercontent.com/ack-ventures/critters/main/install.sh | bash
```

The install script:
- Detects your platform (darwin/linux) and architecture (arm64/x64)
- Checks for required prerequisites (`curl`, `claude`, `gh`, `tmux`, `jq`)
- Downloads the latest release binary from GitHub
- Installs to `/usr/local/bin` (or `~/.local/bin` if no sudo access)
- On fresh install, prompts for `LINEAR_API_KEY` and creates `~/.critters/config.yaml` + `~/.critters/.env`

### Manual download

1. Go to the [GitHub releases page](https://github.com/ack-ventures/critters/releases)
2. Download the binary for your platform: `critters-darwin-arm64` or `critters-linux-x64`
3. Make it executable and move to your PATH:
   ```bash
   chmod +x critters-darwin-arm64
   mv critters-darwin-arm64 /usr/local/bin/critters
   ```

### Initial setup

After installing, run the interactive setup:

```bash
critters init
```

This creates the `~/.critters/` directory with:
- `config.yaml` — main configuration file
- `.env` — environment variables (API keys)
- Prompt template files (`planning-prompt.md`, `execution-prompt.md`, `review-prompt.md`) for customizing built-in phase prompts

### Config file resolution

The daemon searches for config files in this order:

1. `--config PATH` flag (explicit path)
2. `./critters.config.yaml` (current working directory)
3. `~/.critters/config.yaml` (user home)

Environment variables can be in `.env` in the current working directory, or `~/.critters/.env` as a fallback. The fallback is only loaded if no `.env` exists in the CWD.

## Running the daemon

### Option A: tmux (interactive)

```bash
tmux new -s critters
critters
```

If you run `critters` outside of tmux, it will automatically launch a tmux session named "critters" (configurable via `tmuxSession`) and re-exec itself inside it. Each active critter phase gets its own tmux pane showing live output.

### Option B: systemd (headless)

For headless server deployments, use `--no-tmux` mode which logs to file instead of tmux panes.

> **Tip:** On Linux, `critters init` can generate a systemd service file automatically. It writes `~/.critters/critters.service` with paths pre-filled for your system. Just copy it into place and enable.

Here's what the generated service file looks like (or create it manually at `/etc/systemd/system/critters.service`):

```ini
[Unit]
Description=Critters daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/critters --no-tmux --json-logs --config ~/.critters/config.yaml
Restart=on-failure
RestartSec=10
Environment=HOME=/home/critters
# Ensure tools are on the PATH for the service user
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/home/critters/.local/bin
StandardOutput=journal
StandardError=journal
WorkingDirectory=/home/critters

[Install]
WantedBy=multi-user.target
```

Then copy, enable, and start:

```bash
sudo cp ~/.critters/critters.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now critters
journalctl -u critters -f
```

**`--no-tmux` mode details:**
- Ignores SIGHUP and SIGPIPE signals (safe for daemonized use)
- Logs to `~/.critters/critters.log` with automatic rotation at `maxLogSizeMb` (default 10 MB)
- Keeps up to 3 rotated files (`.1`, `.2`, `.3`)
- Use `--json-logs` for structured JSON output (one object per line)

Make sure the service user has `claude`, `gh`, `git`, and `jq` on its PATH. The `Environment=PATH=...` line in the unit file ensures this.

### Option C: Docker

The project includes a `Dockerfile` and `docker-compose.yaml`. The Docker image is also published to GHCR on each release.

```bash
# Clone and configure
git clone https://github.com/ack-ventures/critters && cd critters
cp .env.example .env
# Edit .env — set ANTHROPIC_API_KEY and LINEAR_API_KEY (and/or JIRA_* vars)

# Start
docker compose up -d

# View logs
docker compose logs -f

# Dashboard at http://localhost:3847
```

The image includes all runtime dependencies (Claude Code CLI, `gh`, `git`, `jq`, `ngrok`). It runs with `--no-tmux --json-logs --skip-update`.

**Volume mounts** (configured in `docker-compose.yaml`):
- `~/.critters` — config, metrics, state
- `~/.ssh` — SSH keys for git clone (read-only)
- `~/.config/gh` — GitHub CLI auth (read-only)
- `~/.claude` and `~/.claude.json` — Claude CLI auth

**Auth:** Docker requires `ANTHROPIC_API_KEY` in `.env` (interactive Claude auth via system keychain doesn't work in containers). GitHub CLI must be authenticated on the host first (`gh auth login`).

For the pre-built image, replace `build: .` with `image: ghcr.io/ack-ventures/critters:latest` in `docker-compose.yaml`.

> **Note:** The pre-built image is `linux/amd64` only. On ARM64 hosts (Apple Silicon, AWS Graviton), build locally with `docker compose build` instead.

## Updating

### Manual update

```bash
critters update
```

This checks GitHub releases, downloads the new binary with a progress bar, verifies the SHA-256 checksum, creates a backup of the current binary (`critters-vX.Y.Z.bak`), and replaces it in place. Takes effect on next daemon restart.

Or re-run the install script — it detects an existing install and updates in place:

```bash
curl -fsSL https://raw.githubusercontent.com/ack-ventures/critters/main/install.sh | bash
```

### Auto-update

The daemon checks for updates on startup automatically. Skip this with `--skip-update`. Auto-update only works when running as a compiled binary (not via `bun run`).

## Log management

### tmux mode

Output goes to tmux panes — one per active critter phase. The main pane title shows the daemon version, uptime, and active count.

### `--no-tmux` mode

Logs are written to `~/.critters/critters.log`. Log rotation happens automatically:
- Rotates when the file exceeds `maxLogSizeMb` (default 10 MB)
- Keeps up to 3 rotated files (`.1`, `.2`, `.3`)
- Rotation is checked hourly and after every 1000 log writes

### `--json-logs` flag

Structured JSON output (one object per line):

```json
{"timestamp":"2026-03-05T12:00:00.000Z","level":"info","message":"Polling for issues..."}
{"timestamp":"2026-03-05T12:00:01.000Z","level":"info","message":"Picked up ACK-123","identifier":"ACK-123"}
```

Fields: `timestamp` (ISO 8601), `level` (`"info"`, `"warn"`, `"error"`), `message`, and optionally `identifier` for task-scoped logs. Info/warn logs go to stdout; error logs go to stderr.

### CLI log commands

- `critters logs <ID>` — view logs for a specific critter run
- `critters logs <ID> --phase planning|execution|review` — filter by phase
- `critters logs <ID> --follow` or `-f` — tail a specific critter's log
- `critters tail` — live-stream output from all active critters

## Remote dashboard access

The daemon runs an HTTP dashboard on port 3847 (configurable via `healthPort`, set to 0 to disable). The dashboard has no built-in authentication — protect it using one of these approaches.

### Option 1: ngrok tunnel (built-in)

Configure in your config file:

```yaml
tunnel:
  enabled: true
  auth: "user:password"              # basic auth (recommended)
  domain: your-domain.ngrok-free.app # static domain (optional, free tier gives one)
```

Requires the `ngrok` CLI installed. The daemon starts the tunnel automatically and logs the public URL on startup. The tunnel proxies to your local `healthPort`.

### Option 2: Reverse proxy

**Nginx example:**

```nginx
server {
    listen 443 ssl;
    server_name critters.example.com;

    ssl_certificate /etc/letsencrypt/live/critters.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/critters.example.com/privkey.pem;

    auth_basic "Critters Dashboard";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://localhost:3847;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SSE support for log streaming
    location /api/logs/ {
        proxy_pass http://localhost:3847;
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
    }
}
```

**Caddy example** (automatic HTTPS):

```
critters.example.com {
    basicauth / {
        admin $2a$14$... # bcrypt hash
    }
    reverse_proxy localhost:3847
}
```

## Monitoring & observability

### HTTP endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` or `/dashboard` | GET | HTML dashboard with summary stats, 14-day charts, and recent activity table. Auto-refreshes every 30s |
| `/healthz` | GET | JSON health check: uptime, version, per-type active/queued counts, active critter details, metrics summary |
| `/metrics` | GET | JSON array of recent metric events (last 100) |
| `/poll` | POST | Trigger an immediate poll cycle |
| `/review-poll` | POST | Trigger an immediate review poll cycle |
| `/logs/<identifier>` | GET | HTML log viewer page for a specific critter |
| `/api/logs/<identifier>` | GET | Plain-text log tail (supports `?phase=planning\|execution\|review` and `?tail=N` query params) |
| `/api/logs/<identifier>/stream` | GET | SSE stream of live critter output (auto-closes when the critter finishes) |

The health port is configurable via `healthPort` (default 3847, set to 0 to disable entirely).

### Uptime monitoring

Point your monitoring tool (UptimeRobot, Datadog, Pingdom, etc.) at `GET /healthz`. A 200 response with `"status": "ok"` means the daemon is running.

### Metrics

Metrics are stored in `~/.critters/metrics.jsonl` (JSONL format). Events tracked:

- `task_started`, `task_completed`, `task_failed`
- `review_started`, `review_completed`, `review_failed`
- `poll_completed`

Metrics are retained for `metricsRetentionDays` (default 90) before pruning.

### Slack notifications

**Basic notifications:** Set `SLACK_WEBHOOK_URL` in your `.env` file.

**Threaded notifications** (all updates for an issue grouped under one message): Set `SLACK_BOT_TOKEN` and `SLACK_CHANNEL` instead. The daemon uses the Slack Web API and threads subsequent notifications under the initial message for each issue.

Notifications are sent for: task picked up, planning complete, PR created, task failed, timeout warning (at 80%), review started, review merged, review needs changes, review failed.

### Cost alerts

Set `costAlertThreshold` (USD) in your config to receive a Slack alert when a single task exceeds that cost.

### CLI monitoring

```bash
critters status
```

Queries the health endpoint and displays a summary: active/queued critters, uptime, and today's stats.

## Validating configuration

Before starting the daemon, validate your setup:

```bash
# Validate config file syntax and field constraints
critters validate

# Poll once, show what would be picked up, exit without running
critters --dry-run

# Filter dry-run to a specific critter type
critters --dry-run --type code-audit
```

`critters validate` checks: YAML parsing, field constraints (ranges, formats), repo URL format, provider credential availability, and critter type definitions.
