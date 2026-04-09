# ── Build from source (dev only) ─────────────────────────────────────
FROM oven/bun:1 AS build

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile
COPY src/ src/
COPY scripts/ scripts/
COPY CLAUDE.md ./

RUN node scripts/bundle-release-notes.cjs

ARG VERSION=dev
RUN echo "export const VERSION = \"${VERSION}\";" > src/version.ts

RUN bun build --compile src/index.ts --outfile /app/critters

# ── Shared runtime ───────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    jq \
    curl \
    ca-certificates \
    gnupg \
  && rm -rf /var/lib/apt/lists/*

# Install Node.js (LTS) — required by Claude Code CLI
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# Install ngrok (for optional tunnel support)
RUN curl -fsSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
    | gpg --dearmor -o /usr/share/keyrings/ngrok-archive-keyring.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/ngrok-archive-keyring.gpg] https://ngrok-agent.s3.amazonaws.com buster main" \
    > /etc/apt/sources.list.d/ngrok.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends ngrok \
  && rm -rf /var/lib/apt/lists/*

# Set default git identity for commits
RUN git config --global user.name "Critters" \
  && git config --global user.email "critters@noreply"

WORKDIR /app
EXPOSE 3847

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3847/healthz || exit 1

CMD ["./critters", "--no-tmux", "--daemonized", "--json-logs", "--skip-update"]

# ── Prod: download release binary ────────────────────────────────────
# Usage: docker build --target prod .
#        docker build --target prod --build-arg CRITTERS_VERSION=1.6.0 .
FROM runtime AS prod
ARG CRITTERS_VERSION=latest
RUN set -eux; \
    ARCH=$(dpkg --print-architecture); \
    case "$ARCH" in \
      amd64) ASSET="critters-linux-x64" ;; \
      arm64) ASSET="critters-linux-arm64" ;; \
      *) echo "Unsupported architecture: $ARCH" && exit 1 ;; \
    esac; \
    if [ "$CRITTERS_VERSION" = "latest" ]; then \
      URL=$(curl -fsSL https://api.github.com/repos/ack-ventures/critters/releases/latest \
        | jq -r --arg a "$ASSET" '.assets[] | select(.name == $a) | .browser_download_url'); \
    else \
      URL="https://github.com/ack-ventures/critters/releases/download/v${CRITTERS_VERSION}/${ASSET}"; \
    fi; \
    curl -fsSL -o /app/critters "$URL" \
    && chmod +x /app/critters

# ── Dev (default): build from source ─────────────────────────────────
# This is the default target (used by `docker build .` and CI).
FROM runtime AS dev
COPY --from=build /app/critters /app/critters
