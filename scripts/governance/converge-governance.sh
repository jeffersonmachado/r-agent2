#!/usr/bin/env bash
# converge-governance.sh — converge o estado canônico de governança para o run
# governado ATUAL (governance/.current-run.json).
#
# Quando usar: após qualquer commit que toque as raízes-fonte do fingerprint
# (api/, scripts/governance/, governance/proof-engine/, qa/contracts etc.) —
# ou seja, após RUN_SOURCE_DRIFT. Sequência canônica:
#
#   1. git commit (worktree limpa — release oficial exige DIRTY_WORKTREE=0)
#   2. node scripts/governance/create-governed-run.js   (congela o fingerprint)
#   3. bash scripts/governance/converge-governance.sh   (este script)
#   4. git commit dos artefatos regenerados
#   5. npm run zip:release
#
# O que este script faz (tudo derivado de evidência real, nada sintético):
#   - regenera artefatos cujo produtor é externo ao fixpoint (jornada crítica,
#     qa-waves enterprise, package-validation do zip de convergência);
#   - re-stampa lineage (runId/sourceFingerprint) nos relatórios governados;
#   - roda o fixpoint persistido 2x (1ª: projeta DEFERRED a partir do DB;
#     2ª: revalida contra os relatórios projetados — fixpoint estável);
#   - avalia o seal-time-gate (esperado: SEAL_PENDING na fase DELIVERED ou
#     SEAL_GO quando 78/78).
set -euo pipefail
cd "$(dirname "$0")/.."

NODE="node --env-file-if-exists=.env"

echo "[converge] 1/7 critical-journey-evidence (v2 — evidência real de handoff)"
$NODE scripts/governance/generate-critical-journey-evidence-v2.js

echo "[converge] 2/7 qa-waves enterprise governance (bridge)"
$NODE tools/system/qa-waves-enterprise-governance-bridge.js >/dev/null

echo "[converge] 3/7 package-validation (zip de convergência, se presente)"
CONV_ZIP="$(ls -t dist/r-agent2-converge-provisional.zip 2>/dev/null | head -1 || true)"
if [[ -n "$CONV_ZIP" ]]; then
  $NODE governance/package-validator.js --zip "$CONV_ZIP" --audited-only
else
  echo "[converge]   (sem zip de convergência — package-validation ficará para o PASS 2.9 do release)"
fi

echo "[converge] 4/7 stamp de lineage"
$NODE scripts/governance/stamp-report-lineage.js >/dev/null

echo "[converge] 5/7 fixpoint (pass 1 — projeção)"
$NODE scripts/governance/run-persisted-scorecard.js >/dev/null

echo "[converge] 6/7 fixpoint (pass 2 — revalidação estável)"
$NODE scripts/governance/run-persisted-scorecard.js

echo "[converge] 7/7 seal-time-gate"
node scripts/governance/seal-time-gate.js
