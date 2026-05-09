'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  validateReplayIntegrity,
  computeGovernanceSignature,
} = require('../../../api/services/qa/replayIntegrityService');

const DEFAULT_THRESHOLD = 95;

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = stable(value[key]);
    return acc;
  }, {});
}

function gradeConfidence(score) {
  if (score >= 98) return 'A+';
  if (score >= 95) return 'A';
  if (score >= 90) return 'B';
  if (score >= 80) return 'C';
  return 'D';
}

function riskLevel(score) {
  if (score >= 95) return 'LOW';
  if (score >= 90) return 'MEDIUM';
  if (score >= 80) return 'HIGH';
  return 'CRITICAL';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectFlowProofs(flow = {}) {
  const replay = flow.replay || {};
  const steps = asArray(replay.steps);
  const failedSteps = steps.filter((step) => step?.status === 'failed');
  const missingEvidence = steps.flatMap((step) =>
    asArray(step?.missingEvidence).map((field) => ({
      stepId: step.id || step.stepId || 'unknown',
      field,
    }))
  );
  const blockers = [
    ...asArray(flow.governance?.blockers),
    ...asArray(flow.strictGovernance?.blockers),
    ...asArray(flow.audit?.blockers),
  ];
  const mutationalSteps = steps.filter((step) => step?.semanticContract?.mutationExpected === true || step?.mutationExpected === true);
  const mutationProofFailures = mutationalSteps.filter((step) => {
    const postState = step.postStateProof || {};
    const provenance = asArray(step.mutationProvenance).length > 0
      ? asArray(step.mutationProvenance)
      : asArray(postState.mutationProvenance);
    const missingMutations = asArray(postState.missingMutations);
    const missingSideEffects = asArray(postState.missingSideEffects);
    return postState.valid === false
      || missingMutations.length > 0
      || missingSideEffects.length > 0
      || provenance.some((record) => record?.valid !== true);
  });
  const provenanceMismatches = [];
  for (const step of steps) {
    const expectedActionType = step?.semanticContract?.actionType || step?.actionType || null;
    for (const record of asArray(step?.mutationProvenance)) {
      if (record?.originatingActionType && expectedActionType && record.originatingActionType !== expectedActionType) {
        provenanceMismatches.push({
          stepId: step.id || step.stepId || 'unknown',
          expectedActionType,
          actualActionType: record.originatingActionType,
        });
      }
    }
  }
  for (const record of asArray(replay.postStateSummary?.mutationProvenance)) {
    const step = steps.find((item) => (item.id || item.stepId) === record?.originatingStepId);
    const expectedActionType = step?.semanticContract?.actionType || step?.actionType || null;
    if (record?.originatingActionType && expectedActionType && record.originatingActionType !== expectedActionType) {
      provenanceMismatches.push({
        stepId: record.originatingStepId,
        expectedActionType,
        actualActionType: record.originatingActionType,
      });
    }
  }

  return {
    failedSteps,
    missingEvidence,
    blockers,
    mutationProofFailures,
    provenanceMismatches,
  };
}

function calculateOperationalConfidence({
  smokePassed,
  replayIntegrityRate,
  mutationConsistencyRate,
  provenanceConsistencyRate,
  replayHealthRate,
  governanceConsistencyRate,
  runtimeStabilityRate,
  evidenceCompletenessRate,
}) {
  const weighted =
    smokePassed * 0.18
    + replayIntegrityRate * 0.16
    + mutationConsistencyRate * 0.14
    + provenanceConsistencyRate * 0.14
    + replayHealthRate * 0.12
    + governanceConsistencyRate * 0.12
    + runtimeStabilityRate * 0.06
    + evidenceCompletenessRate * 0.08;
  return Number(Math.max(0, Math.min(100, weighted)).toFixed(1));
}

function buildQaWavesEnterpriseGovernance(options = {}) {
  const root = options.root || process.cwd();
  const prodLikePath = options.prodLikePath || path.join(root, 'qa', 'smoke', 'prod-like', 'qa-waves-operational-prod-like-smoke.json');
  const scheduledPath = options.scheduledPath || path.join(root, 'qa', 'smoke', 'qa-waves-scheduled-operational-smoke.json');
  const threshold = Number(options.threshold || process.env.QA_WAVES_OPERATIONAL_CONFIDENCE_THRESHOLD || DEFAULT_THRESHOLD);
  const prodLike = options.prodLike || readJson(prodLikePath);
  const scheduled = options.scheduled || readJson(scheduledPath);
  const flows = asArray(prodLike?.flows);

  const replayArtifacts = [];
  const allBlockers = [];
  const failedProofs = [];
  const integrityResults = [];
  const governanceSignatures = [];
  let mutationFailures = 0;
  let provenanceMismatches = 0;
  let missingEvidenceCount = 0;

  for (const flow of flows) {
    const replay = flow.replay || {};
    const governance = replay.governance || flow.governance || {};
    const integrity = validateReplayIntegrity(replay, governance);
    integrityResults.push(integrity);
    replayArtifacts.push({
      journeyId: flow.journeyId,
      replayHash: replay.replayHash || null,
      replayChecksum: replay.replayChecksum || null,
      governanceSignature: replay.governanceSignature || null,
      tenantId: replay.tenantId || null,
      smokeExecutionId: replay.smokeExecutionId || null,
    });
    governanceSignatures.push({
      journeyId: flow.journeyId,
      valid: integrity.governanceSignature === replay.governanceSignature,
      expected: integrity.governanceSignature,
      actual: replay.governanceSignature || null,
    });

    const proofs = collectFlowProofs(flow);
    mutationFailures += proofs.mutationProofFailures.length;
    provenanceMismatches += proofs.provenanceMismatches.length;
    missingEvidenceCount += proofs.missingEvidence.length;
    allBlockers.push(...proofs.blockers.map((blocker) => ({ journeyId: flow.journeyId, ...blocker })));
    failedProofs.push(
      ...proofs.failedSteps.map((step) => ({ journeyId: flow.journeyId, stepId: step.id || step.stepId || 'unknown', reason: 'failed_step' })),
      ...proofs.missingEvidence.map((item) => ({ journeyId: flow.journeyId, ...item, reason: 'missing_evidence' })),
      ...proofs.mutationProofFailures.map((step) => ({ journeyId: flow.journeyId, stepId: step.id || step.stepId || 'unknown', reason: 'failed_mutation_proof' })),
      ...proofs.provenanceMismatches.map((item) => ({ journeyId: flow.journeyId, ...item, reason: 'provenance_mismatch' }))
    );
  }

  const flowCount = Math.max(flows.length, 1);
  const validIntegrityCount = integrityResults.filter((item) => item.valid).length;
  const validSignatures = governanceSignatures.filter((item) => item.valid).length;
  const smokePassed = prodLike?.status === 'GO' && prodLike?.productionReadiness?.decision === 'GO' ? 100 : 0;
  const continuousHealthy = scheduled?.status === 'GO';
  const replayIntegrityRate = (validIntegrityCount / flowCount) * 100;
  const mutationConsistencyRate = mutationFailures === 0 ? 100 : Math.max(0, 100 - mutationFailures * 25);
  const provenanceConsistencyRate = provenanceMismatches === 0 ? 100 : Math.max(0, 100 - provenanceMismatches * 25);
  const replayHealthRate = failedProofs.length === 0 ? 100 : Math.max(0, 100 - failedProofs.length * 15);
  const governanceConsistencyRate = allBlockers.length === 0 && validSignatures === governanceSignatures.length ? 100 : 75;
  const runtimeStabilityRate = continuousHealthy ? 100 : 70;
  const evidenceCompletenessRate = missingEvidenceCount === 0 ? 100 : Math.max(0, 100 - missingEvidenceCount * 10);
  const operationalConfidence = calculateOperationalConfidence({
    smokePassed,
    replayIntegrityRate,
    mutationConsistencyRate,
    provenanceConsistencyRate,
    replayHealthRate,
    governanceConsistencyRate,
    runtimeStabilityRate,
    evidenceCompletenessRate,
  });

  const activeBlockers = [
    ...allBlockers,
    ...integrityResults.flatMap((result, index) =>
      asArray(result.blockers).map((blocker) => ({
        journeyId: flows[index]?.journeyId || 'unknown',
        ...blocker,
      }))
    ),
  ];
  if (!continuousHealthy) {
    activeBlockers.push({ reason: 'continuous_smoke_degraded', status: scheduled?.status || 'missing' });
  }
  if (operationalConfidence < threshold) {
    activeBlockers.push({ reason: 'operational_confidence_degraded', threshold, operationalConfidence });
  }

  const governanceStatus = (
    smokePassed === 100
    && replayIntegrityRate === 100
    && validSignatures === governanceSignatures.length
    && failedProofs.length === 0
    && activeBlockers.length === 0
    && continuousHealthy
    && operationalConfidence >= threshold
  ) ? 'GO' : 'NO_GO';

  const report = {
    generatedAt: new Date().toISOString(),
    status: governanceStatus,
    governanceStatus,
    threshold,
    replayIntegrity: {
      valid: replayIntegrityRate === 100,
      rate: Number(replayIntegrityRate.toFixed(1)),
      artifacts: replayArtifacts,
      blockers: integrityResults.flatMap((item) => item.blockers || []),
    },
    smokeHealth: {
      status: prodLike?.status || 'missing',
      productionReadiness: prodLike?.productionReadiness?.decision || 'missing',
      healthy: smokePassed === 100,
      evidencePath: prodLikePath,
    },
    operationalConfidence,
    confidenceGrade: gradeConfidence(operationalConfidence),
    riskLevel: riskLevel(operationalConfidence),
    failedProofs,
    activeBlockers,
    replayArtifacts,
    governanceSignature: {
      valid: validSignatures === governanceSignatures.length,
      signatures: governanceSignatures,
    },
    lastSmokeExecution: {
      generatedAt: prodLike?.generatedAt || null,
      evidencePath: prodLikePath,
      tenantId: replayArtifacts.find((item) => item.tenantId)?.tenantId || null,
    },
    continuousValidationStatus: {
      status: scheduled?.status || 'missing',
      healthy: continuousHealthy,
      evidencePath: scheduledPath,
      mode: scheduled?.scheduledMode?.id || scheduled?.mode || null,
      generatedAt: scheduled?.generatedAt || null,
    },
    releaseReadiness: {
      go: governanceStatus === 'GO',
      reasons: [],
    },
    deploymentSafety: {
      deployAllowed: governanceStatus === 'GO',
      threshold,
      operationalConfidence,
      blockers: activeBlockers,
    },
  };
  report.enterpriseGovernanceSignature = computeGovernanceSignature(report, {
    goNoGo: governanceStatus,
    isOperational: governanceStatus === 'GO',
    blockers: activeBlockers,
  });
  report.reportHash = sha256(JSON.stringify(stable(report)));
  return report;
}

function validateQaWavesEnterpriseGovernance(report = {}, options = {}) {
  const threshold = Number(options.threshold || report.threshold || DEFAULT_THRESHOLD);
  const reasons = [];
  if (!report || typeof report !== 'object') reasons.push('qa_waves_governance_missing');
  if (report.governanceStatus !== 'GO') reasons.push('qa_waves_status_not_go');
  if (report.replayIntegrity?.valid !== true) reasons.push('qa_waves_replay_integrity_invalid');
  if (report.governanceSignature?.valid !== true) reasons.push('qa_waves_governance_signature_invalid');
  if (asArray(report.failedProofs).length > 0) reasons.push('qa_waves_failed_proofs');
  if (asArray(report.activeBlockers).length > 0) reasons.push('qa_waves_active_blockers');
  if (report.continuousValidationStatus?.healthy !== true) reasons.push('qa_waves_continuous_smoke_degraded');
  if (Number(report.operationalConfidence || 0) < threshold) reasons.push('qa_waves_operational_confidence_degraded');
  return {
    valid: reasons.length === 0,
    reasons,
    threshold,
    operationalConfidence: Number(report.operationalConfidence || 0),
  };
}

function appendGovernanceAuditTrail(report = {}, auditPath) {
  if (!auditPath) return null;
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  let previousEntryHash = null;
  if (fs.existsSync(auditPath)) {
    const lines = fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length > 0) {
      try {
        previousEntryHash = JSON.parse(lines[lines.length - 1]).entryHash || null;
      } catch {
        previousEntryHash = sha256(lines[lines.length - 1]);
      }
    }
  }
  const entry = {
    generatedAt: new Date().toISOString(),
    decision: report.governanceStatus || 'NO_GO',
    governanceSignature: report.enterpriseGovernanceSignature || null,
    replayArtifacts: report.replayArtifacts || [],
    lastSmokeExecution: report.lastSmokeExecution || null,
    deploymentSafety: report.deploymentSafety || null,
    previousEntryHash,
  };
  entry.entryHash = sha256(JSON.stringify(stable(entry)));
  fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

function writeQaWavesEnterpriseGovernance(report, outputPath, auditPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const auditEntry = appendGovernanceAuditTrail(report, auditPath);
  const persisted = {
    ...report,
    auditTrail: auditEntry ? {
      path: auditPath,
      latestEntryHash: auditEntry.entryHash,
      immutable: true,
    } : report.auditTrail || null,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
  return persisted;
}

module.exports = {
  DEFAULT_THRESHOLD,
  buildQaWavesEnterpriseGovernance,
  validateQaWavesEnterpriseGovernance,
  writeQaWavesEnterpriseGovernance,
  appendGovernanceAuditTrail,
  calculateOperationalConfidence,
};
