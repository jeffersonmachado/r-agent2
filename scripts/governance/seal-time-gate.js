#!/usr/bin/env node
'use strict';

/**
 * Seal-Time Gate — convergência obrigatória ANTES de selar o payload.
 *
 * Executado pelo two-pass-release ao final do PASS 2, depois dos engines
 * reais (platform-readiness, stamp-lineage, master-scorecard,
 * final-consistency, final-governance, self-proving) rodarem contra o
 * pacote provisional. Avalia os artefatos PRODUZIDOS PELOS ENGINES e aplica
 * a política de selagem:
 *
 *   SEAL_GO:      scorecard 78/78 + final-governance GO + consistency GO
 *                 + readiness GO → o payload é selado com decisão GO real.
 *
 *   SEAL_PENDING: único below-10 ⊆ {RAP-055, RAP-056} (fase DELIVERED, que
 *                 estruturalmente só sobe após o primeiro pacote do run ser
 *                 entregue e verificado) → selagem permitida, mas o release
 *                 será bloqueado no PASS 5 (comportamento da tentativa A).
 *
 *   SEAL_NO_GO:   qualquer outra composição → release ABORTADA. O payload
 *                 nunca é selado com NO_GO fora da fase DELIVERED.
 *
 * Este script NUNCA escreve artefatos nem promove decisões — só lê o que os
 * engines produziram e decide se o estado é selável.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DELIVERED_PHASE_DIMS = new Set(['RAP-055', 'RAP-056']);
const GO_DECISIONS = new Set(['GO', 'AUTONOMOUS_READY_GO', 'AUTONOMOUS_READY']);

function readJson(relPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
  } catch (_) {
    return null;
  }
}

function evaluateSealState(rootDir = ROOT) {
  const read = (rel) => {
    try { return JSON.parse(fs.readFileSync(path.join(rootDir, rel), 'utf8')); }
    catch (_) { return null; }
  };

  const failures = [];
  const warnings = [];

  const scorecard = read('governance/rap-master-scorecard.json');
  if (!scorecard || !Array.isArray(scorecard.dimensions)) {
    failures.push('MISSING_ARTIFACT — rap-master-scorecard.json ausente/inválido');
    return { decision: 'SEAL_NO_GO', failures, warnings };
  }
  const below10 = scorecard.dimensions.filter((d) => Number(d.score) < 10).map((d) => d.id);
  const nonDeliveredBelow10 = below10.filter((id) => !DELIVERED_PHASE_DIMS.has(id));

  const governance = read('governance/final-governance-report.json');
  const governanceDecision = governance?.finalDecision || null;
  const governanceGo = GO_DECISIONS.has(governanceDecision);

  const consistency = read('governance/final-consistency-gate-report.json');
  const consistencyDecision = consistency?.decision || (consistency?.pass === true ? 'FINAL_CONSISTENCY_GO' : null);
  const consistencyGo = consistencyDecision === 'FINAL_CONSISTENCY_GO' || consistency?.pass === true;

  const readiness = read('governance/final-readiness-report.json');
  const readinessDecision = readiness?.finalDecision || readiness?.status || null;
  const readinessGo = readinessDecision === 'AUTONOMOUS_READY_GO';

  const proof = read('governance/final-proof-report.json');
  const proofDecision = proof?.finalDecision || null;
  const proofGo = proofDecision === 'AUTONOMOUS_READY_GO';

  const pkgValidation = read('governance/package-validation-report.json');
  if (!pkgValidation?.runId || !pkgValidation?.sourceFingerprint) {
    failures.push('ARTIFACT_RUN_ID_MISSING — package-validation-report.json sem lineage no selo');
  } else if (pkgValidation.ok !== true) {
    failures.push(`PACKAGE_VALIDATION_NOT_PASS — ok=${pkgValidation.ok} (o pacote provisional precisa validar antes de selar)`);
  }

  const pkgIntegrity = read('governance/package-integrity-report.json');
  if (!pkgIntegrity?.runId) {
    failures.push('ARTIFACT_RUN_ID_MISSING — package-integrity-report.json sem lineage no selo');
  } else if (pkgIntegrity.decision !== 'PACKAGE_INTEGRITY_GO' && pkgIntegrity.pass !== true) {
    failures.push(`PACKAGE_INTEGRITY_NO_GO — decision=${pkgIntegrity.decision || 'null'}`);
  }

  if (nonDeliveredBelow10.length > 0) {
    failures.push(`MASTER_SCORECARD_NOT_10_OF_10 — below10 fora da fase DELIVERED: [${nonDeliveredBelow10.join(',')}]`);
  }
  if (!proofGo) failures.push(`FINAL_PROOF_NOT_PASS — ${proofDecision || 'null'}`);
  if (!readinessGo) failures.push(`FINAL_READINESS_NOT_PASS — ${readinessDecision || 'null'}`);
  if (!consistencyGo) failures.push(`FINAL_CONSISTENCY_NOT_PASS — ${consistencyDecision || 'null'}`);

  if (failures.length > 0) return { decision: 'SEAL_NO_GO', failures, warnings };

  if (below10.length === 0 && governanceGo) {
    return { decision: 'SEAL_GO', failures, warnings };
  }

  if (below10.length > 0 && below10.every((id) => DELIVERED_PHASE_DIMS.has(id))) {
    warnings.push(`DELIVERED_PENDING — below10=[${below10.join(',')}] (fase DELIVERED; o PASS 5 bloqueia o release até o fixpoint real)`);
    return { decision: 'SEAL_PENDING', failures, warnings };
  }

  failures.push(`FINAL_GOVERNANCE_NOT_GO — ${governanceDecision || 'null'}`);
  return { decision: 'SEAL_NO_GO', failures, warnings };
}

if (require.main === module) {
  const result = evaluateSealState(ROOT);
  for (const warning of result.warnings) console.warn(`  ⚠ ${warning}`);
  if (result.decision === 'SEAL_NO_GO') {
    console.error(`[seal-time-gate] ${result.decision}`);
    for (const failure of result.failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log(`[seal-time-gate] ${result.decision}`);
  process.exit(0);
}

module.exports = { evaluateSealState, DELIVERED_PHASE_DIMS };
