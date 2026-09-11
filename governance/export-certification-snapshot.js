#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { connect, close } = require('../api/db/sequelize');
const getRun = require('../api/db/models/GovernanceRun');
const getEvaluation = require('../api/db/models/ScorecardEvaluation');
const getGate = require('../api/db/models/GovernanceGateResult');
const getGap = require('../api/db/models/GovernanceGap');
const getDecision = require('../api/db/models/GovernanceFinalDecision');
const getManifest = require('../api/db/models/ReleaseManifestRecord');
const { fingerprintObject } = require('../qa/coverage/fingerprints');

async function exportCertificationSnapshot({ outputPath = path.join(process.cwd(), 'governance', 'certification-snapshot.json') } = {}) {
  await connect();
  const run = await getRun().findOne({ order: [['created_at', 'DESC']] });
  if (!run) throw new Error('governance_run_missing');
  const evaluation = await getEvaluation().findOne({ where: { run_id: run.run_id }, order: [['created_at', 'DESC']] });
  const gates = await getGate().findAll({ where: { run_id: run.run_id }, order: [['gate_key', 'ASC']] });
  const gaps = await getGap().findAll({ where: { run_id: run.run_id }, order: [['gap_key', 'ASC']] });
  const decision = await getDecision().findOne({ where: { run_id: run.run_id } });
  const manifest = await getManifest().findOne({ where: { run_id: run.run_id }, order: [['created_at', 'DESC']] });

  // Lineage transacional: TODO registro participante do snapshot deve declarar o
  // MESMO sourceFingerprint/policyFingerprint do run. Divergência (mixed lineage)
  // é estruturalmente impossível de certificar → bloqueia o export.
  const lineageViolations = [];
  const checkLineage = (label, record) => {
    if (!record) return;
    if (record.source_fingerprint != null && record.source_fingerprint !== run.source_fingerprint) {
      lineageViolations.push({ record: label, field: 'sourceFingerprint', expected: run.source_fingerprint, actual: record.source_fingerprint });
    }
    if (run.policy_fingerprint != null && record.policy_fingerprint != null && record.policy_fingerprint !== run.policy_fingerprint) {
      lineageViolations.push({ record: label, field: 'policyFingerprint', expected: run.policy_fingerprint, actual: record.policy_fingerprint });
    }
  };
  checkLineage('evaluation', evaluation);
  gates.forEach((gate) => checkLineage(`gate:${gate.gate_key}`, gate));
  gaps.forEach((gap) => checkLineage(`gap:${gap.gap_key}`, gap));
  checkLineage('decision', decision);
  checkLineage('manifest', manifest);

  if (lineageViolations.length > 0) {
    const error = new Error(`CERTIFICATION_SNAPSHOT_LINEAGE_INVALID: ${JSON.stringify(lineageViolations)}`);
    error.code = 'CERTIFICATION_SNAPSHOT_LINEAGE_INVALID';
    error.lineageViolations = lineageViolations;
    throw error;
  }

  const snapshot = { schema: 'rap-certification-snapshot/v1', artifactType: 'certification-snapshot', artifactVersion: '1.0.0', generatedAt: new Date().toISOString(), runId: run.run_id, sourceFingerprint: run.source_fingerprint, policyId: run.policy_id, policyVersion: run.policy_version, policyFingerprint: run.policy_fingerprint, runStatus: run.status, scorecard: evaluation ? { evaluationId: evaluation.id, scorecardFingerprint: evaluation.scorecard_fingerprint, totalDimensions: evaluation.total_dimensions, dimensionsAt10: evaluation.dimensions_at_10, dimensionsBelow10: evaluation.dimensions_below_10, openGaps: evaluation.open_gaps, openBlockers: evaluation.open_blockers } : null, mandatoryGates: gates.map((gate) => ({ gateKey: gate.gate_key, status: gate.status, mandatory: gate.mandatory, sourceFingerprint: gate.source_fingerprint })), gaps: gaps.map((gap) => ({ gapKey: gap.gap_key, severity: gap.severity, status: gap.status, dimensionId: gap.dimension_id, requirementId: gap.requirement_id })), finalDecision: decision ? { decision: decision.decision, reason: decision.reason, mandatoryGateFailures: decision.mandatory_gate_failures, scorecardBelow10: decision.scorecard_below_10, sourceFingerprint: decision.source_fingerprint } : null, releaseManifest: manifest ? { releaseId: manifest.release_id, status: manifest.status, packageFingerprint: manifest.package_fingerprint } : null };
  snapshot.snapshotFingerprint = fingerprintObject({ ...snapshot, generatedAt: null, snapshotFingerprint: null });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, outputPath);
  return snapshot;
}

if (require.main === module) exportCertificationSnapshot().then((snapshot) => console.log(JSON.stringify({ runId: snapshot.runId, decision: snapshot.finalDecision?.decision || 'NO_GO', snapshotFingerprint: snapshot.snapshotFingerprint }))).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => close().catch(() => {}));

module.exports = { exportCertificationSnapshot };