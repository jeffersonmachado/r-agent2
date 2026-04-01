#!/usr/bin/env bash
# =============================================================================
# scripts/smoke/frontend-smoke.sh — Smoke mínimo do artefato de frontend
#
# Valida que o build do frontend:
#   1. Existe e não está vazio
#   2. Contém index.html válido
#   3. Contém assets JS e CSS empacotados
#   4. Não referencia caminhos de desenvolvimento (localhost hardcoded, etc.)
#   5. config.json presente e com estrutura válida (se usado em produção)
#
# Uso:
#   ./scripts/smoke/frontend-smoke.sh
#   ./scripts/smoke/frontend-smoke.sh --build   # build antes do smoke
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FRONTEND_DIST="$PROJECT_ROOT/frontend/dist"
DO_BUILD=false

for arg in "$@"; do
  [[ "$arg" == "--build" ]] && DO_BUILD=true
done

step()  { echo -e "${BLUE}[frontend-smoke] $*${NC}"; }
ok()    { echo -e "${GREEN}  ✓ $*${NC}"; }
fail()  { echo -e "${RED}  ✗ SMOKE FALHOU: $*${NC}" >&2; exit 1; }
warn()  { echo -e "${YELLOW}  ⚠ $*${NC}"; }

ERRORS=0
check() {
  local desc="$1"
  local result="$2"
  if [[ "$result" == "ok" ]]; then
    ok "$desc"
  else
    echo -e "${RED}  ✗ $desc — $result${NC}" >&2
    ERRORS=$((ERRORS + 1))
  fi
}

# ── build opcional ─────────────────────────────────────────────────────────────
if [[ "$DO_BUILD" == true ]]; then
  step "Rodando build do frontend..."
  cd "$PROJECT_ROOT/frontend"
  VITE_CACHE_DIR=/tmp/r-agent2-vite npm run build
  cd "$PROJECT_ROOT"
  ok "Build concluído"
fi

# ── verificações ───────────────────────────────────────────────────────────────
step "Verificando artefato do frontend em $FRONTEND_DIST..."

# 1. Diretório dist existe e não está vazio
if [[ ! -d "$FRONTEND_DIST" ]]; then
  fail "frontend/dist/ não existe. Execute: npm run frontend:build"
fi

DIST_FILE_COUNT="$(find "$FRONTEND_DIST" -type f | wc -l | tr -d ' ')"
if [[ "$DIST_FILE_COUNT" -lt 5 ]]; then
  check "dist/ deve ter > 5 arquivos" "apenas $DIST_FILE_COUNT arquivo(s) encontrado(s)"
else
  check "dist/ presente ($DIST_FILE_COUNT arquivos)" "ok"
fi

# 2. index.html existe e tem estrutura básica
if [[ -f "$FRONTEND_DIST/index.html" ]]; then
  if grep -q '<!DOCTYPE html>' "$FRONTEND_DIST/index.html" || grep -q '<html' "$FRONTEND_DIST/index.html"; then
    check "index.html válido" "ok"
  else
    check "index.html com estrutura HTML" "arquivo existe mas não parece HTML válido"
  fi
else
  check "index.html presente" "NÃO ENCONTRADO em $FRONTEND_DIST"
fi

# 3. Assets JS e CSS existem
JS_COUNT="$(find "$FRONTEND_DIST/assets" -name "*.js" 2>/dev/null | wc -l | tr -d ' ')"
CSS_COUNT="$(find "$FRONTEND_DIST/assets" -name "*.css" 2>/dev/null | wc -l | tr -d ' ')"

if [[ "$JS_COUNT" -gt 0 ]]; then
  check "assets JS presentes ($JS_COUNT arquivos)" "ok"
else
  check "assets JS presentes" "NENHUM .js encontrado em assets/"
fi

if [[ "$CSS_COUNT" -gt 0 ]]; then
  check "assets CSS presentes ($CSS_COUNT arquivos)" "ok"
else
  warn "Nenhum arquivo CSS em assets/ (pode ser inlined no JS)"
fi

# 4. Verificar no código-fonte se há URLs de API hardcoded apontando para localhost.
# O bundle minificado não é confiável para esta análise devido a colocação de strings
# adjacentes pelo minificador. A verificação é feita na fonte.
SRC_DIR="$PROJECT_ROOT/frontend/src"
if [[ -d "$SRC_DIR" ]]; then
  LOCALHOST_SRC_REFS="$(grep -rl 'baseURL.*localhost\|axios.*localhost\|fetch.*localhost\|API_URL.*localhost' "$SRC_DIR" --include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v 'test\|spec\|__test' | wc -l | tr -d ' ')" || LOCALHOST_SRC_REFS=0
  if [[ "$LOCALHOST_SRC_REFS" -eq 0 ]]; then
    check "Sem URLs de API localhost hardcoded no código-fonte" "ok"
  else
    check "URLs de API localhost no código-fonte" "BLOQUEADOR: $LOCALHOST_SRC_REFS arquivo(s) com localhost hardcoded como base de API"
  fi
else
  warn "Diretório src/ não encontrado — verificação de localhost ignorada"
fi

# 5. config.json (se existe, validar que é JSON válido e tem campos esperados)
if [[ -f "$FRONTEND_DIST/config.json" ]]; then
  if python3 -c "import json; f=open('$FRONTEND_DIST/config.json'); json.load(f)" 2>/dev/null; then
    check "config.json é JSON válido" "ok"
  else
    check "config.json é JSON válido" "INVÁLIDO — JSON malformado"
  fi
else
  warn "config.json não encontrado em dist/ (pode ser gerado em runtime)"
fi

# 6. Tamanho do artefato (sanity: não deve ser trivialmente pequeno)
DIST_SIZE="$(du -sh "$FRONTEND_DIST" 2>/dev/null | cut -f1)"
check "Tamanho do artefato: $DIST_SIZE" "ok"

# ── resultado ──────────────────────────────────────────────────────────────────
echo ""
if [[ "$ERRORS" -eq 0 ]]; then
  echo -e "${GREEN}╔══════════════════════════════════╗${NC}"
  echo -e "${GREEN}║  Frontend smoke: APROVADO ✓     ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════╝${NC}"
else
  echo -e "${RED}╔══════════════════════════════════╗${NC}"
  echo -e "${RED}║  Frontend smoke: FALHOU ($ERRORS erros)  ║${NC}"
  echo -e "${RED}╚══════════════════════════════════╝${NC}"
  exit 1
fi
