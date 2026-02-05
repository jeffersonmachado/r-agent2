#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[stack-up] Subindo stack de teste (docker-compose.test.yml)..."
if [[ "${STACK_NO_BUILD:-}" == "1" ]]; then
  echo "[stack-up] STACK_NO_BUILD=1 → usando imagens locais (sem build)"
  docker compose -f docker-compose.test.yml up -d --no-build
else
  docker compose -f docker-compose.test.yml up -d --build
fi

echo "[stack-up] OK"

