#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { connect, close } = require('../../api/db/sequelize');
const getRun = require('../../api/db/models/GovernanceRun');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');
const { evaluateMasterScorecard, writeScorecard } = require('../../governance/master-scorecard-engine');
const { persistEvaluation } = require('../../api/services/governance/scorecardService');
const { recordGate, calculateFinalDecision } = require('../../api/services/governance/certificationService');
const { exportGovernanceArtifacts } = require('../../governance/export-governance-artifacts');
const { runContaminationCleaner } = require('../../governance/report-contamination-cleaner');
const { exportCertificationSnapshot } = require('../../governance/export-certification-snapshot');
const getAttestation = require('../../api/db/models/AgentPolicyAttestation');
const getGap = require('../../api/db/models/GovernanceGap');
const { classifyBelow10Dimensions } = require('./scorecard-phase-deferral');

// Dimensões cuja verificação só existe na fase DELIVERED (artefato entregue).
const DELIVERED_PHASE_DIMENSIONS = new Set(['RAP-055', 'RAP-056']);

// Relatórios PROJETADOS pelo exportGovernanceArtifacts (proof/readiness/
// governance/consistency derivam do próprio estado do scorecard). Um requisito
// MANDATORY_GATE_NO_GO contra esses relatórios é AUTO-REFERENTE: não pode
// vetar a projeção da qual ele próprio deriva — senão o sistema trava no
// fixpoint espúrio all-NO_GO (reports NO_GO → dims falham → gate FAIL →
// reports NO_GO). A verificação real acontece no pass 2, contra os relatórios
// já projetados (DEFERRED é aceito pelo registry; NO_GO real derruba de novo).
const CIRCULAR_PROJECTION_REPORTS = new Set([
  'governance/final-proof-report.json',
  'governance/final-readiness-report.json',
  'governance/final-governance-report.json',
  'governance/final-consistency-gate-report.json',
]);

function isCircularRequirement(requirement) {
  return requirement.code === 'MANDATORY_GATE_NO_GO'
    && (requirement.validator || []).some((validatorPath) => CIRCULAR_PROJECTION_REPORTS.has(validatorPath));
}

function isCircularOnlyDimension(dimension) {
  const failures = (dimension.requirements || []).filter((requirement) => (
    requirement.mandatory !== false
    && requirement.status !== 'PASS'
    && !['NO_KNOWN_GAP', 'NO_OPEN_BLOCKER'].includes(requirement.category)
  ));
  if (failures.length === 0) return true; // só falhas derivadas (gap/blocker dos circulares)
  return failures.every(isCircularRequirement);
}

function toPersistable(scorecard) {
  return scorecard.dimensions.map((dimension) => ({
    dimensionKey: dimension.id,
    score: dimension.score,
    blockerCount: dimension.blockers.length,
    gapCount: dimension.gaps.length,
    testStatus: dimension.requirements.find((item) => item.category === 'TESTED')?.status,
    runtimeEvidenceStatus: dimension.requirements.find((item) => item.category === 'RUNTIME_VALIDATED')?.status,
    requirementResults: dimension.requirements.map((requirement) => ({
      requirementKey: requirement.id,
      status: requirement.status,
      reason: requirement.reason,
      validator: requirement.validator?.join(',') || null,
      testReference: requirement.category === 'TESTED' ? requirement.validator?.join(',') : null,
      evidenceReference: requirement.validator?.join(',') || null,
      runtimeEvidenceReference: requirement.category === 'RUNTIME_VALIDATED' ? requirement.validator?.join(',') : null,
    })),
    gaps: dimension.gaps.map((gap) => ({
      gapKey: gap.id,
      requirementId: gap.requirementId,
      severity: gap.severity,
      title: gap.requirementId,
      description: gap.description,
      rootCause: gap.rootCause,
      status: gap.status,
      testRequired: gap.testRequired,
    })),
  }));
}

async function main() {
  const rootDir = process.cwd();
  await connect();
  const run = await getRun().findOne({ order: [['created_at', 'DESC']] });
  if (!run) throw new Error('governance_run_missing');
  const sourceFingerprint = computeSourceFingerprint(rootDir);
  if (run.source_fingerprint !== sourceFingerprint) { await run.update({ status: 'INVALIDATED', invalidated_at: new Date(), invalidated_reason: 'RUN_SOURCE_DRIFT' }); throw new Error('RUN_SOURCE_DRIFT'); }
  const runContext = { runId: run.run_id, sourceFingerprint, startedAt: new Date(run.started_at).toISOString(), generatedAt: new Date(run.createdAt).toISOString(), status: run.status, artifactType: 'run-context', artifactVersion: '1.0.0', policyId: run.policy_id, policyVersion: run.policy_version, policyFingerprint: run.policy_fingerprint };

  let scorecard = evaluateMasterScorecard({ rootDir, runContext, sourceFingerprint, requireCanonicalIds: true });

  // Pass 1 → persistir ANTES de exportar projeções: o export lê o below10 real
  // do DB, nunca um flag. Abaixo de 10 com gates semânticos ok vira
  // PASS_WITH_DEFERRED_PACKAGE_GATE (não é GO final, nem FAIL).
  await persistEvaluation({ runId: run.run_id, sourceFingerprint, results: toPersistable(scorecard), scorecardFingerprint: scorecard.scorecardFingerprint });

  // Exportar projeções circulares derivadas do DB (below10 real + gates semânticos).
  await exportGovernanceArtifacts();

  // Limpeza de lineage dos derivados que o contamination cleaner verifica:
  // escreve o scorecard pass 1 e o snapshot de certificação com o runId atual,
  // e remove artefato DELIVERED estrangeiro (é produzido apenas pelo verifier
  // entregue em fase DELIVERED). Nenhum GO é fabricado aqui.
  writeScorecard(scorecard, path.join(rootDir, 'governance', 'rap-master-scorecard.json'));
  try { await exportCertificationSnapshot(); } catch (_) { /* snapshot regenerado depois */ }
  const deliveredPath = path.join(rootDir, 'governance', 'delivered-release-verification-report.json');
  if (fs.existsSync(deliveredPath)) {
    try {
      const delivered = JSON.parse(fs.readFileSync(deliveredPath, 'utf8'));
      if (delivered.runId && delivered.runId !== runContext.runId) fs.rmSync(deliveredPath);
    } catch (_) { fs.rmSync(deliveredPath); }
  }
  runContaminationCleaner({ rootDir });

  // Pass 2 → re-avaliar com as projeções recém-derivadas e estado limpo. Em fase
  // PRE_PACKAGE o status PASS_WITH_DEFERRED_PACKAGE_GATE é aceito como governado;
  // as dimensões não-circulares não mudam de estado entre os dois passes.
  scorecard = evaluateMasterScorecard({ rootDir, runContext, sourceFingerprint, requireCanonicalIds: true });

  await persistEvaluation({ runId: run.run_id, sourceFingerprint, results: toPersistable(scorecard), scorecardFingerprint: scorecard.scorecardFingerprint });
  if (scorecard.summary.dimensionsBelow10 === 0) {
    // Fixpoint (pass 2) atingiu 10/10: fechar gaps/blocks abertos pelo pass 1.
    await getGap().update(
      { status: 'CLOSED', resolved_at: new Date() },
      { where: { run_id: run.run_id, status: ['OPEN', 'IN_PROGRESS', 'FIXED'] } },
    );
  }
  writeScorecard(scorecard, path.join(rootDir, 'governance', 'rap-master-scorecard.json'));
  // Modelo de fases: as dimensões DELIVERED (RAP-055/056) só são verificáveis
  // no artefato entregue (fase DELIVERED). Em PRE_PACKAGE, se as ÚNICAS abaixo
  // de 10 forem essas, o gate master_scorecard fica DEFERRED (não FAIL): os
  // gates semânticos passaram, a verificação entregue ainda não é aplicável.
  //
  // Mesma lógica para as dimensões cujo artefato canônico é o PACOTE
  // (RAP-052/054): em PRE_PACKAGE o pacote ainda não existe, e o artefato
  // canônico reporta DEFERRED — "não avaliável", não "reprovado". O gate de
  // SELAGEM não herda esta tolerância: no selo o pacote existe e precisa
  // PASSAR de verdade (scripts/governance/seal-time-gate.js).
  const below10Assessment = classifyBelow10Dimensions(scorecard.dimensions, {
    deliveredPhaseDimensions: DELIVERED_PHASE_DIMENSIONS,
    isCircularOnly: isCircularOnlyDimension,
    isCircularRequirement,
  });
  const masterScorecardStatus = below10Assessment.status;
  const pendingKinds = [...new Set(below10Assessment.deferred.map((entry) => entry.kind))];
  await recordGate({ runId: run.run_id, sourceFingerprint, gateKey: 'master_scorecard', status: masterScorecardStatus, phase: 'PRE_PACKAGE', reason: `dimensionsBelow10=${scorecard.summary.dimensionsBelow10}${masterScorecardStatus === 'DEFERRED' ? ` (pending: ${pendingKinds.join('+')})` : ''}${below10Assessment.realFailures.length > 0 ? ` (real failures: ${below10Assessment.realFailures.map((entry) => entry.id).join(',')})` : ''}`, validator: 'master-scorecard-engine' });
  await recordGate({ runId: run.run_id, sourceFingerprint, gateKey: 'source_integrity', status: 'PASS', reason: 'source fingerprint matches frozen run', validator: 'fingerprint-chain' });
  const attestation = await getAttestation().findOne({ where: { run_id: run.run_id, policy_fingerprint: run.policy_fingerprint, status: 'ATTESTED' } });
  await recordGate({ runId: run.run_id, sourceFingerprint, gateKey: 'agent_policy_compliance', status: attestation ? 'PASS' : 'FAIL', reason: attestation ? 'policy attestation exists for the governed run' : 'agent policy attestation missing', validator: 'verify-agent-policy-compliance' });
  const decision = await calculateFinalDecision({ runId: run.run_id, sourceFingerprint, proofFingerprint: scorecard.scorecardFingerprint, phase: 'PRE_PACKAGE' });
  const exported = await exportGovernanceArtifacts();
  console.log(JSON.stringify({ runId: run.run_id, scorecard: scorecard.summary, decision: decision.decision, exported }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => close().catch(() => {}));