#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { isInPipeline } = require('../guard');
const {
  resolveRunLineage,
  toLineageEnv,
} = require('../../scripts/governance/lib/resolve-run-lineage');

const ROOT = path.join(__dirname, '..', '..');

// Execução direta (CLI local ou disparada pela UI) é permitida: fora do

/**
 * Resolve o run governado ANTES de executar o mesh.
 *
 * O relatório do QA Mesh é RUNTIME_EVIDENCE: só é prova do run em que o mesh
 * realmente rodou. O lineage precisa existir NA ORIGEM (aqui), nunca ser
 * anexado depois — `scripts/governance/stamp-report-lineage.js` recusa esses
 * artefatos justamente porque o caminho retroativo produziu um defeito real
 * (relatório de 10:46 estampado com o runId de um run de 20:18).
 *
 * Ordem de resolução:
 *   1. env explícito do orquestrador (GOVERNANCE_RUN_ID/SOURCE_FINGERPRINT);
 *   2. `governance/.current-run.json`, escrito por create-governed-run.js.
 *
 * Sem run governado o mesh roda SEM lineage — e o gate
 * `validate:qa-evidence-same-run` reprova com QA_EVIDENCE_LINEAGE_MISSING.
 * Esse é o resultado honesto: significa "não provei a qual run isto pertence",
 * que é diferente de "isto pertence ao run X".
 */
function resolveRunLineageEnv() {
  const lineage = resolveRunLineage({ rootDir: ROOT });
  if (lineage.source === 'none') {
    console.warn(
      '[pipeline/entrypoints/runQaMesh] SEM run governado ativo: o relatório do mesh\n'
      + 'será gravado sem runId/sourceFingerprint (validate:qa-evidence-same-run =>\n'
      + 'QA_EVIDENCE_LINEAGE_MISSING). Para evidência governada, crie o run antes:\n'
      + 'node scripts/governance/create-governed-run.js'
    );
  }
  return toLineageEnv(lineage);
}

// Execução direta (CLI local ou disparada pela UI) é permitida: fora do
// pipeline oficial o mesh roda como execução manual NÃO canônica
// (executionOrigin=manual_run, sem promover outputs canônicos de governança).
// A promoção canônica (go-no-go-report, release-gate, histórico canônico)
// continua exclusiva do pipeline oficial (RUNNING_IN_PIPELINE=1) —
// ver qa-mesh/meshRunner.js (isCanonicalExecution).
if (!isInPipeline()) {
  console.warn(
    '[pipeline/entrypoints/runQaMesh] Execução direta: rodando como manual_run (não canônico).\n'
    + 'Para evidência canônica de governança: npm run pipeline'
  );
}

// BUG CLOSURE FIRST (2026-10-17): QA Mesh completo é operação EXTENSIVA. Não
// começa enquanto existir P0/P1 bloqueante aberto na fila oficial. O guard
// aborta com exit 3 (recusa por defeito ≠ falha de execução).
require('../../governance/bug-closure/require-eligibility')
  .exigirElegibilidade('QA_WAVES_COMPLETA', { actor: 'pipeline/entrypoints/runQaMesh.js' });

const result = spawnSync('node', ['qa-mesh/meshRunner.js', ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(isInPipeline() ? { RUNNING_IN_PIPELINE: '1' } : {}),
    ...resolveRunLineageEnv(),
  },
});

process.exit(result.status ?? 1);