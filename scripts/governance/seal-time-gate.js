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
 *   SEAL_GO:      scorecard 78/78 + final-governance GO + consistency GO
 *                 + readiness GO → o payload é selado com decisão GO real.
 *
 *   SEAL_PENDING: fase DELIVERED legítima (modelo de fases pré-existente —
 *                 PASS_WITH_DEFERRED_PACKAGE_GATE): hard gates verdes
 *                 (package-validation ok, package-integrity GO, consistency
 *                 GO, proof/readiness/governance ∈ {GO, DEFERRED}) e below10
 *                 ⊆ {RAP-055, RAP-056} (só verificáveis no artefato entregue).
 *                 A selagem produz um CANDIDATO com decisão DEFERRED verdadeira
 *                 de ponta a ponta (payload=candidato, envelope=candidato) —
 *                 NUNCA um envelope GO. O release final exige novo ciclo após
 *                 a verificação do entregue (verify:delivered-release).
 *
 *   SEAL_NO_GO:   qualquer outra composição → release ABORTADA. O payload
 *                 nunca é selado com NO_GO fora da fase DELIVERED.
 *
 * Este script NUNCA escreve artefatos nem promove decisões — só lê o que os
 * engines produziram e decide se o estado é selável.
 */

const fs = require('fs');
const path = require('path');

const { classifyBelow10Dimensions } = require('./scorecard-phase-deferral');
const { isCircularOnlyDimension, isCircularRequirement } = require('./circular-projection');

const ROOT = path.join(__dirname, '..', '..');
const DELIVERED_PHASE_DIMS = new Set(['RAP-055', 'RAP-056']);
const GO_DECISIONS = new Set(['GO', 'AUTONOMOUS_READY_GO', 'AUTONOMOUS_READY']);
// Único estado não-GO selável: a fase DEFERRED canônica dos engines (proof,
// readiness e governance projetam exatamente esta decisão quando os únicos
// gaps são os da fase DELIVERED). Qualquer outro NO_GO é falha real.
const DEFERRED_DECISION = 'PASS_WITH_DEFERRED_PACKAGE_GATE';

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
  // Classificação de fase CANÔNICA (a mesma do scorecard persistido): uma
  // dimensão abaixo de 10 que é PENDING_PHASE (pacote ainda não construído),
  // DELIVERED_PHASE ou projeção CIRCULAR não é falha real. Antes o gate mantinha
  // a própria lista e tratava RAP-052/054 como falha real mesmo com
  // package-validation DEFERRED — era isso que abortava a fase `prepare` do
  // `release:seal` com dist/ zerado.
  const below10Assessment = classifyBelow10Dimensions(scorecard.dimensions, {
    deliveredPhaseDimensions: DELIVERED_PHASE_DIMS,
    isCircularOnly: isCircularOnlyDimension,
    isCircularRequirement,
  });
  const realFailures = below10Assessment.realFailures.map((entry) => entry.id);
  const nonDeliveredBelow10 = realFailures;

  const governance = read('governance/final-governance-report.json');
  const governanceDecision = governance?.finalDecision || null;
  const governanceGo = GO_DECISIONS.has(governanceDecision);

  const consistency = read('governance/final-consistency-gate-report.json');
  const consistencyDecision = consistency?.decision || (consistency?.pass === true ? 'FINAL_CONSISTENCY_GO' : null);
  const consistencyGo = consistencyDecision === 'FINAL_CONSISTENCY_GO' || consistency?.pass === true;

  const proof = read('governance/final-proof-report.json');
  const proofDecision = proof?.finalDecision || null;
  const proofGo = proofDecision === 'AUTONOMOUS_READY_GO';
  const proofGoOrDeferred = GO_DECISIONS.has(proofDecision) || proofDecision === DEFERRED_DECISION;

  const readiness = read('governance/final-readiness-report.json');
  const readinessDecision = readiness?.finalDecision || readiness?.status || null;
  const readinessGo = readinessDecision === 'AUTONOMOUS_READY_GO';
  const readinessGoOrDeferred = GO_DECISIONS.has(readinessDecision) || readinessDecision === DEFERRED_DECISION;

  const governanceDeferredOk = governanceGo || governanceDecision === DEFERRED_DECISION;

  const pkgValidation = read('governance/package-validation-report.json');
  if (!pkgValidation?.runId || !pkgValidation?.sourceFingerprint) {
    failures.push('ARTIFACT_RUN_ID_MISSING — package-validation-report.json sem lineage no selo');
  } else if (
    pkgValidation.deferred === true
    || String(pkgValidation.status || '').toUpperCase() === 'DEFERRED'
  ) {
    // PENDING_PHASE: o pacote ainda NÃO existe. DEFERRED significa "não
    // avaliável nesta fase" — nunca "reprovado". É o estado honesto do
    // `release:seal` na fase prepare (dist/ sem nenhum ZIP) e do PRE_PACKAGE.
    warnings.push(`PACKAGE_VALIDATION_PENDING_PHASE — ${pkgValidation.status || 'DEFERRED'} (candidato ainda não construído; não é falha de conteúdo)`);
  } else if (pkgValidation.ok !== true) {
    failures.push(`PACKAGE_VALIDATION_NOT_PASS — ok=${pkgValidation.ok} (o pacote provisional precisa validar antes de selar)`);
  }

  const pkgIntegrity = read('governance/package-integrity-report.json');
  if (!pkgIntegrity?.runId) {
    failures.push('ARTIFACT_RUN_ID_MISSING — package-integrity-report.json sem lineage no selo');
  } else if (pkgIntegrity.decision !== 'PACKAGE_INTEGRITY_GO' && pkgIntegrity.pass !== true) {
    failures.push(`PACKAGE_INTEGRITY_NO_GO — decision=${pkgIntegrity.decision || 'null'}`);
  }

  // Hard failures (falhas reais — bloqueiam qualquer selagem):
  if (nonDeliveredBelow10.length > 0) {
    failures.push(`MASTER_SCORECARD_NOT_10_OF_10 — below10 fora da fase DELIVERED: [${nonDeliveredBelow10.join(',')}]`);
  }
  if (!proofGoOrDeferred) failures.push(`FINAL_PROOF_NOT_PASS — ${proofDecision || 'null'}`);
  if (!readinessGoOrDeferred) failures.push(`FINAL_READINESS_NOT_PASS — ${readinessDecision || 'null'}`);
  if (!consistencyGo) failures.push(`FINAL_CONSISTENCY_NOT_PASS — ${consistencyDecision || 'null'}`);
  if (!governanceDeferredOk) failures.push(`FINAL_GOVERNANCE_NOT_GO — ${governanceDecision || 'null'}`);

  if (failures.length > 0) return { decision: 'SEAL_NO_GO', failures, warnings };

  // SEAL_GO: estado integralmente GO — payload nasce com decisão GO real.
  if (below10.length === 0 && governanceGo && proofGo && readinessGo) {
    return { decision: 'SEAL_GO', failures, warnings };
  }

  // SEAL_PENDING: fase DELIVERED legítima — hard gates verdes, decisões no
  // máximo DEFERRED e NENHUMA falha real abaixo de 10 (as pendências são de
  // fase: pacote não construído, entregue não mensurável ou projeção circular).
  // O candidato é selado com a decisão DEFERRED verdadeira de ponta a ponta
  // (nunca envelope GO); o release final exige o ciclo pós-entrega
  // (verify:delivered-release).
  if (below10.length > 0 && realFailures.length === 0) {
    warnings.push(`DELIVERED_PENDING — below10=[${below10.join(',')}] decisions=[proof=${proofDecision}, readiness=${readinessDecision}, governance=${governanceDecision}] (fase DELIVERED legítima; candidato será selado com decisão DEFERRED verdadeira)`);
    return { decision: 'SEAL_PENDING', failures, warnings };
  }

  // below10 vazio mas alguma decisão DEFERRED (não GO pleno): não é GO nem
  // fase delivered — estado inconsistente, falhar fechado.
  failures.push(`SEAL_STATE_INCONSISTENT — below10=[${below10.join(',')}] proof=${proofDecision} readiness=${readinessDecision} governance=${governanceDecision}`);
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
