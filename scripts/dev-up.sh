#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDS=()

cleanup() {
  echo
  echo "[dev] shutting down..."
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

check_prereq() {
  local cmd="$1" min_ver="$2"
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd not found. Install $cmd >= $min_ver" && exit 1
  fi
}

check_prereq node "20"
check_prereq go "1.22"
check_prereq npm ""

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VER" -lt 20 ]]; then
  echo "ERROR: Node.js 20+ required (have v$NODE_VER)" && exit 1
fi

if ! command -v tesseract &>/dev/null; then
  echo "[dev] WARNING: tesseract not found — OCR disabled"
fi

MODEL_DIR="$ROOT/policy-server/models/auro-pii-indicv2/0.1.0"
if [[ ! -f "$MODEL_DIR/model.onnx" ]]; then
  echo "[dev] No model found — creating stub for regex-only mode..."
  bash "$ROOT/scripts/mock-model.sh"
fi

echo "[dev] Starting policy server..."
( cd "$ROOT/policy-server"
  [[ -d node_modules ]] || npm install --silent
  [[ -f .env ]] || cat > .env <<EOF
PORT=8443
JWT_SECRET=dev-secret-change-me
DB_PATH=./auro.dev.sqlite
SIGNING_KEY_PATH=./keys/signing.key
ALLOWED_ORIGINS=http://localhost:5173
EOF
  node src/db/seed.js 2>/dev/null || true
  node src/server.js &
  echo $!
) &
PIDS+=($!)
sleep 2

echo "[dev] Starting dashboard..."
( cd "$ROOT/admin-dashboard"
  [[ -d node_modules ]] || npm install --silent
  npm run dev &
  echo $!
) &
PIDS+=($!)

echo "[dev] Starting endpoint agent..."
( cd "$ROOT/endpoint-agent"
  mkdir -p /tmp/auro-data
  cat > /tmp/agent-dev.yaml <<EOF
listen: "127.0.0.1:7443"
data_dir: "/tmp/auro-data"
server_url: "http://localhost:8443"
heartbeat_seconds: 30
ocr:
  enabled: false
EOF
  CGO_ENABLED=0 go run ./cmd/auro-agent --config /tmp/agent-dev.yaml --insecure &
  echo $!
) &
PIDS+=($!)

sleep 1
echo
echo "==================================================="
echo "  Dashboard:    http://localhost:5173"
echo "  Policy API:   http://localhost:8443"
echo "  Agent:        http://127.0.0.1:7443/v1/healthz"
echo "  Login:        see policy-server/SEEDED_CREDENTIALS.txt"
echo "==================================================="
echo "  Press Ctrl+C to stop all services"
echo "==================================================="
wait
