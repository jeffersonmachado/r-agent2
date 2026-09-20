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
# PRÉ-REQUISITO DE RUNTIME (2026-09-20): a evidência RUNTIME_EVIDENCE
# (qa-mesh/* e qa/enterprise/*) só é prova do run se EXECUTAR dentro dele —
# este script precisa de uma API viva em TEST_BASE_URL (default
# http://localhost:3001) com as credenciais TEST_USERNAME/TEST_PASSWORD.
#
# O que este script faz (tudo derivado de evidência real, nada sintético):
#   - executa o enterprise proof smoke DENTRO do run (artefatos
#     qa/enterprise/{human-handoff,pbx-voice-flow,omnichannel-unified-replay}
#     nascem com o lineage do run corrente — ver T15). ORDEM: antes do
#     critical-journey, que consome o handoff;
#   - regenera artefatos cujo produtor é externo ao fixpoint (jornada crítica,
#     qa-waves enterprise, package-validation do zip de convergência);
#   - regenera a projeção de readiness (produtor externo ao fixpoint) para que
#     ela carregue o runId CORRENTE — sem isso `dev/platform-readiness/latest.json`
#     fica com lineage estrangeiro e o contamination cleaner derruba o run
#     (FOREIGN_RUN_ARTIFACT em arquivo de decisão);
#   - REGERA os relatórios derivados com validade temporal (maxAgeMs=7d no
#     registry): system-scope-audit, agent-policy-compliance e
#     replay-hardening. O stamp NÃO pode refrescar generatedAt (seria freshness
#     fabricada) — só o produtor real pode. Sem este passo os relatórios cruzam
#     168h e o scorecard derruba as dimensões dependentes (ARTIFACT_EXPIRED,
#     medido em 2026-09-20 no run rap-governed-20260920040310055);
#   - REGERA a evidência executável com validade temporal: master-scorecard
#     test/regression, reports de domínio e o relatório de persistência, e
#     executa o QA MESH canônico DENTRO do run (RUNNING_IN_PIPELINE=1 →
#     executionOrigin=pipeline; lineage resolvido na origem por
#     pipeline/entrypoints/runQaMesh.js). ORDEM OBRIGATÓRIA: o mesh roda ANTES
#     do stamp e do scorecard — em 2026-09-20 o seal-time-gate avaliou o run
#     novo antes do mesh executar e RAP-024/026 caíram como
#     FOREIGN_RUN_ARTIFACT (falha "real") → SEAL_NO_GO com o mesh nunca
#     executado (deadlock). ATENÇÃO: as suítes Jest reescrevem relatórios
#     governados sem lineage (coverage/model-driven) — por isso o stamp é o
#     passo SEGUINTE, nunca o anterior;
#   - re-stampa lineage (runId/sourceFingerprint) nos relatórios governados;
#   - roda o fixpoint persistido 2x (1ª: projeta DEFERRED a partir do DB;
#     2ª: revalida contra os relatórios projetados — fixpoint estável);
#   - avalia o seal-time-gate (esperado: SEAL_PENDING na fase DELIVERED ou
#     SEAL_GO quando 78/78).
set -euo pipefail
cd "$(dirname "$0")/../.."

NODE="node --env-file-if-exists=.env"

echo "[converge] 1/12 enterprise proof smoke DENTRO do run (evidência same-run qa/enterprise/*)"
# RUNTIME_EVIDENCE: só é prova do run se executar nele. O smoke resolve o
# lineage NA ORIGEM (governance/.current-run.json) e sai != 0 quando
# report.ok=false — fail-closed, sem evidência same-run não há convergência.
RUNNING_IN_PIPELINE=1 $NODE scripts/smoke/qa-waves-enterprise-proof-smoke.js

echo "[converge] 2/12 critical-journey-evidence (v2 — evidência real de handoff)"
$NODE scripts/governance/generate-critical-journey-evidence-v2.js

echo "[converge] 3/12 qa-waves enterprise governance (bridge)"
$NODE tools/system/qa-waves-enterprise-governance-bridge.js >/dev/null

echo "[converge] 4/12 package-validation (zip de convergência, se presente)"
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

echo "[converge] 5/12 readiness projection (lineage do run corrente)"
# O exit code deste produtor ESPELHA A DECISÃO (1 quando a decisão não é GO),
# não uma falha de execução. A avaliação da decisão é feita pelo fixpoint
# (passos 10-11); aqui o objetivo é apenas regerar a projeção com o lineage do
# run corrente. Sob `set -e` o abort seria um falso bloqueio.
$NODE tools/system/platform-readiness.js >/dev/null || true

echo "[converge] 6/12 relatórios derivados com TTL de 7d (produtor real, nunca stamp)"
# maxAgeMs=7d no master-scorecard-registry: cruzou 168h vira ARTIFACT_EXPIRED e
# derruba as dimensões dependentes (RAP-007/010/011/012/015/016/017/058/077,
# medido em 2026-09-20). Só o produtor real refresca generatedAt sem fabricar
# freshness. O lineage (runId/fingerprint) é reaplicado no passo 9 (stamp).
$NODE scripts/governance/generate-system-scope-audit.js >/dev/null
$NODE governance/verify-agent-policy-compliance.js >/dev/null
$NODE governance/replay-hardening-engine.js >/dev/null

echo "[converge] 7/12 evidência executável com validade temporal (test/regression + domínios + persistência)"
# Produtores reais (rodam as suítes Jest e gravam o exit code): únicos que
# podem refrescar generatedAt sem fabricar freshness. Se uma suíte falhar, o
# report sai FAIL e o fixpoint/seal-time-gate reprovam — comportamento honesto
# desejado (set -e aborta aqui de propósito). ATENÇÃO: estas suítes reescrevem
# relatórios governados sem lineage (coverage/model-driven) — por isso o stamp
# é o passo SEGUINTE, nunca o anterior.
$NODE scripts/governance/generate-policy-evidence.js
$NODE scripts/governance/generate-domain-evidence.js >/dev/null
$NODE scripts/governance/generate-persistence-evidence.js >/dev/null

echo "[converge] 8/12 QA Mesh canônico DENTRO do run governado (~35min; evidência same-run RAP-024/026)"
# RUNTIME_EVIDENCE: o go-no-go do mesh só é prova do run em que o mesh
# REALMENTE rodou. RUNNING_IN_PIPELINE=1 torna a execução canônica
# (executionOrigin=pipeline → go-no-go/release-gate/histórico gravados) e o
# lineage é resolvido na origem por pipeline/entrypoints/runQaMesh.js a partir
# de governance/.current-run.json — nunca anexado depois. Exit != 0 (NO_GO ou
# erro) aborta a convergência: sem evidência same-run não há seal.
RUNNING_IN_PIPELINE=1 timeout 5400 npm run qa:mesh

echo "[converge] 8.5/12 coverage gate RECOMPUTADO sobre o mesh do run corrente"
# Os estados de jornada do coverage gate derivam dos outcomes de cenário do
# mesh. Até 2026-09-20 o report era regenerado só no passo 7/12 (via suíte
# coverageGate.test.js), ANTES do mesh do run — o gate avaliava o mesh do run
# ANTERIOR e derrubava RAP-002/018/020/022/023/025/040 por herança (journey
# crítica FAILED no seal#8 → NO_GO no seal#9 com o mesh do run corrente GO,
# medido no run rap-governed-20260920113643242-cac6169c). Aqui o produtor
# real reexecuta DEPOIS do mesh: evidência recomputada do run, nunca stamp.
# Exit != 0 (NO_GO) aborta a convergência — sem cobertura válida não há seal.
$NODE scripts/governance/validate-coverage-gate.js

echo "[converge] 9/12 stamp de lineage"
$NODE scripts/governance/stamp-report-lineage.js >/dev/null

echo "[converge] 10/12 fixpoint (pass 1 — projeção)"
$NODE scripts/governance/run-persisted-scorecard.js >/dev/null

echo "[converge] 11/12 fixpoint (pass 2 — revalidação estável)"
$NODE scripts/governance/run-persisted-scorecard.js

echo "[converge] 12/12 seal-time-gate"
node scripts/governance/seal-time-gate.js
