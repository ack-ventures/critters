#!/usr/bin/env bash
# Local deployment script. By default pulls the latest ghcr image and runs it.
# Pass --dev to build from the working copy instead.
set -euo pipefail

MODE="prod"
for arg in "$@"; do
  case "$arg" in
    --dev) MODE="dev" ;;
    -h|--help)
      echo "Usage: $(basename "$0") [--dev]"
      echo "  (default) pull ghcr.io/ack-ventures/critters:latest and run it"
      echo "  --dev      docker-build from this working copy and run that image"
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

NAME="critters"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$MODE" == "dev" ]]; then
  IMAGE="critters:dev"
else
  IMAGE="ghcr.io/ack-ventures/critters:latest"
fi

echo "==> Spinning down existing containers"
# Handle docker-compose managed container
if docker compose -f "$REPO_DIR/docker-compose.yaml" ps -q 2>/dev/null | grep -q .; then
  docker compose -f "$REPO_DIR/docker-compose.yaml" down
fi
# Handle standalone container
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME"
fi

if [[ "$MODE" == "dev" ]]; then
  echo "==> Building $IMAGE from source (target: dev)"
  docker build --target dev -t "$IMAGE" "$REPO_DIR"
else
  echo "==> Pulling $IMAGE"
  docker pull "$IMAGE"
fi

echo "==> Starting new container"
docker run -d \
  --name "$NAME" \
  --restart unless-stopped \
  --env-file "$REPO_DIR/.env" \
  -v "$HOME/.critters:/root/.critters" \
  -v "$HOME/.ssh:/root/.ssh:ro" \
  -v "$HOME/.claude:/root/.claude" \
  -v "$HOME/.claude.json:/root/.claude.json" \
  -p 3847:3847 \
  "$IMAGE"

echo "==> Waiting for health"
for i in {1..20}; do
  if curl -sf http://localhost:3847/healthz >/dev/null 2>&1; then
    version=$(curl -s http://localhost:3847/healthz | sed -n 's/.*"displayVersion":"\([^"]*\)".*/\1/p')
    echo "==> Up and healthy: $version (mode=$MODE)"
    exit 0
  fi
  sleep 1
done

echo "!! Container did not become healthy in 20s. Check: docker logs $NAME" >&2
exit 1
