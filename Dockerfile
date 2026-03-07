FROM oven/bun:1 AS build

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile
COPY src/ src/
COPY CLAUDE.md ./

ARG VERSION=dev
RUN echo "export const VERSION = \"${VERSION}\";" > src/version.ts

RUN bun build --compile src/index.ts --outfile /app/critters

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
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

# Set default git identity for commits
RUN git config --global user.name "Critters" \
  && git config --global user.email "critters@noreply"

COPY --from=build /app/critters /app/critters

WORKDIR /app
EXPOSE 3847

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3847/healthz || exit 1

CMD ["./critters", "--no-tmux", "--json-logs", "--skip-update"]
