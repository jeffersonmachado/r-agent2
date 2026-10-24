#!/usr/bin/env bash
# publication-gate.sh — PORTEIRO ÚNICO de qualquer caminho que PUBLIQUE artefato do RAP.
#
# POR QUE EXISTE (Fase 2 / MISSÃO C)
# ----------------------------------
# O inventário de caminhos capazes de publicar mostrou que `scripts/docker-push.sh` e
# `scripts/docker-push-remote.sh` empurravam imagens para um registry SEM NENHUMA consulta à
# decisão de release: `npm run deploy:push` publicava com a governança em NO_GO, porque o
# bloqueio existente vivia apenas no workflow `.github/workflows/release-governance.yml`.
# Enforcement que só existe no CI não é enforcement: o mesmo comando roda na máquina do operador.
#
# O porteiro exige, nesta ordem:
#   1. AUTORIZAÇÃO EXPLÍCITA (`RAP_PUBLISH_AUTHORIZED=1`) — publicação nunca é consequência de
#      um comando de build;
#   2. DECISÃO CANÔNICA EM GO DEFINITIVO (`scripts/governance/assert-canonical-release-decision.js`,
#      autoridade única: cadeia criptográfica recalculada dos bytes atuais + identidade coerente).
#
# Uso (dentro de scripts que publicam, ANTES de qualquer build/push):
#   . "$(dirname "${BASH_SOURCE[0]}")/governance/publication-gate.sh"   # ajustar o caminho
#   rap_publication_gate "docker-push"
set -euo pipefail

rap_publication_gate() {
  local origem="${1:-publicacao}"
  local raiz
  raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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
