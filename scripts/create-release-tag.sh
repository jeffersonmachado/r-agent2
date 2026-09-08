#!/usr/bin/env bash
# create-release-tag.sh — tag ANOTADA e imutável de release.
#
# Uso: scripts/create-release-tag.sh <tag> [commit]
#   commit default: git_commit do dist/release/*.manifest.json mais recente.
#
# Regras:
#   - A tag é criada ANOTADA apontando EXATAMENTE para o commit do release.
#   - Se a tag já existe (local ou remoto) apontando para commit DIFERENTE →
#     exit 1 com RELEASE_TAG_CONFLICT (tags de release são imutáveis).
#   - Se já existe apontando para o MESMO commit → idempotente: sucesso sem
#     recriar (push apenas se o remote ainda não a tiver).
#   - Push NUNCA usa --force (non-fast-forward é recusado pelo próprio git).
#   - Pós-push: `git ls-remote` deve confirmar target == commit → senão exit 1.
#
# Exit 0 = tag criada/pushada (ou já existente no mesmo commit); Exit 1 = erro.
set -euo pipefail

TAG="${1:-}"
COMMIT="${2:-}"
REMOTE="${RAP_RELEASE_TAG_REMOTE:-origin}"

if [[ -z "$TAG" ]]; then
  echo "Uso: scripts/create-release-tag.sh <tag> [commit]" >&2
  exit 1
fi

# Repositório alvo: o worktree git do diretório corrente (permite testar com
# repo temporário); fallback para a raiz do projeto (dois níveis acima).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PROJECT_ROOT")"

# Commit default: manifest de release mais recente.
if [[ -z "$COMMIT" ]]; then
  LATEST_MANIFEST="$(ls -1t "$REPO_ROOT"/dist/release/*.manifest.json 2>/dev/null | head -n 1 || true)"
  if [[ -z "$LATEST_MANIFEST" ]]; then
    echo "[release-tag] ERRO: commit não informado e nenhum dist/release/*.manifest.json encontrado" >&2
    exit 1
  fi
  COMMIT="$(node -pe "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).git_commit || ''" "$LATEST_MANIFEST")"
  echo "[release-tag] commit resolvido do manifest $(basename "$LATEST_MANIFEST"): $COMMIT"
fi

if ! [[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[release-tag] ERRO: commit malformado (esperado sha 40-hex): '$COMMIT'" >&2
  exit 1
fi

cd "$REPO_ROOT"

# O commit precisa existir localmente.
git cat-file -e "$COMMIT^{commit}" 2>/dev/null || {
  echo "[release-tag] ERRO: commit $COMMIT não existe localmente — fetch antes de taguear" >&2
  exit 1
}

# ── Conflito local: tag existente apontando para outro commit ────────────────
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  LOCAL_TARGET="$(git rev-parse "$TAG^{}")"
  if [[ "$LOCAL_TARGET" != "$COMMIT" ]]; then
    echo "[release-tag] RELEASE_TAG_CONFLICT — tag local $TAG aponta para $LOCAL_TARGET != $COMMIT (tags de release são imutáveis)" >&2
    exit 1
  fi
fi

# ── Conflito remoto / idempotência ───────────────────────────────────────────
REMOTE_TARGET=""
while read -r sha ref; do
  [[ -z "${sha:-}" ]] && continue
  if [[ "$ref" == "refs/tags/$TAG^{}" ]]; then
    REMOTE_TARGET="$sha"   # deref de tag anotada: prioridade sobre o objeto tag
  elif [[ "$ref" == "refs/tags/$TAG" && -z "$REMOTE_TARGET" ]]; then
    REMOTE_TARGET="$sha"
  fi
done < <(git ls-remote "$REMOTE" "refs/tags/$TAG" "refs/tags/$TAG^{}")

if [[ -n "$REMOTE_TARGET" ]]; then
  if [[ "$REMOTE_TARGET" != "$COMMIT" ]]; then
    echo "[release-tag] RELEASE_TAG_CONFLICT — tag remota $TAG aponta para $REMOTE_TARGET != $COMMIT (tags de release são imutáveis)" >&2
    exit 1
  fi
  echo "[release-tag] OK (idempotente): tag $TAG já existe no remote apontando para $COMMIT — nada a fazer"
  exit 0
fi

# ── Criar tag anotada (se ainda não existir localmente) e push ───────────────
if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  git tag -a "$TAG" "$COMMIT" -m "RAP release $TAG — source commit $COMMIT"
  echo "[release-tag] tag anotada $TAG criada em $COMMIT"
fi

git push "$REMOTE" "refs/tags/$TAG"
echo "[release-tag] push $REMOTE refs/tags/$TAG concluído"

# ── Verificação pós-push ─────────────────────────────────────────────────────
VERIFY_TARGET=""
while read -r sha ref; do
  [[ -z "${sha:-}" ]] && continue
  if [[ "$ref" == "refs/tags/$TAG^{}" ]]; then
    VERIFY_TARGET="$sha"
  elif [[ "$ref" == "refs/tags/$TAG" && -z "$VERIFY_TARGET" ]]; then
    VERIFY_TARGET="$sha"
  fi
done < <(git ls-remote "$REMOTE" "refs/tags/$TAG" "refs/tags/$TAG^{}")

if [[ "$VERIFY_TARGET" != "$COMMIT" ]]; then
  echo "[release-tag] ERRO pós-push: remote reporta target='$VERIFY_TARGET' (esperado $COMMIT)" >&2
  exit 1
fi

echo "[release-tag] OK: tag $TAG -> $COMMIT verificada no remote $REMOTE"
