#!/usr/bin/env node
'use strict';

/**
 * verify-rap-10-of-10.js — verificador final do Master Scorecard a partir do
 * estado canônico persistido (banco). Nenhum JSON legado é lido como autoridade.
 *
 * Sucesso: RAP_MASTER_SCORECARD_VERIFIED + BELOW_10: 0 + exit 0.
 * Falha:   RAP_MASTER_SCORECARD_INVALID + exit 1.
 */

const { connect, close } = require('../api/db/sequelize');
const getRun = require('../api/db/models/GovernanceRun');
const getEvaluation = require('../api/db/models/ScorecardEvaluation');
const getGate = require('../api/db/models/GovernanceGateResult');
const getGap = require('../api/db/models/GovernanceGap');
const getDecision = require('../api/db/models/GovernanceFinalDecision');
const { verify: verifyPolicy } = require('./verify-agent-policy-compliance');

async function verify() {
  await connect();
  const run = await getRun().findOne({ order: [['created_at', 'DESC']] });
  if (!run) return fail('governance_run_missing');

  const evaluation = await getEvaluation().findOne({ where: { run_id: run.run_id }, order: [['created_at', 'DESC']] });
  const gates = await getGate().findAll({ where: { run_id: run.run_id, mandatory: true } });
  const gaps = await getGap().findAll({ where: { run_id: run.run_id, status: ['OPEN', 'IN_PROGRESS', 'FIXED'] } });
  const decision = await getDecision().findOne({ where: { run_id: run.run_id } });

  const below10 = evaluation ? evaluation.dimensions_below_10 : 1;
  const openGaps = gaps.length;
  const openBlockers = evaluation ? evaluation.open_blockers : 1;
  const mandatoryGateFailures = gates.filter((gate) => gate.status !== 'PASS').length + (gates.length === 0 ? 1 : 0);
  const policyCompliance = await verifyPolicy().catch(() => ({ status: 'FAIL', failures: ['policy_compliance_error'] }));

  const valid = run.status !== 'INVALIDATED'
    && below10 === 0
    && openGaps === 0
    && openBlockers === 0
    && mandatoryGateFailures === 0
    && policyCompliance.status === 'PASS'
    && decision?.decision === 'AUTONOMOUS_READY';

  return {
    status: valid ? 'PASS' : 'FAIL',
    runId: run.run_id,
    sourceFingerprint: run.source_fingerprint,
    policyFingerprint: run.policy_fingerprint,
    totalDimensions: evaluation ? evaluation.total_dimensions : 0,
    dimensionsAt10: evaluation ? evaluation.dimensions_at_10 : 0,
    below10,
    openGaps,
    openBlockers,
    mandatoryGateFailures,
    policyCompliance: policyCompliance.status,
    finalDecision: decision?.decision || null,
  };
}

function fail(reason) {
  return { status: 'FAIL', reason, below10: 1, openGaps: 1, openBlockers: 1, mandatoryGateFailures: 1 };
}

if (require.main === module) {
  verify().then((result) => {
    console.log(result.status === 'PASS' ? 'RAP_MASTER_SCORECARD_VERIFIED' : 'RAP_MASTER_SCORECARD_INVALID');
    console.log(`TOTAL_DIMENSIONS: ${result.totalDimensions ?? 78}`);
    console.log(`10_OF_10: ${result.dimensionsAt10 ?? 0}`);
    console.log(`BELOW_10: ${result.below10}`);
    console.log(`OPEN_GAPS: ${result.openGaps}`);
    console.log(`OPEN_BLOCKERS: ${result.openBlockers}`);
    console.log(`MANDATORY_GATE_FAILURES: ${result.mandatoryGateFailures}`);
    console.log(`POLICY_COMPLIANCE: ${result.policyCompliance}`);
    console.log(`FINAL_DECISION: ${result.finalDecision || 'NO_GO'}`);
    process.exitCode = result.status === 'PASS' ? 0 : 1;
  }).catch((error) => {
    console.error(`RAP_MASTER_SCORECARD_INVALID: ${error.message}`);
    process.exitCode = 1;
  }).finally(() => close().catch(() => {}));
}

module.exports = { verify };
