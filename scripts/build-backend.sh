#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

step() { echo -e "${BLUE}[build-backend] $*${NC}"; }
ok() { echo -e "${GREEN}  ✓ $*${NC}"; }
fail() { echo -e "${RED}  ✗ $*${NC}" >&2; exit 1; }

step "Validando sintaxe dos arquivos JS do backend"
mapfile -t JS_FILES < <(cd "$PROJECT_ROOT" && rg --files api engine core lib tools | rg '\.js$' | rg -v '\.examples\.js$')
if [[ ${#JS_FILES[@]} -eq 0 ]]; then
  fail "Nenhum arquivo JS encontrado para validação"
fi
for f in "${JS_FILES[@]}"; do
  node --check "$PROJECT_ROOT/$f" >/dev/null
 done
ok "Sintaxe JS válida (${#JS_FILES[@]} arquivos)"

step "Smoke de carregamento do servidor"
timeout 20s node -e "require('./api/server'); console.log('server-load-ok'); process.exit(0);" >/tmp/ragent2-build-backend.log 2>&1 || {
  cat /tmp/ragent2-build-backend.log >&2 || true
  fail "Falha ao carregar api/server.js"
}
ok "Servidor carregado com sucesso"

step "Build backend concluído"
ok "Backend validado"
