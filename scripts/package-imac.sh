#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="${1:-$(date +%Y%m%d-%H%M%S)}"
PACKAGE_NAME="home-assistant-mcp-imac-${VERSION}"
DEPLOY_ROOT="$ROOT_DIR/deploy"
DEPLOY_DIR="$DEPLOY_ROOT/$PACKAGE_NAME"
IMAGE_DIR="$DEPLOY_DIR/images"
IMAGE_TAR="$IMAGE_DIR/home-assistant-mcp-images.tar"
ARCHIVE_PATH="$DEPLOY_ROOT/${PACKAGE_NAME}.tar.gz"
INSTALLER_PATH="$DEPLOY_ROOT/install_on_imac.sh"

SERVER_IMAGE_VERSIONED="home-assistant-mcp-server:${VERSION}"
LOG_IMAGE_VERSIONED="home-assistant-log-platform:${VERSION}"
SERVER_IMAGE_IMAC="home-assistant-mcp-server:imac"
LOG_IMAGE_IMAC="home-assistant-log-platform:imac"
POSTGRES_IMAGE="postgres:16"

if ! command -v docker >/dev/null 2>&1; then
  echo "[error] Docker is not installed."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[error] Docker is not running. Start Docker Desktop first."
  exit 1
fi

if [ -d "$DEPLOY_DIR" ]; then
  rm -rf "$DEPLOY_DIR"
fi

mkdir -p "$IMAGE_DIR" "$DEPLOY_DIR/config"

echo "[info] Building $SERVER_IMAGE_VERSIONED..."
docker build \
  -f packages/mcp-server/Dockerfile \
  -t "$SERVER_IMAGE_VERSIONED" \
  -t "$SERVER_IMAGE_IMAC" \
  .

echo "[info] Building $LOG_IMAGE_VERSIONED..."
docker build \
  -f apps/log-platform/Dockerfile \
  -t "$LOG_IMAGE_VERSIONED" \
  -t "$LOG_IMAGE_IMAC" \
  .

echo "[info] Ensuring $POSTGRES_IMAGE is available..."
docker pull "$POSTGRES_IMAGE"

echo "[info] Saving Docker images..."
docker save \
  "$SERVER_IMAGE_IMAC" \
  "$LOG_IMAGE_IMAC" \
  "$POSTGRES_IMAGE" \
  -o "$IMAGE_TAR"

cp docker-compose.image.yml "$DEPLOY_DIR/docker-compose.image.yml"
cp scripts/run-on-imac.sh "$DEPLOY_DIR/run_on_imac.sh"
chmod +x "$DEPLOY_DIR/run_on_imac.sh"

if [ -f ".env" ]; then
  cp ".env" "$DEPLOY_DIR/.env"
else
  cp ".env.example" "$DEPLOY_DIR/.env"
  echo "[warn] .env not found. Copied .env.example; fill it on the iMac before running."
fi

cp ".env.example" "$DEPLOY_DIR/.env.example"

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '.storage/' \
    --exclude '.cache/' \
    --exclude '.HA_VERSION' \
    --exclude '.ha_run.lock' \
    --exclude '.DS_Store' \
    --exclude 'secrets.yaml' \
    --exclude '*.db' \
    --exclude '*.db-shm' \
    --exclude '*.db-wal' \
    --exclude '*.log' \
    --exclude '*.log.*' \
    config/ "$DEPLOY_DIR/config/"
else
  cp -R config/. "$DEPLOY_DIR/config/"
fi

tar -C "$DEPLOY_ROOT" -czf "$ARCHIVE_PATH" "$PACKAGE_NAME"

cat > "$INSTALLER_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "\$SCRIPT_DIR"

PACKAGE_NAME="${PACKAGE_NAME}"
ARCHIVE_NAME="${PACKAGE_NAME}.tar.gz"

if [ ! -f "\$ARCHIVE_NAME" ]; then
  echo "[error] Missing \$ARCHIVE_NAME. Put this script next to the deployment archive."
  exit 1
fi

tar -xzf "\$ARCHIVE_NAME"
cd "\$PACKAGE_NAME"
./run_on_imac.sh
EOF

chmod +x "$INSTALLER_PATH"

echo ""
echo "[info] Deployment directory: $DEPLOY_DIR"
echo "[info] Archive:              $ARCHIVE_PATH"
echo "[info] iMac installer:       $INSTALLER_PATH"
echo "[info] iMac command:"
echo "       ./install_on_imac.sh"
