#!/usr/bin/env bash
# Spin up the whole stack locally for development.
# Requires: go 1.22+, node 20+, npm
#
# Layout once running:
#   :8443  policy-server (cleartext, dashboard proxies into it)
#   :5173  vite dev-server for the dashboard
#   :7443  endpoint agent (loopback only)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDS=()

cleanup() {
  echo
  echo "[*] shutting down"
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# 1. policy server
( cd "$ROOT/policy-server"
  [[ -d node_modules ]] || npm install
  [[ -f .env ]] || cat > .env <<EOF
PORT=8443
JWT_SECRET=dev-secret-change-me
DB_PATH=./auro.dev.sqlite
SIGNING_KEY_PATH=./keys/signing.key
EOF
  node src/db/seed.js
  node src/server.js &
  echo $! >&2
) &
PIDS+=($!)

sleep 1

# 2. dashboard
( cd "$ROOT/admin-dashboard"
  [[ -d node_modules ]] || npm install
  npm run dev &
) &
PIDS+=($!)

# 3. endpoint agent
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
  go run ./cmd/auro-agent --config /tmp/agent-dev.yaml --insecure &
) &
PIDS+=($!)

echo
echo "==================================================="
echo "  Dashboard:    http://localhost:5173"
echo "  Policy API:   http://localhost:8443"
echo "  Agent:        http://127.0.0.1:7443/v1/healthz"
echo "  Login:        admin@hospital.local / change-me"
echo "==================================================="
wait
