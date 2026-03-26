#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_TEST_PORT="${API_TEST_PORT:-13001}"
FRONTEND_TEST_PORT="${FRONTEND_TEST_PORT:-15173}"

TEST_API_URL="${TEST_API_URL:-http://localhost:${API_TEST_PORT}}"
TEST_FRONTEND_URL="${TEST_FRONTEND_URL:-http://localhost:${FRONTEND_TEST_PORT}}"
TEST_TENANT_ID="${TEST_TENANT_ID:-system}"
MAX_SECONDS="${MAX_SECONDS:-180}"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"

deadline=$(( $(date +%s) + MAX_SECONDS ))

wait_for() {
  local name="$1"
  local url="$2"

  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[stack-rpa-seed] OK: ${name} (${url})"
      return 0
    fi

    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "[stack-rpa-seed] ERRO: timeout aguardando ${name} (${url})"
      return 1
    fi

    sleep "$SLEEP_SECONDS"
  done
}

echo "[stack-rpa-seed] Aguardando stack ficar pronta..."
wait_for "API ready" "${TEST_API_URL}/health/ready"
wait_for "Frontend" "${TEST_FRONTEND_URL}/"

echo "[stack-rpa-seed] Executando seed/RPA completo..."
TEST_API_URL="$TEST_API_URL" \
TEST_FRONTEND_URL="$TEST_FRONTEND_URL" \
TEST_TENANT_ID="$TEST_TENANT_ID" \
node tests/rpa/seedPlatformRPA.js

echo "[stack-rpa-seed] OK"
