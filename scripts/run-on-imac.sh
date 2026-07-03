#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="docker-compose.image.yml"
IMAGE_TAR="images/home-assistant-mcp-images.tar"

if ! command -v docker >/dev/null 2>&1; then
  echo "[error] Docker is not installed. Install and start Docker Desktop first."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[error] Docker is not running. Start Docker Desktop first."
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[error] Missing $COMPOSE_FILE. Run this script from the deployment bundle directory."
  exit 1
fi

if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp ".env.example" ".env"
  fi
  echo "[error] Missing .env. Fill HOME_ASSISTANT_BASE_URL and HOME_ASSISTANT_TOKEN or HA_TOKEN, then rerun."
  exit 1
fi

if [ -f "$IMAGE_TAR" ]; then
  echo "[info] Loading Docker images from $IMAGE_TAR..."
  docker load -i "$IMAGE_TAR"
else
  echo "[warn] $IMAGE_TAR not found. Docker will use local images or pull missing base images."
fi

echo "[info] Starting home-assistant-mcp..."
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "[info] Log platform: http://127.0.0.1:5175"
echo "[info] Admin API:    http://127.0.0.1:4000/healthz"
echo "[info] MCP HTTP:     http://127.0.0.1:4010/mcp"

if command -v open >/dev/null 2>&1; then
  open "http://127.0.0.1:5175" >/dev/null 2>&1 || true
fi
