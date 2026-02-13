#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ensure_api_base_image() {
  local base_image="r-agent2-api-base:test"
  local rebuild_base="${STACK_REBUILD_API_BASE:-0}"

  if [[ "$rebuild_base" == "1" ]]; then
    echo "[stack-up] STACK_REBUILD_API_BASE=1 -> rebuild da base ${base_image}"
  elif docker image inspect "$base_image" >/dev/null 2>&1; then
    echo "[stack-up] Base ${base_image} encontrada (reutilizando)"
    return 0
  else
    echo "[stack-up] Base ${base_image} não encontrada -> build inicial"
  fi

  docker build -f ./api/Dockerfile.base -t "$base_image" .
}

echo "[stack-up] Subindo stack de teste (docker-compose.test.yml)..."
ensure_api_base_image

if [[ "${STACK_NO_BUILD:-}" == "1" ]]; then
  echo "[stack-up] STACK_NO_BUILD=1 → usando imagens locais (sem build)"
  docker compose -f docker-compose.test.yml up -d --no-build
else
  docker compose -f docker-compose.test.yml up -d --build
fi

echo "[stack-up] OK"
