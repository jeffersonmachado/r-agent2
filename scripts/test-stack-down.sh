#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[stack-down] Derrubando stack de teste (com volumes)..."
docker compose -f docker-compose.test.yml down -v

echo "[stack-down] OK"

