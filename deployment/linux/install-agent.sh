#!/usr/bin/env bash
# AURO-DLP — Linux endpoint agent installer.
# Run as root.
#
# Usage:
#   sudo ./install-agent.sh https://dlp.hospital.local:8443 <enrollment-token>

set -euo pipefail

SERVER_URL="${1:-}"
TOKEN="${2:-}"
INSTALL_DIR=/opt/auro-dlp
DATA_DIR=/var/lib/auro-dlp
CONF_DIR=/etc/auro-dlp
LOG_DIR=/var/log/auro-dlp
SVC_USER=auro-dlp

if [[ -z "$SERVER_URL" || -z "$TOKEN" ]]; then
  echo "usage: $0 <server-url> <enrollment-token>" >&2
  exit 64
fi
if [[ $EUID -ne 0 ]]; then
  echo "must run as root" >&2
  exit 1
fi
if [[ ! -f "./auro-agent" ]]; then
  echo "auro-agent binary not found in $(pwd)" >&2
  exit 2
fi

# 1. user
if ! id "$SVC_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SVC_USER"
fi

# 2. dirs
install -d -m 0755 "$INSTALL_DIR"
install -d -m 0750 -o "$SVC_USER" -g "$SVC_USER" "$DATA_DIR" "$LOG_DIR"
install -d -m 0755 "$CONF_DIR"

# 3. binary
install -m 0755 ./auro-agent "$INSTALL_DIR/auro-agent"
# Read-only via immutable bit (resists trivial tamper). Best effort: ext4 only.
chattr +i "$INSTALL_DIR/auro-agent" 2>/dev/null || true

# 4. config
cat >"$CONF_DIR/agent.yaml" <<EOF
listen: "127.0.0.1:7443"
data_dir: "$DATA_DIR"
server_url: "$SERVER_URL"
heartbeat_seconds: 60
ocr:
  enabled: true
  langs: ["eng", "hin"]
tamper:
  enabled: true
EOF
chmod 0644 "$CONF_DIR/agent.yaml"

# 5. enroll (best effort — agent retries on first start)
ENROLL_BODY=$(printf '{"token":"%s","hostname":"%s","os":"%s","agentVersion":"1.0.0"}' \
                  "$TOKEN" "$(hostname)" "$(uname -srm)")
RESP=$(curl -fsS -m 30 -H 'content-type: application/json' \
            -d "$ENROLL_BODY" \
            "$SERVER_URL/api/v1/agents/enroll" 2>/dev/null || true)
if [[ -n "$RESP" ]]; then
  echo "$RESP" | python3 -c '
import json, sys, pathlib
r = json.load(sys.stdin)
pathlib.Path("'"$DATA_DIR"'/agent.id").write_text(r["agentId"])
pathlib.Path("'"$DATA_DIR"'/agent.cert.pem").write_text(r["certificate"])
pathlib.Path("'"$DATA_DIR"'/server.ca.pem").write_text(r["caCertificate"])
'
  echo "[+] Enrolled."
else
  echo "[!] Enrollment failed; agent will retry."
fi

# 6. systemd unit
install -m 0644 ./auro-agent.service /etc/systemd/system/auro-agent.service
systemctl daemon-reload
systemctl enable --now auro-agent.service

systemctl is-active --quiet auro-agent.service || {
  echo "service failed to start; see: journalctl -u auro-agent -n 100" >&2
  exit 3
}

cat <<EOF

==================================================================
  AURO-DLP installed.
  Service:    auro-agent.service
  Binary:     $INSTALL_DIR/auro-agent
  Data dir:   $DATA_DIR
  Server:     $SERVER_URL
==================================================================
EOF
