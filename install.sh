#!/bin/sh
set -e

# Critters installer — downloads the latest release binary and sets up config.
# Usage: curl -fsSL https://raw.githubusercontent.com/ack-ventures/critters/main/install.sh | bash

REPO="ack-ventures/critters"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"

# ── Helpers ──────────────────────────────────────────────────────────────────

info()  { printf '  %s\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
error() { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

# ── Platform detection ───────────────────────────────────────────────────────

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  darwin) ;;
  linux)  ;;
  *)      error "Unsupported OS: $OS" ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64)        ARCH="x64"   ;;
  *)             error "Unsupported architecture: $ARCH" ;;
esac

ASSET_NAME="critters-${OS}-${ARCH}"
bold "Critters Installer"
info "Platform: ${OS}/${ARCH}"

# ── Prerequisites ────────────────────────────────────────────────────────────

missing=""
for cmd in curl claude gh tmux jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    missing="$missing $cmd"
  fi
done

if [ -n "$missing" ]; then
  error "Missing required commands:$missing"
fi

# ── Detect existing install ──────────────────────────────────────────────────

EXISTING=""
if command -v critters >/dev/null 2>&1; then
  EXISTING="$(command -v critters)"
  info "Existing install found at $EXISTING — updating"
fi

# ── Fetch latest release ────────────────────────────────────────────────────

info "Fetching latest release..."
RELEASE_JSON="$(curl -fsSL -H "Accept: application/vnd.github+json" -H "User-Agent: critters-installer" "$API_URL")"

TAG="$(printf '%s' "$RELEASE_JSON" | jq -r '.tag_name')"
if [ -z "$TAG" ] || [ "$TAG" = "null" ]; then
  error "Could not determine latest release tag"
fi

VERSION="${TAG#v}"
info "Latest version: $VERSION"

DOWNLOAD_URL="$(printf '%s' "$RELEASE_JSON" | jq -r --arg name "$ASSET_NAME" '.assets[] | select(.name == $name) | .browser_download_url')"
if [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ]; then
  error "No binary found for ${ASSET_NAME} in release ${TAG}"
fi

# ── Download binary ──────────────────────────────────────────────────────────

TMPFILE="$(mktemp)"
trap 'rm -f "$TMPFILE"' EXIT
info "Downloading ${ASSET_NAME}..."
curl -fsSL -o "$TMPFILE" "$DOWNLOAD_URL"
chmod +x "$TMPFILE"

# ── Install binary ───────────────────────────────────────────────────────────

INSTALL_DIR=""

if [ -n "$EXISTING" ]; then
  # Update in place
  INSTALL_DIR="$(dirname "$EXISTING")"
  INSTALL_PATH="$EXISTING"
  if [ -w "$INSTALL_DIR" ]; then
    mv "$TMPFILE" "$INSTALL_PATH"
  else
    sudo mv "$TMPFILE" "$INSTALL_PATH"
  fi
else
  # Fresh install — try /usr/local/bin first, fall back to ~/.local/bin
  if [ -d "/usr/local/bin" ] && { [ -w "/usr/local/bin" ] || command -v sudo >/dev/null 2>&1; }; then
    INSTALL_PATH="/usr/local/bin/critters"
    if [ -w "/usr/local/bin" ]; then
      mv "$TMPFILE" "$INSTALL_PATH"
    else
      info "Installing to /usr/local/bin (requires sudo)..."
      sudo mv "$TMPFILE" "$INSTALL_PATH"
    fi
  else
    INSTALL_DIR="$HOME/.local/bin"
    INSTALL_PATH="$INSTALL_DIR/critters"
    mkdir -p "$INSTALL_DIR"
    mv "$TMPFILE" "$INSTALL_PATH"
  fi
fi

chmod +x "$INSTALL_PATH"
info "Installed to $INSTALL_PATH"

# ── PATH check ───────────────────────────────────────────────────────────────

case "$INSTALL_PATH" in
  "$HOME/.local/bin/"*|"$HOME/.local/bin")
    case ":$PATH:" in
      *":$HOME/.local/bin:"*) ;;
      *)
        SHELL_NAME="$(basename "$SHELL")"
        case "$SHELL_NAME" in
          zsh)  RC_FILE="$HOME/.zshrc" ;;
          bash) RC_FILE="$HOME/.bashrc" ;;
          *)    RC_FILE="" ;;
        esac
        if [ -n "$RC_FILE" ]; then
          printf '  %s is not on your PATH. Add it? [Y/n] ' "$HOME/.local/bin"
          read -r reply < /dev/tty
          case "$reply" in
            [nN]*)
              info "Skipping PATH update. Add manually:"
              info "  export PATH=\"\$HOME/.local/bin:\$PATH\""
              ;;
            *)
              printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$RC_FILE"
              info "Added to $RC_FILE — restart your shell or run: source $RC_FILE"
              ;;
          esac
        else
          info "$HOME/.local/bin is not on your PATH. Add it manually:"
          info "  export PATH=\"\$HOME/.local/bin:\$PATH\""
        fi
        ;;
    esac
    ;;
esac

# ── Config setup (fresh install only) ───────────────────────────────────────

if [ -z "$EXISTING" ]; then
  CRITTERS_DIR="$HOME/.critters"
  CONFIG_FILE="$CRITTERS_DIR/config.yaml"
  ENV_FILE="$CRITTERS_DIR/.env"

  mkdir -p "$CRITTERS_DIR"

  if [ ! -f "$CONFIG_FILE" ]; then
    cat > "$CONFIG_FILE" << 'YAML'
pollIntervalSeconds: 120
concurrency: 2
timeoutMinutes: 30
workDir: /tmp/critters-work
triggerLabel: "Critter"
maxPlanningTurns: 50
maxExecutionTurns: 75
tmuxSession: critters

defaultAllowedTools:
  - "Read"
  - "Write"
  - "Edit"
  - "Glob"
  - "Grep"
  - "Bash(git:*)"
  - "Bash(gh:*)"
  - "Bash(bun:*)"
  - "Bash(npm:*)"
  - "Bash(npx:*)"
  - "Bash(node:*)"
  - "Bash(tsc:*)"
  - "Bash(ls:*)"
  - "Bash(mkdir:*)"
  - "Bash(cat:*)"

repos: {}

teamRepos: {}
YAML
    info "Wrote default config to $CONFIG_FILE"
  fi

  if [ ! -f "$ENV_FILE" ]; then
    printf '  LINEAR_API_KEY (required): '
    read -r LINEAR_KEY < /dev/tty
    if [ -n "$LINEAR_KEY" ]; then
      touch "$ENV_FILE" && chmod 600 "$ENV_FILE"
      printf 'LINEAR_API_KEY=%s\n' "$LINEAR_KEY" > "$ENV_FILE"

      printf '  SLACK_WEBHOOK_URL (optional, press Enter to skip): '
      read -r SLACK_URL < /dev/tty
      if [ -n "$SLACK_URL" ]; then
        printf 'SLACK_WEBHOOK_URL=%s\n' "$SLACK_URL" >> "$ENV_FILE"
      fi

      info "Wrote $ENV_FILE"
    else
      info "Skipped .env — set LINEAR_API_KEY later in $ENV_FILE"
    fi
  else
    info "$ENV_FILE already exists, skipping"
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
bold "Critters v${VERSION} installed!"
info "Binary:  $INSTALL_PATH"
if [ -z "$EXISTING" ]; then
  info "Config:  $HOME/.critters/config.yaml"
  info "Env:     $HOME/.critters/.env"
fi
echo ""
info "Start a tmux session and run:"
info "  tmux new -s critters"
info "  critters"
