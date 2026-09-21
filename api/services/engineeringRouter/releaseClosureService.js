'use strict';

/**
 * api/services/engineeringRouter/releaseClosureService.js
 *
 * ERV1-CLOSE-007: antes desta correção, `cleanReleaseState` só checava
 * `goNoGo.status === 'GO' && finalReadiness.finalDecision.startsWith('PASS') && releaseBlockers
 * === 0` — exatamente o critério simplificado que a missão de fechamento proíbe. Achado real
 * confirmado no próprio repositório ao implementar esta correção: `governance/.current-run.json`
 * (run corrente) tinha um `runId`/`sourceFingerprint` completamente diferentes de
 * `qa-mesh/go-no-go-report.json` (de um run do dia anterior) — o serviço anterior teria
 * declarado esse GO como válido mesmo sendo evidência de outro run inteiramente.
 *
 * Corrigido reutilizando autoridade JÁ EXISTENTE no projeto (nunca reimplementada aqui):
 *   - `governance/shared/run-context.js::readRunContext` — mesmo `.current-run.json` que todo
 *     o resto da governança do RAP usa como fonte de verdade do run corrente.
 *   - `governance/final-consistency-gate-report.json` — o "Final Consistency Gate" já existente
 *     (`governance/final-consistency-gate.js`), que já agrega replay/readiness/package/
 *     governance/contamination/cross-engine em uma única decisão GO/NO_GO. Reutilizado como
 *     autoridade de segurança/readiness agregada, em vez de checar report por report aqui.
 *
 * Nunca inventa 100%/GO — cada campo vem de um artefato real já existente, ou aparece como
 * `null`/`UNKNOWN` quando o artefato não existe/não pôde ser lido, e `lockReasons` sempre lista
 * o motivo exato de qualquer bloqueio (a UI nunca precisa adivinhar).
 */

const fs = require('fs');
const path = require('path');
const engineeringTaskService = require('./engineeringTaskService');
const getEngineeringReviewModel = require('../../db/models/EngineeringReview');
const { ROOT } = require('./contextBuilderService');
const { readRunContext } = require('../../../governance/shared/run-context');
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

/** Um artefato só conta como evidência válida do run corrente se runId E sourceFingerprint
 * baterem exatamente — qualquer divergência é lineage estrangeiro/evidência velha, nunca
 * aceito silenciosamente. */
function isSameRun(artifact, currentRun) {
  if (!artifact || !currentRun) return false;
  return artifact.runId === currentRun.runId && artifact.sourceFingerprint === currentRun.sourceFingerprint;
}

const FINAL_CONSISTENCY_GO_DECISIONS = new Set(['FINAL_CONSISTENCY_GO']);

async function getReleaseClosure() {
  let currentRun = null;
  let currentRunError = null;
  try {
    currentRun = readRunContext(ROOT);
  } catch (err) {
    currentRunError = err.message;
  }

  const goNoGo = readJsonSafe('qa-mesh/go-no-go-report.json');
  const finalReadiness = readJsonSafe('governance/final-readiness-report.json');
  const finalConsistencyGate = readJsonSafe('governance/final-consistency-gate-report.json');
  const platformStatus = readJsonSafe('docs/governance/_platform-status-source.json');

  const engineeringOverview = await engineeringTaskService.computeOverview();
  const postReleaseCount = await countPostReleaseFindings();

  const goNoGoSameRun = isSameRun(goNoGo, currentRun);
  const finalReadinessSameRun = isSameRun(finalReadiness, currentRun);
  const finalConsistencySameRun = isSameRun(finalConsistencyGate, currentRun);
  const finalConsistencyGo = FINAL_CONSISTENCY_GO_DECISIONS.has(finalConsistencyGate?.decision);

  // ERV1-CLOSE-007: cada motivo de bloqueio é explícito e específico — a UI nunca precisa
  // adivinhar por que o release não está limpo. "same-run" é checado ANTES do status/decisão de
  // cada artefato ser aceito como válido, nunca depois.
  const lockReasons = [];
  if (!currentRun) lockReasons.push(currentRunError ? 'CURRENT_RUN_CONTEXT_INVALID' : 'NO_CURRENT_GOVERNED_RUN');

  if (!goNoGo) lockReasons.push('QA_MESH_GO_NO_GO_MISSING');
  else if (goNoGo.status !== 'GO') lockReasons.push('QA_MESH_NOT_GO');
  else if (currentRun && !goNoGoSameRun) lockReasons.push('QA_MESH_EVIDENCE_FOREIGN_RUN');

  if (!finalReadiness) lockReasons.push('FINAL_READINESS_MISSING');
  else if (!String(finalReadiness.finalDecision || '').startsWith('PASS')) lockReasons.push('FINAL_READINESS_NOT_PASS');
  else if (currentRun && !finalReadinessSameRun) lockReasons.push('FINAL_READINESS_EVIDENCE_FOREIGN_RUN');

  // Final Consistency Gate já agrega replay/readiness/package/governance/contamination/
  // cross-engine numa única autoridade — reutilizado aqui em vez de checar cada report solto,
  // exatamente para não criar "critério paralelo simplificado" (proibido pela missão).
  if (!finalConsistencyGate) lockReasons.push('FINAL_CONSISTENCY_GATE_MISSING');
  else if (!finalConsistencyGo) lockReasons.push('FINAL_CONSISTENCY_GATE_NO_GO');
  else if (currentRun && !finalConsistencySameRun) lockReasons.push('FINAL_CONSISTENCY_EVIDENCE_FOREIGN_RUN');

  if (engineeringOverview.totals.releaseBlockers > 0) lockReasons.push('ENGINEERING_RELEASE_BLOCKERS_PENDING');
  if (engineeringOverview.totals.red > 0) lockReasons.push('ENGINEERING_REGRESSIONS_PENDING');

  const cleanReleaseState = lockReasons.length === 0;

  return {
    releaseCandidate: {
      runId: currentRun?.runId ?? null,
      sourceFingerprint: currentRun?.sourceFingerprint ?? null,
      sourceCommit: currentRun?.sourceCommit ?? null,
      status: currentRun?.status ?? 'UNKNOWN',
      generatedAt: currentRun?.generatedAt ?? null,
      contextError: currentRunError,
    },
    goNoGo: {
      status: goNoGo?.status ?? 'UNKNOWN',
      executionId: goNoGo?.executionId ?? null,
      reasons: goNoGo?.reasons ?? [],
      sameRun: goNoGoSameRun,
    },
    finalReadiness: {
      status: finalReadiness?.status ?? 'UNKNOWN',
      finalDecision: finalReadiness?.finalDecision ?? 'UNKNOWN',
      candidateMaturityLevel: finalReadiness?.candidateMaturityLevel ?? null,
      blockingReasons: finalReadiness?.blockingReasons ?? [],
      mandatoryBlockReasons: finalReadiness?.mandatoryBlockReasons ?? [],
      totalCoverage: finalReadiness?.totalCoverage ?? null,
      sameRun: finalReadinessSameRun,
    },
    // ERV1-CLOSE-007: autoridade agregada já existente (replay/readiness/package/governance/
    // contamination/cross-engine numa decisão só) — nunca reimplementada aqui.
    finalConsistencyGate: {
      decision: finalConsistencyGate?.decision ?? 'UNKNOWN',
      failures: finalConsistencyGate?.failures ?? [],
      sameRun: finalConsistencySameRun,
    },
    platformStatus: platformStatus ? { available: true } : { available: false },
    engineering: {
      totals: engineeringOverview.totals,
      postReleaseFindingsCount: postReleaseCount,
      releaseBlockers: engineeringOverview.totals.releaseBlockers,
    },
    // V1 é honesto: só declara "clean release state" se NENHUM artefato faltar, todos forem
    // evidência do MESMO run corrente (nunca lineage estrangeiro/evidência velha), todos
    // indicarem GO/PASS, e não houver release blocker/regressão de engenharia pendente.
    cleanReleaseState,
    lockReasons,
    offlineVerify: {
      note: 'Offline verify V1: leitura direta de artefatos versionados em disco (sem chamada de rede), cruzados com o run corrente (mesmo runId/sourceFingerprint). Verificação criptográfica completa (governance.sig) é escopo do pipeline oficial de release, não deste endpoint.',
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  getReleaseClosure,
  isSameRun,
};
