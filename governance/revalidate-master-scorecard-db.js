#!/usr/bin/env node
'use strict';

const { connect, close } = require('../api/db/sequelize');
const getRun = require('../api/db/models/GovernanceRun');
const getEvaluation = require('../api/db/models/ScorecardEvaluation');
const getGate = require('../api/db/models/GovernanceGateResult');
const getGap = require('../api/db/models/GovernanceGap');
const { computeSourceFingerprint, computePolicyFingerprint } = require('./proof-engine/fingerprint-chain');

async function revalidatePersisted() {
  await connect();
  const run = await getRun().findOne({ order: [['created_at', 'DESC']] });
  if (!run) return { status: 'INSUFFICIENT_EVIDENCE', reason: 'governance_run_missing' };
  const evaluation = await getEvaluation().findOne({ where: { run_id: run.run_id }, order: [['created_at', 'DESC']] });
  const gates = await getGate().findAll({ where: { run_id: run.run_id, mandatory: true } });
  const gaps = await getGap().findAll({ where: { run_id: run.run_id, status: ['OPEN', 'IN_PROGRESS', 'FIXED'] } });
  const currentSourceFingerprint = computeSourceFingerprint(process.cwd());
  const currentPolicyFingerprint = computePolicyFingerprint(process.cwd());
  const below10 = evaluation ? evaluation.dimensions_below_10 : 1;
  const failedGates = gates.filter((gate) => gate.status !== 'PASS').length + (gates.length === 0 ? 1 : 0);
  const sourceDrift = run.source_fingerprint !== currentSourceFingerprint;
  const policyDrift = !run.policy_fingerprint || run.policy_fingerprint !== currentPolicyFingerprint;
  const status = run.status === 'INVALIDATED' || sourceDrift || policyDrift || below10 > 0 || failedGates > 0 || gaps.length > 0 ? 'NO_GO' : 'PASS';
  return { status, runId: run.run_id, sourceFingerprint: run.source_fingerprint, currentSourceFingerprint, policyFingerprint: run.policy_fingerprint, currentPolicyFingerprint, sourceDrift, policyDrift, dimensionsBelow10: below10, mandatoryGateFailures: failedGates, openGaps: gaps.length, evaluationPresent: Boolean(evaluation) };
}

if (require.main === module) revalidatePersisted().then((result) => { console.log(JSON.stringify(result)); process.exitCode = result.status === 'PASS' ? 0 : 1; }).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => close().catch(() => {}));

module.exports = { revalidatePersisted };