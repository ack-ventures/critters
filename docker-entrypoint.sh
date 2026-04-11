#!/bin/bash
set -e

# Run user-provided setup script if it exists.
# This allows installing runtime tools (node, bun, python, etc.)
# without rebuilding the Docker image.
#
# Default: /root/.critters/setup.sh (auto-mounted via ~/.critters volume)
# Override: set CRITTERS_SETUP_SCRIPT env var to a different path
SETUP_SCRIPT="${CRITTERS_SETUP_SCRIPT:-/root/.critters/setup.sh}"

if [ -f "$SETUP_SCRIPT" ]; then
  echo "[critters] Running setup script: $SETUP_SCRIPT"
  # shellcheck disable=SC1090
  source "$SETUP_SCRIPT"
  echo "[critters] Setup script completed"
fi

exec "$@"
