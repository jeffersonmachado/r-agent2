'use strict';

/**
 * Lineage de relatórios produzidos por execução REAL.
 *
 * DEFEITO MEDIDO (2026-10-19, ciclo de selagem): as três waves técnicas
 * (`db-integrity`, `api-surface`, `page-surface`) gravavam `generatedAt` mas não
 * `runId`/`sourceFingerprint`. O validador `wave-same-run` reprovava os três
 * relatórios com `WAVE_EVIDENCE_NO_LINEAGE` — e o `prepare` do `release:seal`
 * abortava em `8/12`.
 *
 * A correção tem de ser feita pelo PRODUTOR, no momento da execução: estampar
 * lineage retroativo (`stamp-report-lineage.js`) é proibido para runtime
 * evidence justamente porque faria um relatório antigo reivindicar um run que
 * ele nunca executou. Aqui o run é lido do banco DURANTE a produção — se não
 * houver run, o produtor FALHA (fail-closed) em vez de gravar sem origem.
 */

const { connect, getSequelize } = require('../../../api/db/sequelize');
const getRun = require('../../../api/db/models/GovernanceRun');

/**
 * Lê o run governado corrente (o mais recente criado).
 * @returns {Promise<{runId:string, sourceFingerprint:string|null, sourceCommit:string|null}>}
 * @throws quando não há run ou quando ele não tem runId
 */
async function lineageDoRunCorrente() {
  // As waves rodam fora da API: garante conexão antes de consultar o run.
  if (!getSequelize()) {
    try { await connect(); } catch (_) { /* sem banco: falha explícita abaixo */ }
  }
  const Model = getRun();
  if (!Model) throw new Error('GovernanceRun indisponível — sem modelo não há lineage');
  const run = await Model.findOne({ order: [['created_at', 'DESC']] });
  if (!run) throw new Error('nenhum run governado encontrado — crie o run antes de produzir evidência');
  const dados = run.toJSON ? run.toJSON() : run;
  const runId = dados.run_id || dados.runId;
  if (!runId) throw new Error('run governado sem run_id — lineage impossível');
  return {
    runId,
    sourceFingerprint: dados.source_fingerprint || dados.sourceFingerprint || null,
    sourceCommit: dados.source_commit || dados.sourceCommit || null,
  };
}

/**
 * Mescla os campos de lineage no relatório que será escrito.
 * Mantém TODOS os campos de conteúdo (nada é fabricado além da identidade).
 */
async function comLineage(relatorio) {
  const lineage = await lineageDoRunCorrente();
  return {
    ...relatorio,
    runId: lineage.runId,
    sourceFingerprint: lineage.sourceFingerprint,
    ...(lineage.sourceCommit ? { sourceCommit: lineage.sourceCommit } : {}),
  };
}

module.exports = { lineageDoRunCorrente, comLineage };
