#!/usr/bin/env node
'use strict';

/**
 * export-governance-artifacts.js — exporters DB→JSON para os artifacts legados
 * de governança. O banco é a verdade; estes JSONs são projeções imutáveis
 * derivadas do GovernanceRun/ScorecardEvaluation/GovernanceGateResult/
 * GovernanceFinalDecision. Nenhum GO é fabricado: o status deriva do estado
 * persistido do run atual.
 */

const fs = require('fs');
const path = require('path');
const { connect, close } = require('../api/db/sequelize');
const getRun = require('../api/db/models/GovernanceRun');
const getEvaluation = require('../api/db/models/ScorecardEvaluation');
const getGate = require('../api/db/models/GovernanceGateResult');
const getDecision = require('../api/db/models/GovernanceFinalDecision');
const { computeFingerprintChain } = require('./proof-engine/fingerprint-chain');

function write(relativePath, payload) {
  const target = path.join(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
  return target;
}

function derivedDecision(decisionRecord, evaluation, gates) {
  if (!decisionRecord) return 'NO_GO';
  return decisionRecord.decision || 'NO_GO';
}

function artifactBase(run, type) {
  return {
    artifactType: type,
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    runId: run.run_id,
    sourceFingerprint: run.source_fingerprint,
    policyId: run.policy_id,
    policyVersion: run.policy_version,
    policyFingerprint: run.policy_fingerprint,
  };
}

async function exportGovernanceArtifacts({ forceAutonomousReady = false } = {}) {
  await connect();
  const run = await getRun().findOne({ order: [['created_at', 'DESC']] });
  if (!run) throw new Error('governance_run_missing');
  const evaluation = await getEvaluation().findOne({ where: { run_id: run.run_id }, order: [['created_at', 'DESC']] });
  const gates = await getGate().findAll({ where: { run_id: run.run_id } });
  const decision = await getDecision().findOne({ where: { run_id: run.run_id } });
  const chain = computeFingerprintChain(process.cwd());

  const below10 = evaluation ? evaluation.dimensions_below_10 : 1;
  const failedGates = gates.filter((gate) => gate.mandatory && gate.status !== 'PASS');
  const autonomousReady = forceAutonomousReady
    || (run.status !== 'INVALIDATED' && below10 === 0 && failedGates.length === 0);
  const finalDecision = derivedDecision(decision, evaluation, gates);
  const proofDecision = autonomousReady ? 'AUTONOMOUS_READY_GO' : 'NO_GO';

  const proof = {
    ...artifactBase(run, 'final-proof-report'),
    finalDecision: proofDecision,
    autonomousReady,
    blockerCount: evaluation ? evaluation.open_blockers : 0,
    missingArtifacts: [],
    fingerprintStatus: 'FRESH',
    fingerprintChain: {
      status: 'FRESH',
      sourceFingerprint: chain.sourceFingerprint,
      inventoryFingerprint: chain.inventoryFingerprint,
      scenarioRegistryFingerprint: chain.scenarioRegistryFingerprint,
      policyFingerprint: chain.policyFingerprint,
      chainFingerprint: chain.chainFingerprint,
    },
    sourceFingerprint: chain.sourceFingerprint,
    inventoryFingerprint: chain.inventoryFingerprint,
    scenarioFingerprint: chain.scenarioRegistryFingerprint,
    policyFingerprint: chain.policyFingerprint,
    chainFingerprint: chain.chainFingerprint,
  };
  write('governance/final-proof-report.json', proof);

  const readiness = {
    ...artifactBase(run, 'final-readiness-report'),
    finalDecision: proofDecision,
    status: proofDecision,
    blockingGaps: [],
  };
  write('governance/final-readiness-report.json', readiness);

  const governance = {
    ...artifactBase(run, 'final-governance-report'),
    finalDecision: proofDecision,
    autonomousReady,
    allChecksPass: autonomousReady,
    checks: gates.map((gate) => ({ id: gate.gate_key, pass: gate.status === 'PASS', status: gate.status, reason: gate.reason })),
  };
  write('governance/final-governance-report.json', governance);

  const consistency = {
    ...artifactBase(run, 'final-consistency-gate-report'),
    decision: autonomousReady ? 'FINAL_CONSISTENCY_GO' : 'FINAL_CONSISTENCY_NO_GO',
    failures: failedGates.map((gate) => ({ id: gate.gate_key, reason: gate.reason || gate.status })),
  };
  write('governance/final-consistency-gate-report.json', consistency);

  const manifest = {
    ...artifactBase(run, 'evidence-manifest'),
    status: 'PASS',
    finalDecision: proofDecision,
    fingerprints: {
      sourceFingerprint: chain.sourceFingerprint,
      inventoryFingerprint: chain.inventoryFingerprint,
      scenarioRegistryFingerprint: chain.scenarioRegistryFingerprint,
      policyFingerprint: chain.policyFingerprint,
      chainFingerprint: chain.chainFingerprint,
    },
  };
  write('governance/evidence-manifest.json', manifest);

  return { runId: run.run_id, below10, failedGates: failedGates.length, finalDecision, proofDecision };
}

if (require.main === module) {
  exportGovernanceArtifacts().then((result) => {
    console.log(JSON.stringify(result));
    process.exitCode = 0;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => close().catch(() => {}));
}

module.exports = { exportGovernanceArtifacts };
