#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DIR_TARGETS=(
  "frontend-e2e/playwright-report"
  "frontend-e2e/test-results"
  "playwright-report"
  "test-results"
  "qa/workspace-core/evidence"
  "rpa/traces"
  "rpa/screenshots"
  "rpa/replay"
  "coverage"
  "tmp"
  "temp"
  ".cache"
  "dist-test"
  "artifacts"
)

echo "[clean-test-artifacts] Limpando diretorios de artefatos..."
for rel in "${DIR_TARGETS[@]}"; do
  abs="$PROJECT_ROOT/$rel"
  if [[ -e "$abs" ]]; then
    rm -rf "$abs"
    echo "  - removido: $rel"
  fi
done

echo "[clean-test-artifacts] Limpando screenshots/traces/videos residuais..."
# training/ é preservado — contém material de treinamento de usuários
find "$PROJECT_ROOT" \
  \( -path "$PROJECT_ROOT/.git" -o -path "$PROJECT_ROOT/node_modules" -o -path "$PROJECT_ROOT/frontend-e2e/node_modules" -o -path "$PROJECT_ROOT/training" \) -prune \
  -o -type d \( -name screenshots -o -name traces -o -name videos \) -print0 \
  | while IFS= read -r -d '' dir; do
      rm -rf "$dir"
      echo "  - removido: ${dir#"$PROJECT_ROOT/"}"
    done

echo "[clean-test-artifacts] Limpando arquivos *.trace.zip, *.webm, *.har..."
find "$PROJECT_ROOT" \
  \( -path "$PROJECT_ROOT/.git" -o -path "$PROJECT_ROOT/node_modules" -o -path "$PROJECT_ROOT/frontend-e2e/node_modules" -o -path "$PROJECT_ROOT/training" \) -prune \
  -o -type f \( -name '*.trace.zip' -o -name '*.webm' -o -name '*.har' \) -print0 \
  | while IFS= read -r -d '' file; do
      rm -f "$file"
      echo "  - removido: ${file#"$PROJECT_ROOT/"}"
    done

echo "[clean-test-artifacts] Limpeza concluida."
