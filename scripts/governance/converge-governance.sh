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
#   - regenera a projeção de readiness (produtor externo ao fixpoint) para que
#     ela carregue o runId CORRENTE — sem isso `dev/platform-readiness/latest.json`
#     fica com lineage estrangeiro e o contamination cleaner derruba o run
#     (FOREIGN_RUN_ARTIFACT em arquivo de decisão);
#   - REGERA a evidência executável com validade temporal (maxAgeMs=7d no
#     registry): master-scorecard test/regression, reports de domínio e o
#     relatório de persistência. O stamp NÃO pode refrescar generatedAt (seria
#     freshness fabricada) — só o produtor real, rodando as suítes Jest, pode.
#     Sem este passo, os relatórios cruzam 168h e o fixpoint derruba as 78
#     dimensões para 5 (ARTIFACT_EXPIRED em TESTED/REGRESSION_PROTECTED);
#   - re-stampa lineage (runId/sourceFingerprint) nos relatórios governados.
#     ORDEM OBRIGATÓRIA: o stamp roda DEPOIS da evidência temporal, porque as
#     suítes Jest executadas pelos geradores reescrevem relatórios governados
#     SEM lineage como efeito colateral real (coverage-gate-report,
#     coverage-completeness-report, model-driven-e2e-report) — stamp antes do
#     Jest é clobberado e o fixpoint reprova com ARTIFACT_RUN_ID_MISSING /
#     ARTIFACT_SOURCE_FINGERPRINT_MISSING (falha real de 2026-09-15);
#   - roda o fixpoint persistido 2x (1ª: projeta DEFERRED a partir do DB;
#     2ª: revalida contra os relatórios projetados — fixpoint estável);
#   - avalia o seal-time-gate (esperado: SEAL_PENDING na fase DELIVERED ou
#     SEAL_GO quando 78/78).
set -euo pipefail
cd "$(dirname "$0")/../.."

NODE="node --env-file-if-exists=.env"

echo "[converge] 1/9 critical-journey-evidence (v2 — evidência real de handoff)"
$NODE scripts/governance/generate-critical-journey-evidence-v2.js

echo "[converge] 2/9 qa-waves enterprise governance (bridge)"
$NODE tools/system/qa-waves-enterprise-governance-bridge.js >/dev/null

echo "[converge] 3/9 package-validation (zip de convergência, se presente)"
CONV_ZIP="$(ls -t dist/r-agent2-converge-provisional.zip 2>/dev/null | head -1 || true)"
if [[ -n "$CONV_ZIP" ]]; then
  $NODE governance/package-validator.js --zip "$CONV_ZIP" --audited-only
else
  # Nenhum ZIP NESTE ciclo ainda. Se NÃO existe pacote algum no disco, o estado
  # honesto da fase é DEFERRED (o pacote ainda não foi construído) — rodar o
  # validator sem --zip faz ele resolver o artefato mais recente e reportar
  # DEFERRED/PRE_PACKAGE. Sem este passo, o relatório fica apontando para o
  # payload do release ANTERIOR (que já não existe em dist/) e o scorecard passa
  # a contar RAP-052/RAP-054 como FALHA REAL — foi assim que o `release:seal`
  # travava na fase prepare com `dist/` zerado (PACKAGE_VALIDATION_NOT_PASS +
  # MASTER_SCORECARD_NOT_10_OF_10 em [RAP-052,RAP-054]).
  if compgen -G "dist/release/*.payload.zip" > /dev/null || compgen -G "dist/r-agent2-*.zip" > /dev/null; then
    echo "[converge]   (pacote presente em dist/ — package-validation fica para o PASS 2.9 do release)"
  else
    echo "[converge]   (nenhum pacote em dist/ — gravando package-validation DEFERRED honesta)"
    $NODE governance/package-validator.js >/dev/null 2>&1 || true
  fi
fi

echo "[converge] 4/9 readiness projection (lineage do run corrente)"
# O exit code deste produtor ESPELHA A DECISÃO (1 quando a decisão não é GO),
# não uma falha de execução. A avaliação da decisão é feita pelo fixpoint
# (passos 7-8); aqui o objetivo é apenas regerar a projeção com o lineage do run
# corrente. Sob `set -e` o abort seria um falso bloqueio.
$NODE tools/system/platform-readiness.js >/dev/null || true

echo "[converge] 5/9 evidência executável com validade temporal (test/regression + domínios + persistência)"
# Produtores reais (rodam as suítes Jest e gravam o exit code): únicos que
# podem refrescar generatedAt sem fabricar freshness. Se uma suíte falhar, o
# report sai FAIL e o fixpoint/seal-time-gate reprovam — comportamento honesto
# desejado (set -e aborta aqui de propósito). ATENÇÃO: estas suítes reescrevem
# relatórios governados sem lineage (coverage/model-driven) — por isso o stamp
# é o passo SEGUINTE, nunca o anterior.
$NODE scripts/governance/generate-policy-evidence.js
$NODE scripts/governance/generate-domain-evidence.js >/dev/null
$NODE scripts/governance/generate-persistence-evidence.js >/dev/null

echo "[converge] 6/9 stamp de lineage"
$NODE scripts/governance/stamp-report-lineage.js >/dev/null

echo "[converge] 7/9 fixpoint (pass 1 — projeção)"
$NODE scripts/governance/run-persisted-scorecard.js >/dev/null

echo "[converge] 8/9 fixpoint (pass 2 — revalidação estável)"
$NODE scripts/governance/run-persisted-scorecard.js

echo "[converge] 9/9 seal-time-gate"
node scripts/governance/seal-time-gate.js
