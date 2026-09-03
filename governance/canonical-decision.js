#!/usr/bin/env node
'use strict';

/**
 * Canonical Governance Decision — fonte única e monotônica de decisão.
 *
 * PRINCÍPIO: existe UMA única verdade canônica de certificação por run:
 *   governance/final-governance-report.json  (artifactType: final-governance-report)
 * produzida pelo final-governance-engine a partir dos engines reais.
 *
 * Nenhuma fase posterior do pipeline (packaging, envelope, verifier) pode
 * PROMOVER uma decisão. A decisão só pode ser preservada ou degradar:
 *
 *   GO  + GO    = GO
 *   GO  + NO_GO = NO_GO
 *   NO_GO + GO    = NO_GO   (proibido promover)
 *   NO_GO + NO_GO = NO_GO
 *
 * Vocabulário de decisão:
 *   GO     — cobre AUTONOMOUS_READY_GO / GO / PASS / DELIVERED_RELEASE_VERIFIED
 *   NO_GO  — qualquer outra decisão (NO_GO*, FAIL, DEFERRED sem GO, ausência)
 */

const fs = require('fs');
const path = require('path');

const CANONICAL_REPORT_REL_PATH = 'governance/final-governance-report.json';
const CANONICAL_ARTIFACT_TYPE = 'final-governance-report';

const GO_DECISIONS = new Set([
  'GO',
  'AUTONOMOUS_READY_GO',
  'AUTONOMOUS_READY',
  'PASS',
  'DELIVERED_RELEASE_VERIFIED',
]);

/** Normaliza qualquer vocabulário de decisão para 'GO' | 'NO_GO'. */
function normalizeDecision(decision) {
  if (typeof decision !== 'string' || decision.length === 0) return 'NO_GO';
  if (GO_DECISIONS.has(decision)) return 'GO';
  // PASS_WITH_DEFERRED_PACKAGE_GATE NÃO é GO: é estado pré-package transitório.
  return 'NO_GO';
}

/**
 * Combina duas decisões de forma monotônica: o resultado nunca é melhor que
 * a pior entrada. NO_GO é absorvente — nenhuma fase pode revertê-lo.
 */
function combineDecision(current, next) {
  const a = normalizeDecision(current);
  const b = normalizeDecision(next);
  return a === 'GO' && b === 'GO' ? 'GO' : 'NO_GO';
}

/**
 * Reduz uma lista de decisões pela política monotônica.
 */
function reduceDecisions(decisions) {
  return decisions.reduce((acc, d) => combineDecision(acc, d), 'GO');
}

function readJsonMaybe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Lê a decisão canônica de um root (workspace ou payload extraído).
 * Fail-closed: relatório ausente/inválido/sem lineage = NO_GO com reason.
 *
 * @returns {{decision: 'GO'|'NO_GO', rawDecision: string|null, reason: string|null,
 *            runId: string|null, sourceFingerprint: string|null, report: object|null}}
 */
function readCanonicalDecision(rootDir) {
  const absPath = path.join(rootDir, CANONICAL_REPORT_REL_PATH);
  const report = readJsonMaybe(absPath);
  if (!report || typeof report !== 'object') {
    return {
      decision: 'NO_GO', rawDecision: null, report: null,
      runId: null, sourceFingerprint: null,
      reason: `MISSING_CANONICAL_GOVERNANCE — ${CANONICAL_REPORT_REL_PATH} ausente ou inválido`,
    };
  }
  const rawDecision = report.finalDecision || report.decision || null;
  return {
    decision: normalizeDecision(rawDecision),
    rawDecision,
    report,
    runId: report.runId || null,
    sourceFingerprint: report.sourceFingerprint || null,
    reason: null,
  };
}

/**
 * Verifica que uma decisão DERIVADA (envelope/transporte) é idêntica à
 * canônica. Divergência = tentativa de promoção ou cópia corrompida.
 *
 * @returns {{ok: boolean, reason: string|null}}
 */
function assertDerivedDecisionMatches(canonicalDecision, derivedDecision, context = 'envelope') {
  const canonical = normalizeDecision(canonicalDecision);
  const derived = normalizeDecision(derivedDecision);
  if (canonical !== derived) {
    return {
      ok: false,
      reason: `GOVERNANCE_DECISION_MISMATCH — ${context} decision=${derived} diverge da decisão canônica=${canonical}`,
    };
  }
  return { ok: true, reason: null };
}

module.exports = {
  CANONICAL_REPORT_REL_PATH,
  CANONICAL_ARTIFACT_TYPE,
  normalizeDecision,
  combineDecision,
  reduceDecisions,
  readCanonicalDecision,
  assertDerivedDecisionMatches,
};
