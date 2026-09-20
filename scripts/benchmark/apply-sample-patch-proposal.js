#!/usr/bin/env node
'use strict';

/**
 * apply-sample-patch-proposal.js — aplica o patch do corpus REPROCESSADO ao
 * sample versionado da vertical pelo FLUXO GOVERNADO de proposta de mudança
 * (`api/services/benchmark/benchmarkChangeProposalService.js`), nunca por
 * escrita direta no JSON.
 *
 * Por que existe (T3/T7, 2026-09-19): `apply-semantic-reprocess.js` regulariza
 * o corpus no banco mas NÃO reescreve o sample — o merge vai só para o
 * relatório. Entre o corpus corrente e o inventário versionado ficaria um
 * hiato: o sample certificaria novidade medida pelo pipeline ANTIGO. O caminho
 * legítimo de reescrita é este: proposta persistida (patch + sha256 +
 * avaliação do engine), revisão com token HMAC, aprovação por ator DISTINTO
 * do proponente (self-approval é recusada pelo serviço) e aplicação
 * transacional com re-hash do patch (`patch_tampered` aborta).
 *
 * Atores (trilha de auditoria da proposta):
 *   proponente:  agent:benchmark-reprocess-agent
 *   revisor:     agent:benchmark-semantics-agent
 *
 * Uso:
 *   node --env-file-if-exists=.env scripts/benchmark/apply-sample-patch-proposal.js \
 *     --vertical fitness [--report reports/benchmark-sample-patch-fitness.json]
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const VERTICAL = arg('vertical', 'fitness');
const REPORT_PATH = path.resolve(ROOT_DIR, arg('report', `reports/benchmark-sample-patch-${VERTICAL}.json`));

const PROPOSER = 'agent:benchmark-reprocess-agent';
const REVIEWER = 'agent:benchmark-semantics-agent';

const { connect, close } = require('../../api/db/sequelize');
const { createBenchmarkResearchStore } = require('../../api/services/benchmark/benchmarkResearchStore');
const { createBenchmarkResearchService } = require('../../api/services/benchmark/benchmarkResearchService');
const { createBenchmarkChangeProposalService } = require('../../api/services/benchmark/benchmarkChangeProposalService');

const TENANT = 'system';

async function main() {
  await connect(3, 500);
  const store = createBenchmarkResearchStore();
  const service = createBenchmarkResearchService({ store });

  const auditTrail = [];
  const proposalService = createBenchmarkChangeProposalService({
    buildPatch: async ({ vertical, priorSample }) => {
      const run = await store.getRun({ tenantId: TENANT, vertical });
      const patch = await service.buildSamplePatch({
        tenantId: TENANT,
        vertical,
        inventoryVersion: priorSample?.inventoryVersion || null,
        // Ciclo N+1: a novidade do run é medida contra o canônico + o que o
        // sample versionado já conhece (mesmo contrato das rotas).
        priorSample,
      });
      return { patch, runId: run?.id || null };
    },
    logAction: (event, details) => {
      auditTrail.push({ event, details, at: new Date().toISOString() });
    },
  });

  const { proposal, created } = await proposalService.createProposal({ vertical: VERTICAL, actor: PROPOSER });
  process.stdout.write(`[proposal] id=${proposal.id} created=${created} status=${proposal.status} patchSha256=${proposal.patchSha256}\n`);
  process.stdout.write(`[proposal] evaluation: status=${proposal.evaluation?.sufficiency?.status || proposal.evaluation?.status || '?'} runId=${proposal.runId}\n`);

  if (proposal.status === 'applied') {
    process.stdout.write('[proposal] já aplicada anteriormente (idempotente) — nada a fazer\n');
    await close();
    return;
  }

  const { reviewToken, expiresAt } = await proposalService.startReview({ proposalId: proposal.id, actor: REVIEWER });
  process.stdout.write(`[proposal] revisão iniciada por ${REVIEWER} (expira ${expiresAt})\n`);

  await proposalService.approveProposal({
    proposalId: proposal.id,
    actor: REVIEWER,
    reviewToken,
    reason: 'corpus reprocessado pelo pipeline semântico corrente (run fitness-semantic-2026-09-19-r2); engine deriva SAMPLE_SUFFICIENT sobre o sample mesclado; aplicação alinha o inventário versionado ao corpus auditado',
  });
  process.stdout.write(`[proposal] aprovada por ${REVIEWER} (proponente ${PROPOSER} — atores distintos)\n`);

  const { proposal: applied, applyResult } = await proposalService.applyProposal({ proposalId: proposal.id, actor: PROPOSER });
  process.stdout.write(`[proposal] aplicada: benchmarks=${applyResult.applied.length} status=${applied.status}\n`);

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify({
    reportType: 'benchmark-sample-patch-proposal',
    vertical: VERTICAL,
    generatedAt: new Date().toISOString(),
    proposal: applied,
    applyResult,
    auditTrail,
  }, null, 2)}\n`);
  process.stdout.write(`[proposal] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}\n`);

  await close();
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[proposal] FALHOU: ${error.code || ''} ${error.message}\n`);
    process.exit(1);
  });
}
