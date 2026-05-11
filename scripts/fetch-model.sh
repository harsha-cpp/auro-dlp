#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="$ROOT/policy-server/models/auro-pii-indicv2/0.1.0"
HF_REPO="hiteshwadhwani/pii-model-indicv2"

mkdir -p "$MODEL_DIR"

sha256check() {
  local file="$1" expected="$2"
  if [[ ! -f "$file" ]]; then return 1; fi
  local actual
  if command -v sha256sum &>/dev/null; then
    actual=$(sha256sum "$file" | awk '{print $1}')
  else
    actual=$(shasum -a 256 "$file" | awk '{print $1}')
  fi
  [[ "$actual" == "$expected" ]]
}

if [[ -f "$MODEL_DIR/model.onnx" && -f "$MODEL_DIR/tokenizer.json" ]]; then
  echo "[fetch-model] Model already exists in $MODEL_DIR — skipping."
  echo "             Delete the directory to force re-download."
  exit 0
fi

echo "[fetch-model] Downloading $HF_REPO from Hugging Face..."

TMPDIR_DL=$(mktemp -d)
trap "rm -rf $TMPDIR_DL" EXIT

pip install -q huggingface_hub 2>/dev/null || true

python3 -c "
from huggingface_hub import snapshot_download
snapshot_download('$HF_REPO', local_dir='$TMPDIR_DL/raw', ignore_patterns=['*.md', '.gitattributes'])
"

HAS_OPTIMUM=0
if command -v optimum-cli &>/dev/null; then
  HAS_OPTIMUM=1
elif pip install -q optimum[onnxruntime] 2>/dev/null; then
  HAS_OPTIMUM=1
fi

if [[ "$HAS_OPTIMUM" -eq 1 ]]; then
  echo "[fetch-model] Quantizing to INT8 ONNX..."
  optimum-cli export onnx \
    --model "$TMPDIR_DL/raw" \
    --task token-classification \
    "$TMPDIR_DL/onnx/" 2>/dev/null || true

  if [[ -f "$TMPDIR_DL/onnx/model.onnx" ]]; then
    cp "$TMPDIR_DL/onnx/model.onnx" "$MODEL_DIR/model.onnx"
    cp "$TMPDIR_DL/onnx/tokenizer.json" "$MODEL_DIR/tokenizer.json" 2>/dev/null || true
  fi
fi

if [[ ! -f "$MODEL_DIR/model.onnx" ]]; then
  echo "[fetch-model] WARNING: optimum-cli unavailable or export failed. Using raw PyTorch weights."
  echo "              The agent will need a compatible ONNX export. Copying tokenizer only."
  # Copy whatever we have
  cp "$TMPDIR_DL/raw/tokenizer.json" "$MODEL_DIR/tokenizer.json" 2>/dev/null || true
  cp "$TMPDIR_DL/raw/config.json" "$MODEL_DIR/config.json" 2>/dev/null || true
  echo '{"LABEL_0":"O","LABEL_1":"B-PII","LABEL_2":"I-PII"}' > "$MODEL_DIR/labels.json"
  echo "[fetch-model] INCOMPLETE: model.onnx missing. Run optimum-cli manually."
  exit 1
fi

# Ensure supporting files
[[ -f "$MODEL_DIR/tokenizer.json" ]] || cp "$TMPDIR_DL/raw/tokenizer.json" "$MODEL_DIR/tokenizer.json" 2>/dev/null || true
[[ -f "$MODEL_DIR/config.json" ]] || cp "$TMPDIR_DL/raw/config.json" "$MODEL_DIR/config.json" 2>/dev/null || true
[[ -f "$MODEL_DIR/labels.json" ]] || echo '{"LABEL_0":"O","LABEL_1":"B-PII","LABEL_2":"I-PII"}' > "$MODEL_DIR/labels.json"

echo "[fetch-model] Done. Model at: $MODEL_DIR"
ls -lh "$MODEL_DIR/"
