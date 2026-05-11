#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="$ROOT/policy-server/models/auro-pii-indicv2/0.1.0"
HF_REPO="Davlan/xlm-roberta-base-ner-hrl"

mkdir -p "$MODEL_DIR"

if [[ -f "$MODEL_DIR/model.onnx" && -f "$MODEL_DIR/tokenizer.json" ]]; then
  echo "[fetch-model-fallback] Model already exists — skipping."
  exit 0
fi

echo "[fetch-model-fallback] Downloading fallback model: $HF_REPO (~70MB)"

TMPDIR_DL=$(mktemp -d)
trap "rm -rf $TMPDIR_DL" EXIT

pip install -q huggingface_hub optimum[onnxruntime] 2>/dev/null || true

python3 -c "
from huggingface_hub import snapshot_download
snapshot_download('$HF_REPO', local_dir='$TMPDIR_DL/raw', ignore_patterns=['*.md', '.gitattributes'])
"

if command -v optimum-cli &>/dev/null; then
  echo "[fetch-model-fallback] Exporting to ONNX + INT8 quantization..."
  optimum-cli export onnx \
    --model "$TMPDIR_DL/raw" \
    --task token-classification \
    "$TMPDIR_DL/onnx/" 2>/dev/null || true

  if [[ -f "$TMPDIR_DL/onnx/model.onnx" ]]; then
    cp "$TMPDIR_DL/onnx/model.onnx" "$MODEL_DIR/model.onnx"
  fi
fi

if [[ ! -f "$MODEL_DIR/model.onnx" ]]; then
  echo "[fetch-model-fallback] WARNING: Could not produce ONNX. Copying raw files."
fi

cp "$TMPDIR_DL/raw/tokenizer.json" "$MODEL_DIR/tokenizer.json" 2>/dev/null || true
cp "$TMPDIR_DL/raw/config.json" "$MODEL_DIR/config.json" 2>/dev/null || true
echo '{"O":0,"B-PER":1,"I-PER":2,"B-ORG":3,"I-ORG":4,"B-LOC":5,"I-LOC":6,"B-DATE":7,"I-DATE":8}' > "$MODEL_DIR/labels.json"

echo "[fetch-model-fallback] Done. Model at: $MODEL_DIR"
