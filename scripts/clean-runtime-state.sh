#!/usr/bin/env bash

set -euo pipefail

IFS=$'\n\t'

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK_ONLY=false
DRY_RUN=false

step() { echo -e "${BLUE}[runtime-clean] $*${NC}"; }
ok() { echo -e "${GREEN}  ✓ $*${NC}"; }
warn() { echo -e "${YELLOW}  ! $*${NC}"; }
fail() { echo -e "${RED}  x $*${NC}" >&2; exit 1; }

usage() {
  cat <<'EOF'
Uso: bash ./scripts/clean-runtime-state.sh [--check] [--dry-run]

  --check    apenas valida se há resíduos de runtime no workspace
  --dry-run  lista o que seria removido sem apagar nada
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Opção desconhecida: $1" ;;
  esac
done

RUNTIME_DIRS=(
  ".wwebjs_auth"
  ".wwebjs_cache"
  "api/data/wa_sessions"
  "data/executions"
  "frontend/.vite"
  "frontend/test-results"
  "qa/release-evidence"
  "qa-mesh/meshEvidence"
  "qa-mesh/meshHistory"
  "qa-mesh/system-validate"
  "rag-service/data/vector_store"
  "rag-service/test-results"
  "recordings"
  "replays"
  "dist/test-release"
)

RUNTIME_GLOBS=(
  "qa-mesh/isolated-run*"
  "rag-service/.coverage"
  "rag-service/data/adaptive_learning/*_learning.json"
)

found=0
failed=0
FAILED_PATHS=()

is_git_tracked() {
  local rel_path="$1"
  git -C "$ROOT_DIR" ls-files -- "$rel_path" 2>/dev/null | grep -q .
}

remove_path() {
  local abs_path="$1"
  local rel_path="$2"
  local mode_label="$3"

  if [[ "$DRY_RUN" == true || "$CHECK_ONLY" == true ]]; then
    warn "$mode_label: $rel_path"
    return
  fi

  chmod -R u+w "$abs_path" 2>/dev/null || true
  if rm -rf "$abs_path" 2>/dev/null; then
    ok "removido: $rel_path"
    return
  fi

  warn "falha ao remover: $rel_path"
  failed=$((failed + 1))
  FAILED_PATHS+=("$rel_path")
}

step "Inspecionando resíduos operacionais no workspace"

for rel_path in "${RUNTIME_DIRS[@]}"; do
  abs_path="$ROOT_DIR/$rel_path"
  if is_git_tracked "$rel_path"; then
    continue
  fi
  if [[ -d "$abs_path" ]]; then
    if find "$abs_path" -mindepth 1 -print -quit 2>/dev/null | grep -q .; then
      found=$((found + 1))
      remove_path "$abs_path" "$rel_path" "diretório de runtime encontrado"
    fi
  elif [[ -e "$abs_path" ]]; then
    found=$((found + 1))
    remove_path "$abs_path" "$rel_path" "arquivo de runtime encontrado"
  fi
done

shopt -s nullglob
for rel_glob in "${RUNTIME_GLOBS[@]}"; do
  matches=("$ROOT_DIR"/$rel_glob)
  for abs_path in "${matches[@]}"; do
    [[ -e "$abs_path" ]] || continue
    rel_path="${abs_path#$ROOT_DIR/}"
    if is_git_tracked "$rel_path"; then
      continue
    fi
    found=$((found + 1))
    remove_path "$abs_path" "$rel_path" "resíduo de runtime encontrado"
  done
done
shopt -u nullglob

if [[ "$CHECK_ONLY" == true ]]; then
  if [[ "$found" -gt 0 ]]; then
    fail "foram encontrados $found resíduos de runtime. Execute: npm run runtime:clean"
  fi
  ok 'workspace sem resíduos de runtime conhecidos'
  exit 0
fi

if [[ "$DRY_RUN" == true ]]; then
  if [[ "$found" -eq 0 ]]; then
    ok 'nenhum resíduo de runtime encontrado'
  else
    warn "total de resíduos detectados: $found"
  fi
  exit 0
fi

if [[ "$failed" -gt 0 ]]; then
  for rel_path in "${FAILED_PATHS[@]}"; do
    warn "pendente por permissão ou bloqueio: $rel_path"
  done
  fail "limpeza parcial: $failed caminho(s) não puderam ser removidos"
fi

ok "limpeza concluída; resíduos removidos: $found"