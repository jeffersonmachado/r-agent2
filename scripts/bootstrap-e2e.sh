#!/usr/bin/env bash

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
E2E_DIR="$PROJECT_ROOT/frontend-e2e"

step() { echo -e "${BLUE}[bootstrap-e2e] $*${NC}"; }
ok() { echo -e "${GREEN}  ✓ $*${NC}"; }
fail() { echo -e "${RED}  ✗ $*${NC}" >&2; exit 1; }

[[ -d "$E2E_DIR" ]] || fail "Pacote frontend-e2e nao encontrado em $E2E_DIR"

step "Instalando dependencias E2E isoladas (Cypress)..."
npm --prefix "$E2E_DIR" ci --no-audit --no-fund
ok "Dependencias E2E instaladas"

step "Validando Cypress..."
npm --prefix "$E2E_DIR" run test:e2e -- --version >/dev/null 2>&1 || fail "Cypress indisponivel apos instalacao"
ok "Cypress validado"

echo -e "${GREEN}Bootstrap E2E concluido${NC}"
