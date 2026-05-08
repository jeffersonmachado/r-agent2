#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "[qa:clean-artifacts] Limpando artefatos efemeros do QA Waves..."

# Remove apenas artefatos gerados em runtime que NAO sao rastreados.
while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  rm -f "$file"
done < <(git ls-files --others --exclude-standard -- 'qa/checkpoints/reports/WAVE-TEST-*.md')

while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  rm -f "$file"
done < <(git ls-files --others --exclude-standard -- 'qa/checkpoints/waves/WAVE-TEST-*.json')

while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  rm -f "$file"
done < <(git ls-files --others --exclude-standard -- 'qa/qa-waves/operational-gaps-report.json')

# Restaura arquivos versionados que sofrem mutacao em execucao local.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git restore \
    qa-mesh/go-no-go-report.json \
    qa-mesh/release-gate-report.json \
    qa/qa-waves/scenario-store.json \
    >/dev/null 2>&1 || true
fi

echo "[qa:clean-artifacts] Limpeza QA Waves concluida."
