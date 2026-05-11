#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORPUS="$ROOT/samples/corpus"
AGENT="$ROOT/endpoint-agent"
RESULTS="$ROOT/samples/baseline.json"
CONFIG="${EVAL_CONFIG:-/tmp/auro-agent-dev.yaml}"
AGENT_BIN="${EVAL_AGENT_BIN:-}"
EVAL_LOG="/tmp/auro-eval-detail.tsv"

if [[ -z "$AGENT_BIN" ]]; then
  if ! command -v go &>/dev/null; then
    echo "ERROR: go not found" && exit 1
  fi
  echo "[eval] Building agent..."
  (cd "$AGENT" && go build -o /tmp/auro-agent-eval ./cmd/auro-agent) 2>/dev/null || {
    echo "[eval] Build failed — trying without cgo"
    (cd "$AGENT" && CGO_ENABLED=0 go build -o /tmp/auro-agent-eval ./cmd/auro-agent)
  }
  AGENT_BIN="/tmp/auro-agent-eval"
fi

mkdir -p /tmp/auro-data

normalize_verdict() {
  local v="$1"
  case "$v" in
    BLOCK_NO_OVERRIDE|BLOCK_OVERRIDE) echo "BLOCK" ;;
    WARN_OVERRIDE)                    echo "WARN" ;;
    *)                                echo "$v" ;;
  esac
}

TOTAL=0
CORRECT=0

echo "[eval] Running corpus through agent..."
echo '{"results":[' > "$RESULTS"
: > "$EVAL_LOG"
FIRST=1

for f in $(find "$CORPUS" -name '*.md' | sort); do
  TOTAL=$((TOTAL + 1))
  category=$(basename "$(dirname "$f")")
  expected_verdict=$(awk '/^expected_verdict:/{print $2}' "$f")

  raw_output=$("$AGENT_BIN" --config "$CONFIG" --scan "$f" 2>/dev/null || echo "verdict: ERROR")
  raw_verdict=$(echo "$raw_output" | grep -o 'verdict: [A-Z_]*' | head -1 | awk '{print $2}')
  raw_verdict="${raw_verdict:-ERROR}"
  actual_verdict=$(normalize_verdict "$raw_verdict")

  match="false"
  if [[ "$actual_verdict" == "$expected_verdict" ]]; then
    CORRECT=$((CORRECT + 1))
    match="true"
  fi

  printf "%s\t%s\t%s\t%s\n" "$category" "$expected_verdict" "$actual_verdict" "$match" >> "$EVAL_LOG"

  if [[ "$FIRST" -eq 1 ]]; then FIRST=0; else echo ',' >> "$RESULTS"; fi
  echo "{\"file\":\"$(basename "$f")\",\"expected\":\"$expected_verdict\",\"actual\":\"$actual_verdict\",\"match\":$match,\"category\":\"$category\"}" >> "$RESULTS"
done

echo '],' >> "$RESULTS"

accuracy=$(python3 -c "print(round($CORRECT/$TOTAL*100, 1))" 2>/dev/null || echo "0")
echo "\"summary\":{\"total\":$TOTAL,\"correct\":$CORRECT,\"accuracy\":$accuracy}}" >> "$RESULTS"

echo
echo "=== Evaluation Complete ==="
echo "Total: $TOTAL | Correct: $CORRECT | Accuracy: ${accuracy}%"
echo
echo "=== Per-Category Results ==="
python3 - "$EVAL_LOG" <<'PYEOF'
import sys
from collections import defaultdict

cats = defaultdict(lambda: {"total":0,"correct":0,"tp":0,"fp":0,"fn":0})
with open(sys.argv[1]) as fh:
    for line in fh:
        cat, exp, act, match = line.strip().split("\t")
        cats[cat]["total"] += 1
        if match == "true":
            cats[cat]["correct"] += 1
        if exp != "ALLOW":
            if act == exp:
                cats[cat]["tp"] += 1
            else:
                cats[cat]["fn"] += 1
        else:
            if act != "ALLOW":
                cats[cat]["fp"] += 1

print(f"{'Category':<20} {'Acc':>6} {'P':>6} {'R':>6} {'F1':>6}  TP  FP  FN")
print("-" * 72)
for cat in sorted(cats):
    d = cats[cat]
    acc = round(d["correct"]/d["total"]*100,1) if d["total"] else 0
    tp, fp, fn = d["tp"], d["fp"], d["fn"]
    p = round(tp/(tp+fp)*100,1) if tp+fp else 0
    r = round(tp/(tp+fn)*100,1) if tp+fn else 0
    f1 = round(2*p*r/(p+r),1) if p+r else 0
    print(f"{cat:<20} {acc:>5.1f}% {p:>5.1f}% {r:>5.1f}% {f1:>5.1f}%  {tp:>2}  {fp:>2}  {fn:>2}")
PYEOF

echo
echo "Results: $RESULTS"
