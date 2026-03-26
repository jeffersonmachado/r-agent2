#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

KEEP_UP="${STACK_KEEP_UP:-0}"

cleanup() {
  if [[ "$KEEP_UP" == "1" ]]; then
    echo "[stack-full] STACK_KEEP_UP=1 -> mantendo stack ativa"
    return 0
  fi

  echo "[stack-full] Derrubando stack de teste..."
  bash ./scripts/test-stack-down.sh
}

trap cleanup EXIT

echo "[stack-full] Subindo stack..."
bash ./scripts/test-stack-up.sh

echo "[stack-full] Executando smoke..."
bash ./scripts/test-stack-smoke.sh

echo "[stack-full] Executando seed/RPA..."
bash ./scripts/test-stack-rpa-seed.sh

echo "[stack-full] OK"
