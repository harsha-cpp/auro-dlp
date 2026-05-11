#!/usr/bin/env bash
# Build everything in one shot.
#   ./scripts/build-all.sh           # build for current OS
#   ./scripts/build-all.sh windows   # cross-build the Windows agent .exe
#   ./scripts/build-all.sh all       # build agent for linux+windows, server, dashboard, extension

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
TARGET="${1:-linux}"

sha256() { command -v sha256sum &>/dev/null && sha256sum "$1" || shasum -a 256 "$1"; }

mkdir -p "$DIST"

build_agent_linux() {
  echo "== Building Go agent (linux/amd64)…"
  ( cd "$ROOT/endpoint-agent" && \
    GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
      go build -trimpath -ldflags='-s -w -X main.version=1.0.0' \
      -o "$DIST/auro-agent-linux-amd64" ./cmd/auro-agent )
  sha256 "$DIST/auro-agent-linux-amd64"
}

build_agent_windows() {
  echo "== Building Go agent (windows/amd64)…"
  ( cd "$ROOT/endpoint-agent" && \
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
      go build -trimpath -ldflags='-s -w -X main.version=1.0.0' \
      -o "$DIST/auro-agent.exe" ./cmd/auro-agent )
  sha256 "$DIST/auro-agent.exe"
}

build_server() {
  echo "== Installing policy-server deps & seeding…"
  ( cd "$ROOT/policy-server" && npm ci --omit=dev )
  tar -C "$ROOT" --exclude=node_modules -czf "$DIST/policy-server.tgz" policy-server
  echo "wrote $DIST/policy-server.tgz"
}

build_dashboard() {
  echo "== Building admin dashboard…"
  ( cd "$ROOT/admin-dashboard" && npm ci && npm run build )
  cp -r "$ROOT/admin-dashboard/dist" "$DIST/admin-dashboard-dist"
}

build_extension() {
  echo "== Packaging browser extension…"
  ( cd "$ROOT/browser-extension" && \
      zip -r "$DIST/auro-dlp-extension.zip" . -x '*.git*' 'node_modules/*' )
  sha256 "$DIST/auro-dlp-extension.zip"
}

case "$TARGET" in
  linux)    build_agent_linux ;;
  windows)  build_agent_windows ;;
  server)   build_server ;;
  dashboard) build_dashboard ;;
  extension) build_extension ;;
  all)
    build_agent_linux
    build_agent_windows
    build_server
    build_dashboard
    build_extension
    ;;
  *) echo "unknown target: $TARGET (use linux|windows|server|dashboard|extension|all)"; exit 64 ;;
esac

echo
echo "Artifacts in: $DIST"
ls -la "$DIST"
