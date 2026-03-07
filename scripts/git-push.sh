#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[erro] diretório atual não é um repositório git."
  exit 1
fi

REMOTE="${1:-origin}"
BRANCH="${2:-$(git rev-parse --abbrev-ref HEAD)}"
PUSH_MODE="${3:-}"

if [[ "$BRANCH" == "HEAD" ]]; then
  echo "[erro] HEAD destacado (detached). Informe a branch explicitamente:"
  echo "  scripts/git-push.sh origin <branch>"
  exit 2
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "[erro] remote '$REMOTE' não existe."
  exit 3
fi

EXTRA_ARGS=()
if [[ "$PUSH_MODE" == "--force-with-lease" ]]; then
  EXTRA_ARGS+=("--force-with-lease")
elif [[ -n "$PUSH_MODE" ]]; then
  echo "[erro] terceiro argumento inválido: $PUSH_MODE"
  echo "Use vazio ou --force-with-lease."
  exit 4
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  echo "[info] branch atual: $CURRENT_BRANCH (push será feito de $BRANCH)"
fi

echo "[info] executando: git push ${EXTRA_ARGS[*]:-} -u $REMOTE $BRANCH"
git push "${EXTRA_ARGS[@]}" -u "$REMOTE" "$BRANCH"
echo "[ok] push concluído para $REMOTE/$BRANCH"

