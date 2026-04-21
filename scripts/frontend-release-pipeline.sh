#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

step() { echo -e "${BLUE}[frontend-pipeline] $*${NC}"; }
ok() { echo -e "${GREEN}  ✓ $*${NC}"; }
fail() { echo -e "${RED}  ✗ $*${NC}" >&2; exit 1; }

step "Instalando dependências do frontend"
(cd "$PROJECT_ROOT" && npm run frontend:install)
ok "Dependências instaladas"

step "Gerando build do frontend"
(cd "$PROJECT_ROOT" && npm run frontend:build)
ok "Build concluído"

step "Validando preview do frontend"
PREVIEW_LOG="$(mktemp)"
PREVIEW_PID=""
cleanup() {
  if [[ -n "$PREVIEW_PID" ]]; then
    kill "$PREVIEW_PID" >/dev/null 2>&1 || true
    wait "$PREVIEW_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$PREVIEW_LOG"
}
trap cleanup EXIT

(
  cd "$PROJECT_ROOT/frontend"
  npm run preview -- --host 127.0.0.1 --port 4173
) >"$PREVIEW_LOG" 2>&1 &
PREVIEW_PID=$!

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:4173" >/dev/null 2>&1; then
    ok "Preview respondeu em http://127.0.0.1:4173"
    break
  fi
  sleep 1
  if ! kill -0 "$PREVIEW_PID" >/dev/null 2>&1; then
    cat "$PREVIEW_LOG" >&2 || true
    fail "Preview encerrou antes de responder"
  fi
  if [[ $_ -eq 30 ]]; then
    cat "$PREVIEW_LOG" >&2 || true
    fail "Timeout aguardando preview do frontend"
  fi
done

kill "$PREVIEW_PID" >/dev/null 2>&1 || true
wait "$PREVIEW_PID" >/dev/null 2>&1 || true
PREVIEW_PID=""
ok "Preview validado"

step "Executando smoke do frontend"
(cd "$PROJECT_ROOT" && npm run frontend:smoke)
ok "Smoke do frontend aprovado"

step "Pipeline frontend concluído"
ok "Build + Preview + Smoke aprovados"
