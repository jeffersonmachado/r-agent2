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

const { resolveRunLineage } = require('./resolve-run-lineage');

function loadDbRun(runId) {
  const { connect, getSequelize } = require('../../../api/db/sequelize');
  const getRun = require('../../../api/db/models/GovernanceRun');
  return (async () => {
    if (!getSequelize()) {
      try { await connect(); } catch (_) { return null; }
    }
    const Model = getRun();
    if (!Model) return null;
    const row = await Model.findOne({ where: { run_id: runId } });
    return row ? (row.toJSON ? row.toJSON() : row) : null;
  })();
}

/**
 * Lê a identidade do run a partir do CONTEXTO EXPLÍCITO de execução.
 *
 * DEFEITO MEDIDO (auditoria 2026-10-20): a versão anterior fazia
 * `Model.findOne({ order: [['created_at','DESC']] })` — o run MAIS RECENTE — e
 * omitia `sourceCommit` quando ausente. Um produtor que executava depois da
 * criação de outro run carimbava a evidência com identidade alheia.
 *
 * @param {{rootDir?:string, env?:Object, verifyDb?:boolean}} [options]
 * @throws LINEAGE_RUN_UNDEFINED / LINEAGE_SOURCE_FINGERPRINT_ABSENT /
 *         LINEAGE_SOURCE_COMMIT_ABSENT / LINEAGE_RUN_COMMIT_MISMATCH
 */
async function lineageDoRunCorrente({ rootDir = process.cwd(), env = process.env, verifyDb = true } = {}) {
  const lineage = resolveRunLineage({ rootDir, env });

  if (!lineage || !lineage.runId) {
    throw new Error(
      'LINEAGE_RUN_UNDEFINED: nenhum run governado explícito (GOVERNANCE_RUN_ID + GOVERNANCE_SOURCE_FINGERPRINT '
      + 'ou governance/.current-run.json) — escolher "o run mais recente" é proibido para evidência certificante',
    );
  }
  if (!lineage.sourceFingerprint) {
    throw new Error(`LINEAGE_SOURCE_FINGERPRINT_ABSENT: run ${lineage.runId} sem sourceFingerprint — identidade incompleta`);
  }
  if (!lineage.sourceCommit) {
    throw new Error(`LINEAGE_SOURCE_COMMIT_ABSENT: run ${lineage.runId} sem sourceCommit — evidência sem commit não é certificável`);
  }

  if (verifyDb) {
    let dbRun = null;
    try { dbRun = await loadDbRun(lineage.runId); } catch (_) { dbRun = null; }
    if (dbRun) {
      const dbCommit = dbRun.source_commit || dbRun.sourceCommit || null;
      if (dbCommit && String(dbCommit) !== String(lineage.sourceCommit)) {
        throw new Error(
          `LINEAGE_RUN_COMMIT_MISMATCH: run ${lineage.runId} declara ${dbCommit}, produtor está em ${lineage.sourceCommit}`,
        );
      }
    }
  }

  return {
    runId: lineage.runId,
    sourceFingerprint: lineage.sourceFingerprint,
    sourceCommit: lineage.sourceCommit,
    sourceTree: lineage.sourceTree || null,
    source: lineage.source || null,
  };
}

/**
 * Mescla os campos de lineage no relatório que será escrito.
 * Mantém TODOS os campos de conteúdo (nada é fabricado além da identidade).
 */
async function comLineage(relatorio, options = {}) {
  const lineage = await lineageDoRunCorrente(options);
  return {
    ...relatorio,
    runId: lineage.runId,
    sourceFingerprint: lineage.sourceFingerprint,
    sourceCommit: lineage.sourceCommit,
    ...(lineage.sourceTree ? { sourceTree: lineage.sourceTree } : {}),
  };
}

module.exports = { lineageDoRunCorrente, comLineage };
