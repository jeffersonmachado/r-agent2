'use strict';

/**
 * api/services/engineeringRouter/releaseClosureService.js
 *
 * Dados reais para a UI "Release Closure". Nunca inventa 100%/GO — cada campo vem de um
 * artefato real já existente na governança do RAP, ou aparece como `null`/`UNKNOWN` quando o
 * artefato não existe/não pôde ser lido.
 */

const fs = require('fs');
const path = require('path');
const engineeringTaskService = require('./engineeringTaskService');
const getEngineeringReviewModel = require('../../db/models/EngineeringReview');
const { ROOT } = require('./contextBuilderService');
const logger = require('../../utils/logger');

function readJsonSafe(relPath) {
  try {
    const raw = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    logger.debug('[releaseClosureService] artefato indisponível', { relPath, error: err.message });
    return null;
  }
}

async function countPostReleaseFindings() {
  const Review = getEngineeringReviewModel();
  const reviews = await Review.findAll({ attributes: ['findings'] });
  let count = 0;
  for (const r of reviews) {
    const findings = Array.isArray(r.findings) ? r.findings : [];
    count += findings.filter((f) => f.severity === 'POST_RELEASE').length;
  }
  return count;
}

async function getReleaseClosure() {
  const currentRun = readJsonSafe('governance/.current-run.json');
  const goNoGo = readJsonSafe('qa-mesh/go-no-go-report.json');
  const finalReadiness = readJsonSafe('governance/final-readiness-report.json');
  const platformStatus = readJsonSafe('docs/governance/_platform-status-source.json');

  const engineeringOverview = await engineeringTaskService.computeOverview();
  const postReleaseCount = await countPostReleaseFindings();

  return {
    releaseCandidate: {
      runId: currentRun?.runId ?? null,
      sourceFingerprint: currentRun?.sourceFingerprint ?? null,
      sourceCommit: currentRun?.sourceCommit ?? null,
      status: currentRun?.status ?? 'UNKNOWN',
      generatedAt: currentRun?.generatedAt ?? null,
    },
    goNoGo: {
      status: goNoGo?.status ?? 'UNKNOWN',
      executionId: goNoGo?.executionId ?? null,
      reasons: goNoGo?.reasons ?? [],
    },
    finalReadiness: {
      status: finalReadiness?.status ?? 'UNKNOWN',
      finalDecision: finalReadiness?.finalDecision ?? 'UNKNOWN',
      candidateMaturityLevel: finalReadiness?.candidateMaturityLevel ?? null,
      blockingReasons: finalReadiness?.blockingReasons ?? [],
      mandatoryBlockReasons: finalReadiness?.mandatoryBlockReasons ?? [],
      totalCoverage: finalReadiness?.totalCoverage ?? null,
    },
    platformStatus: platformStatus ? { available: true } : { available: false },
    engineering: {
      totals: engineeringOverview.totals,
      postReleaseFindingsCount: postReleaseCount,
      releaseBlockers: engineeringOverview.totals.releaseBlockers,
    },
    // V1 é honesto: só declara "clean release state" se NENHUM artefato faltar e todos
    // indicarem GO/PASS e não houver release blocker de engenharia pendente.
    cleanReleaseState: Boolean(
      goNoGo?.status === 'GO'
      && String(finalReadiness?.finalDecision || '').startsWith('PASS')
      && engineeringOverview.totals.releaseBlockers === 0,
    ),
    offlineVerify: {
      note: 'Offline verify V1: leitura direta de artefatos versionados em disco (sem chamada de rede). Verificação criptográfica completa (governance.sig) é escopo do pipeline oficial de release, não deste endpoint.',
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  getReleaseClosure,
};
