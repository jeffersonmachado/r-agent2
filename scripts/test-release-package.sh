#!/usr/bin/env bash

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_DIST="$PROJECT_ROOT/dist/test-release"
ZIP_NAME="release-test.zip"
ZIP_PATH="$TEST_DIST/$ZIP_NAME"

step() { echo -e "${BLUE}[test-release-package] $*${NC}"; }
ok() { echo -e "${GREEN}  ✓ $*${NC}"; }
fail() { echo -e "${RED}  ✗ $*${NC}" >&2; exit 1; }

for cmd in unzip grep; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Comando obrigatorio ausente: $cmd"
done

mkdir -p "$TEST_DIST"
rm -f "$ZIP_PATH"

step "Gerando ZIP oficial para teste..."
"$PROJECT_ROOT/scripts/generate-zip.sh" --output-dir "$TEST_DIST" --name "$ZIP_NAME" >/tmp/r-agent2-release-test.log
[[ -f "$ZIP_PATH" ]] || fail "ZIP de teste nao foi gerado"
ok "ZIP gerado: $ZIP_PATH"

step "Lendo conteudo do ZIP..."
ZIP_CONTENTS="$(unzip -Z1 "$ZIP_PATH")"

FORBIDDEN_PATTERNS=(
  '(^|/)node_modules/'
  '(^|/)\.env$'
  '(^|/)\.env\..+$'
  '\.env\.production$'
  '(^|/)coverage/'
  '(^|/)frontend-e2e/playwright-report/'
  '(^|/)frontend-e2e/test-results/'
  '(^|/)playwright-report/'
  '(^|/)test-results/'
  '(^|/)qa/workspace-core/evidence/'
  '(^|/)rpa/traces/'
  '(^|/)rpa/screenshots/'
  '(^|/)rpa/replay/'
  '\.trace\.zip$'
  '\.webm$'
  '\.har$'
  '(^|/)artifacts/'
  '(^|/)logs/'
  '(^|/)tmp/'
  '(^|/)temp/'
  '(^|/)\.cache/'
  '(^|/)dist-test/'
  '(^|/)frontend/\.vite/'
  '(^|/)tmp_'
  '(^|/)\.token\.env$'
  '(^|/)\.wwebjs_auth/'
  '(^|/)\.wwebjs_cache/'
  '(^|/)api/data/wa_sessions/'
  '(^|/)rag-service/\.coverage$'
  '(^|/)rag-service/data/vector_store/'
  '(^|/)rag-service/data/adaptive_learning/'
  '(^|/)qa-mesh/isolated-run[^/]*?/'
)

REQUIRED_PATTERNS=(
  '/package.json$'
  '/scripts/bootstrap\.sh$'
  '/scripts/release-package\.sh$'
  '/api/server\.js$'
  '/frontend/package\.json$'
  '/env\.example$'
)

step "Validando ausencia de padroes proibidos..."
for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  matches="$(printf '%s\n' "$ZIP_CONTENTS" | grep -E "$pattern" || true)"
  if [[ -n "$matches" ]]; then
    echo "$matches" | head -20 >&2
    fail "Conteudo proibido encontrado para padrao: $pattern"
  fi
done
ok "Sem conteudo proibido"

step "Validando presenca de itens minimos esperados..."
for pattern in "${REQUIRED_PATTERNS[@]}"; do
  if ! grep -Eq "$pattern" <<<"$ZIP_CONTENTS"; then
    fail "Item obrigatorio ausente no pacote (regex): $pattern"
  fi
done
ok "Itens minimos presentes"

echo -e "${GREEN}Release package test: APROVADO${NC}"
