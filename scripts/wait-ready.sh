#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:13001}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:15173}"
RAG_URL="${RAG_URL:-http://localhost:18001}"

MAX_SECONDS="${MAX_SECONDS:-180}"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"

deadline=$(( $(date +%s) + MAX_SECONDS ))

echo "[wait-ready] Aguardando serviços ficarem prontos (timeout ${MAX_SECONDS}s)..."
echo "  - API: ${API_URL}"
echo "  - Frontend: ${FRONTEND_URL}"
echo "  - RAG: ${RAG_URL}"

wait_for() {
  local name="$1"
  local url="$2"
  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "  - OK: ${name} ($url)"
      return 0
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "  - ERRO: timeout aguardando ${name} ($url)"
      return 1
    fi
    sleep "$SLEEP_SECONDS"
  done
}

wait_for "API ready" "${API_URL}/health/ready"
wait_for "Frontend" "${FRONTEND_URL}/"
wait_for "RAG health" "${RAG_URL}/health"

echo "[wait-ready] Tudo pronto."
