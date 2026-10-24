#!/usr/bin/env bash
# publication-gate.sh — PORTEIRO ÚNICO de qualquer caminho que PUBLIQUE artefato do RAP.
#
# POR QUE EXISTE (Fase 2 / MISSÃO C)
# ----------------------------------
# O inventário de caminhos capazes de publicar mostrou que `scripts/docker-push.sh` e
# `scripts/docker-push-remote.sh` empurravam imagens para um registry SEM NENHUMA consulta à
# decisão de release, e que `scripts/create-release-tag.sh` empurrava TAG para o remote sem gate.
#
# FASE 3 — POR QUE A CLASSIFICAÇÃO POR URL FOI ABANDONADA (missão A)
# -----------------------------------------------------------------
# A versão da Fase 2 dispensava o gate quando a URL "parecia local"
# (`git remote get-url <remote>` batendo em caminho de filesystem). Isso é heurística de string e
# foi contornado com configuração Git legítima, medido em 2026-10-24 num repositório descartável:
#
#   1. `remote.origin.pushurl = git@example.invalid:org/repo.git` com fetch URL local:
#      `git remote get-url origin` devolvia o caminho local (gate dispensado) enquanto o
#      `git push` ia para o host EXTERNO (comprovado com `git push --dry-run`, que tentou ssh);
#   2. `url.<destino>.pushInsteadOf <origem>` faz `get-url --push` devolver o destino reescrito —
#      a URL observada não é a URL usada pelo transporte.
#
# Regra nova (capacidade + intenção explícita, nunca heurística de string):
#   - o DEFAULT é SEMPRE exigir o gate (autorização explícita + decisão canônica em GO definitivo);
#   - a ÚNICA dispensa é o modo de teste declarado (`rap_publication_gate_local_test`), que:
#       * exige `RAP_RELEASE_TAG_LOCAL_REMOTE_ALLOW` (caminho absoluto) — intenção explícita;
#       * recusa em `CI=true` e em `NODE_ENV=production` — impossível de ativar em silêncio;
#       * recusa quando existe QUALQUER regra de reescrita `url.*.insteadOf`/`pushInsteadOf`;
#       * exige que TODOS os destinos de push configurados sejam exatamente o caminho autorizado;
#       * registra os destinos resolvidos (auditável).
#   Para sair da máquina seria preciso um destino externo configurado, que nunca é igual ao
#   caminho autorizado — e reescrever a URL é recusado antes da comparação.
#
# Uso (dentro de scripts que publicam, ANTES de qualquer build/push):
#   . "$(dirname "${BASH_SOURCE[0]}")/governance/publication-gate.sh"
#   rap_publication_gate "docker-push"
#   rap_publication_gate "create-release-tag" "$REMOTE"
set -euo pipefail

rap_raiz_do_repo() {
  (cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
}

# AMBIENTE GIT REDIRECIONADO (Fase 3): `GIT_DIR`/`GIT_WORK_TREE` mudam QUAL repositório o comando
# enxerga — o porteiro leria a configuração de outro repo e o push sairia por um remote que ele nunca
# validou. Injeção por `GIT_CONFIG_COUNT>0` (com KEY/VALUE) faz o mesmo por outro caminho. `COUNT=0`
# é permitido: é a forma canônica de DESCARTAR injeção do processo pai.
rap_ambiente_git_redirecionado() {
  if [[ -n "${GIT_DIR:-}" || -n "${GIT_WORK_TREE:-}" ]]; then
    echo "[publication-gate] RECUSADO: GIT_DIR/GIT_WORK_TREE definidos — o repositório avaliado nao" >&2
    echo "[publication-gate] e necessariamente o repositorio do push." >&2
    return 0
  fi
  if [[ -n "${GIT_CONFIG_COUNT:-}" && "${GIT_CONFIG_COUNT}" != "0" ]]; then
    echo "[publication-gate] RECUSADO: GIT_CONFIG_COUNT=${GIT_CONFIG_COUNT} injeta configuracao de git" >&2
    echo "[publication-gate] (url.*.pushInsteadOf, remote.*.pushurl) fora do arquivo de configuracao." >&2
    return 0
  fi
  return 1
}

# Todos os destinos de PUSH configurados para o remote (pushurl múltiplo incluído).
# Não é prova de segurança: é o que se AUDITA e o que o modo de teste confere item a item.
rap_destinos_de_push() {
  local remote="$1"
  git remote get-url --push --all "$remote" 2>/dev/null || true
}

# Existe regra de reescrita de URL no repositório corrente? (invalida qualquer prova por string)
rap_ha_reescrita_de_url() {
  git config --get-regexp '^url\..*\.(insteadof|pushinsteadof)$' >/dev/null 2>&1
}

# Dispensa de TESTE, restrita ao filesystem e impossível em produção/CI.
rap_publication_gate_local_test() {
  local origem="${1:-publicacao}"
  local remote="${2:-}"
  local permitido="${RAP_RELEASE_TAG_LOCAL_REMOTE_ALLOW:-}"

  if [[ -z "$permitido" ]]; then
    return 1
  fi
  if [[ "${CI:-}" == "true" || "${NODE_ENV:-}" == "production" ]]; then
    echo "[publication-gate] RECUSADO (${origem}): modo local de teste não vale em CI/produção." >&2
    return 1
  fi
  if rap_ha_reescrita_de_url; then
    echo "[publication-gate] RECUSADO (${origem}): existe regra url.*.insteadOf/pushInsteadOf — a URL" >&2
    echo "[publication-gate] observada não é necessariamente a URL usada pelo transporte." >&2
    return 1
  fi
  if [[ -z "$remote" ]]; then
    echo "[publication-gate] RECUSADO (${origem}): modo local de teste exige o remote explícito." >&2
    return 1
  fi

  local destinos
  destinos="$(rap_destinos_de_push "$remote")"
  if [[ -z "$destinos" ]]; then
    echo "[publication-gate] RECUSADO (${origem}): remote '$remote' sem destino de push resolvível." >&2
    return 1
  fi

  local destino
  while IFS= read -r destino; do
    [[ -z "$destino" ]] && continue
    if [[ "$destino" != "$permitido" ]]; then
      echo "[publication-gate] RECUSADO (${origem}): destino de push '$destino' != autorizado '$permitido'." >&2
      return 1
    fi
    case "$destino" in
      /*|./*|../*) : ;;
      *)
        echo "[publication-gate] RECUSADO (${origem}): destino '$destino' não é caminho de filesystem." >&2
        return 1
        ;;
    esac
  done <<< "$destinos"

  echo "[publication-gate] MODO LOCAL DE TESTE (${origem}): destinos de push autorizados => $(printf '%s' "$destinos" | tr '\n' ' ')"
  return 0
}

rap_publication_gate() {
  local origem="${1:-publicacao}"
  local remote="${2:-}"
  local raiz
  raiz="$(rap_raiz_do_repo)"

  if rap_ambiente_git_redirecionado; then
    exit 1
  fi

  if rap_publication_gate_local_test "$origem" "$remote"; then
    return 0
  fi

  if [[ "${RAP_PUBLISH_AUTHORIZED:-}" != "1" ]]; then
    echo "[publication-gate] BLOQUEADO (${origem}): RAP_PUBLISH_AUTHORIZED diferente de 1." >&2
    echo "[publication-gate] Publicação exige autorização explícita — build não publica." >&2
    exit 1
  fi

  local decisao
  if ! decisao="$(cd "$raiz" && node scripts/governance/assert-canonical-release-decision.js --json 2>&1)"; then
    echo "[publication-gate] BLOQUEADO (${origem}): a decisão canônica de release não é GO definitivo." >&2
    printf '%s\n' "$decisao" | tail -n 20 >&2
    exit 1
  fi

  echo "[publication-gate] GO definitivo verificado — ${origem} liberada"
}
