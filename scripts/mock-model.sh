#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="$ROOT/policy-server/models/auro-pii-indicv2/0.1.0"

mkdir -p "$MODEL_DIR"

echo "[mock-model] Creating stub model files for dev (regex-only mode)..."

# Empty ONNX — agent detects zero-byte and falls back to regex
: > "$MODEL_DIR/model.onnx"

cat > "$MODEL_DIR/tokenizer.json" <<'EOF'
{
  "type": "stub",
  "version": "0.0.0",
  "note": "Stub tokenizer for dev — agent uses regex-only mode"
}
EOF

cat > "$MODEL_DIR/config.json" <<'EOF'
{
  "model_type": "stub",
  "architectures": ["XLMRobertaForTokenClassification"],
  "id2label": {"0": "O", "1": "B-PII", "2": "I-PII"},
  "label2id": {"O": 0, "B-PII": 1, "I-PII": 2},
  "stub": true
}
EOF

cat > "$MODEL_DIR/labels.json" <<'EOF'
{
  "O": 0,
  "B-PII": 1,
  "I-PII": 2,
  "B-AADHAAR": 3,
  "I-AADHAAR": 4,
  "B-PAN": 5,
  "I-PAN": 6,
  "B-PHONE": 7,
  "I-PHONE": 8,
  "B-EMAIL": 9,
  "I-EMAIL": 10,
  "B-MRN": 11,
  "I-MRN": 12
}
EOF

echo "[mock-model] Stub created at: $MODEL_DIR"
echo "             Agent will detect stub and use regex-only detection."
ls -la "$MODEL_DIR/"
