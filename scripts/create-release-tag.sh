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
# Exit 0 = tag criada/pushada (ou já existente no mesmo commit).
# Exit 1 = erro real (conflito de tag, commit ausente, falha de push).
# Exit 3 = BLOQUEIO DE POLITICA LOCAL no push da tag (hook pre-push) — ação humana
#          necessária; ver a mensagem acionável na saída.
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

# ── VÍNCULO ENTRE A DECISÃO E O COMMIT TAGUEADO (Fase 3, achado 4 da revisão) ──
# `assert-canonical-release-decision` valida a árvore de trabalho; sem esta checagem qualquer sha
# local passava a receber uma tag de "release", usando um GO de outro conteúdo. Quando existe run
# governado corrente, o commit tagueado tem de ser o MESMO que ele selou.
CURRENT_RUN="$REPO_ROOT/governance/.current-run.json"
if [[ -f "$CURRENT_RUN" ]]; then
  RUN_COMMIT="$(node -pe "try{JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).sourceCommit||''}catch(_){''}" "$CURRENT_RUN" 2>/dev/null || true)"
  if [[ -n "$RUN_COMMIT" && "$RUN_COMMIT" != "$COMMIT" ]]; then
    echo "[release-tag] ERRO: commit $COMMIT != sourceCommit do run governado ($RUN_COMMIT)" >&2
    echo "[release-tag] A decisão canônica vale para o commit que ela selou — não para outro conteúdo." >&2
    exit 1
  fi
fi

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

# ── Porteiro de publicação (Fase 2, achado 1 da revisão independente) ─────────
# O PUSH da tag de release é PUBLICAÇÃO e passa SEMPRE pelo porteiro. Na Fase 2 existia uma
# dispensa por "remote local", classificada por `git remote get-url`; a Fase 3 demonstrou que isso
# é contornável (`remote.*.pushurl` externo com fetch local, e `url.*.pushInsteadOf` reescrevendo
# o destino) — a dispensa por string foi REMOVIDA. A única exceção é o modo local de teste
# explícito (`RAP_RELEASE_TAG_LOCAL_REMOTE_ALLOW`), que não vale em CI/produção, recusa qualquer
# regra de reescrita e exige que TODOS os destinos de push sejam exatamente o caminho autorizado.
# shellcheck source=/dev/null
. "$SCRIPT_DIR/governance/publication-gate.sh"
rap_publication_gate "create-release-tag:$TAG" "$REMOTE"

# ALVO DO PUSH: quando o porteiro liberou o modo local de teste, ele exportou o CAMINHO validado
# (realpath, sem symlink). Empurrar para o caminho — e não para o nome do remote — elimina a classe
# `remote.*.receivepack`/`pushurl` (o nome pode apontar para outro lugar; o caminho validado, não).
PUSH_TARGET="${RAP_PUBLICATION_LOCAL_TARGET:-$REMOTE}"

PUSH_LOG="$(mktemp)"
PUSH_RC=0
if ! git push "$PUSH_TARGET" "refs/tags/$TAG" >"$PUSH_LOG" 2>&1; then
  PUSH_RC=$?
  cat "$PUSH_LOG" >&2
  # BLOQUEIO DE POLÍTICA ≠ ERRO. MEDIDO (2026-10-13): neste repositório existe um
  # hook local `.git/hooks/pre-push` que recusa `refs/tags/*`
  # ("[guard-local] push de TAG bloqueado … autorizado apenas push de commits"),
  # coerente com o AGENTS.md (a tag é criada FORA do pipeline; o push dela é ação
  # HUMANA). Sem esta distinção o ciclo de release abortava com "criação da tag
  # falhou" — uma mensagem que manda o operador procurar defeito de rede ou de
  # permissão quando o que falta é uma decisão dele.
  if grep -qE 'guard-local|push de TAG bloqueado|pre-push|refs/tags' "$PUSH_LOG"; then
    echo "" >&2
    echo "[release-tag] BLOQUEIO DE POLITICA LOCAL — NAO e erro de rede nem de permissao." >&2
    echo "[release-tag] O hook .git/hooks/pre-push deste clone recusa push de refs/tags/*." >&2
    echo "[release-tag] A tag '$TAG' JA EXISTE localmente apontando para $COMMIT." >&2
    echo "[release-tag] Publicacao da tag e ACAO HUMANA — com autorizacao explicita, rode:" >&2
    echo "[release-tag]   git push --no-verify $REMOTE refs/tags/$TAG" >&2
    echo "[release-tag] e retome o ciclo com:" >&2
    echo "[release-tag]   bash scripts/governance/seal-release.sh --from publish" >&2
    rm -f "$PUSH_LOG"
    exit 3
  fi
  rm -f "$PUSH_LOG"
  echo "[release-tag] ERRO: push da tag falhou (exit $PUSH_RC) — ver a saida do git acima" >&2
  exit 1
fi
rm -f "$PUSH_LOG"
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
done < <(git ls-remote "$PUSH_TARGET" "refs/tags/$TAG" "refs/tags/$TAG^{}")

if [[ "$VERIFY_TARGET" != "$COMMIT" ]]; then
  echo "[release-tag] ERRO pós-push: remote reporta target='$VERIFY_TARGET' (esperado $COMMIT)" >&2
  exit 1
fi

echo "[release-tag] OK: tag $TAG -> $COMMIT verificada no remote $REMOTE"
