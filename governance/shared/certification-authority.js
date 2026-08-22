'use strict';

const { validateArtifactLineage } = require('./artifact-lineage');

const CLOSED_STATUSES = new Set(['PASS', 'PASSED', 'RESOLVED', 'CLOSED', 'DONE', 'NOT_APPLICABLE']);

function gate(gateId, pass, runContext, reason = null, detail = {}) {
  return {
    id: gateId,
    gateId,
    mandatory: true,
    status: pass ? 'PASS' : 'FAIL',
    pass,
    severity: pass ? 'OK' : 'CRITICAL',
    runId: runContext?.runId || null,
    sourceFingerprint: runContext?.sourceFingerprint || null,
    reason: pass ? null : reason,
    ...detail,
  };
}

function lineageGate(gateId, artifact, runContext) {
  const lineage = validateArtifactLineage(artifact, runContext);
  if (!lineage.valid) return gate(gateId, false, runContext, `${lineage.code}: ${lineage.reason}`, { lineage });
  return gate(gateId, true, runContext, null, { lineage });
}

function isOpen(item) {
  if (item == null) return false;
  if (typeof item !== 'object') return true;
  return !CLOSED_STATUSES.has(String(item.status || 'OPEN').toUpperCase());
}

function openItems(items) {
  return Array.isArray(items) ? items.filter(isOpen) : [];
}

function evaluateMasterScorecard(scorecard, runContext) {
  const base = lineageGate('master_scorecard', scorecard, runContext);
  if (!base.pass) return base;
  const dimensions = Array.isArray(scorecard.dimensions) ? scorecard.dimensions : [];
  if (dimensions.length === 0) {
    return gate('master_scorecard', false, runContext, 'INSUFFICIENT_EVIDENCE: scorecard has no dimensions');
  }

  const failures = [];
  for (const dimension of dimensions) {
    const id = dimension?.id || 'UNKNOWN_DIMENSION';
    const score = dimension?.score ?? dimension?.currentScore;
    const target = dimension?.target ?? dimension?.targetScore ?? 10;
    if (!Number.isInteger(score) || score !== 10 || target !== 10) {
      failures.push(`${id}: score=${String(score)} target=${String(target)}`);
    }
    const requirements = Array.isArray(dimension?.requirements) ? dimension.requirements : [];
    if (requirements.length === 0) {
      failures.push(`${id}: mandatory requirements missing`);
    } else {
      const failedRequirements = requirements.filter(
        (requirement) => requirement?.mandatory !== false && requirement?.status !== 'PASS',
      );
      if (failedRequirements.length > 0) {
        failures.push(`${id}: mandatory requirement failures=${failedRequirements.map((r) => r?.id || 'unknown').join(',')}`);
      }
    }
    if (!Array.isArray(dimension?.tests) || dimension.tests.length === 0) {
      failures.push(`${id}: tests missing`);
    }
    if (!Array.isArray(dimension?.runtimeEvidence) || dimension.runtimeEvidence.length === 0) {
      failures.push(`${id}: runtime evidence missing`);
    }
    const blockers = openItems(dimension?.blockers);
    const gaps = openItems(dimension?.gaps);
    if (blockers.length > 0) failures.push(`${id}: open blockers=${blockers.length}`);
    if (gaps.length > 0) failures.push(`${id}: open gaps=${gaps.length}`);
  }

  const topBlockers = openItems(scorecard.blockers);
  const topGaps = openItems(scorecard.gaps);
  if (topBlockers.length > 0) failures.push(`scorecard: open blockers=${topBlockers.length}`);
  if (topGaps.length > 0) failures.push(`scorecard: open gaps=${topGaps.length}`);

  const pass = failures.length === 0;
  return gate(
    'master_scorecard',
    pass,
    runContext,
    pass ? null : `MASTER_SCORECARD_NOT_10_OF_10: ${failures.join(' | ')}`,
    {
      dimensions: dimensions.length,
      dimensionsAt10: dimensions.filter((d) => (d?.score ?? d?.currentScore) === 10).length,
      below10: dimensions.filter((d) => (d?.score ?? d?.currentScore) !== 10).length,
      failures,
    },
  );
}

function evaluateSelfProof(report, runContext) {
  const base = lineageGate('self_proof', report, runContext);
  if (!base.pass) return base;
  const failedGates = report?.selfProofGate?.failedGates;
  const pass = report.pass === true
    && report.selfProofStatus === 'PASS'
    && report.verifierPassed === true
    && report.staleReferencesFound === 0
    && report.staleHashesFound === 0
    && (!Array.isArray(failedGates) || failedGates.length === 0);
  return gate('self_proof', pass, runContext, pass ? null : 'SELF_PROOF_NOT_PASS', {
    selfProofStatus: report.selfProofStatus,
    verifierPassed: report.verifierPassed,
    staleReferencesFound: report.staleReferencesFound,
    staleHashesFound: report.staleHashesFound,
    failedGates: failedGates || [],
  });
}

function evaluateTamperDetection(report, runContext) {
  const base = lineageGate('tamper_detection', report, runContext);
  if (!base.pass) return base;
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const pass = report.pass === true
    && report.decision === 'GO'
    && report.failedChecks === 0
    && checks.length > 0
    && checks.every((check) => check?.pass === true);
  return gate('tamper_detection', pass, runContext, pass ? null : `TAMPER_DETECTION_NOT_PASS: ${report.decision || 'UNKNOWN'}`, {
    decision: report.decision || 'UNKNOWN',
    failedChecks: report.failedChecks,
  });
}

function evaluateFinalProof(report, runContext) {
  const base = lineageGate('final_proof', report, runContext);
  if (!base.pass) return base;
  const fingerprintStatus = report.fingerprintStatus || report.fingerprintChain?.status;
  const pass = report.finalDecision === 'AUTONOMOUS_READY_GO'
    && fingerprintStatus === 'FRESH'
    && report.blockerCount === 0
    && Array.isArray(report.missingArtifacts)
    && report.missingArtifacts.length === 0;
  return gate('final_proof', pass, runContext, pass ? null : `FINAL_PROOF_NOT_PASS: ${report.finalDecision || 'UNKNOWN'}`, {
    decision: report.finalDecision || 'UNKNOWN',
    fingerprintStatus: fingerprintStatus || 'UNKNOWN',
    blockerCount: report.blockerCount,
  });
}

function evaluateFinalReadiness(report, runContext) {
  const base = lineageGate('final_readiness', report, runContext);
  if (!base.pass) return base;
  const decision = report.finalDecision || report.status;
  const blockers = Array.isArray(report.blockingGaps) ? report.blockingGaps : [];
  const pass = decision === 'AUTONOMOUS_READY_GO' && blockers.length === 0;
  return gate('final_readiness', pass, runContext, pass ? null : `FINAL_READINESS_NOT_PASS: ${decision || 'UNKNOWN'}`, {
    decision: decision || 'UNKNOWN',
    blockerCount: blockers.length,
  });
}

function evaluateFinalGovernance(report, runContext) {
  const base = lineageGate('final_governance', report, runContext);
  if (!base.pass) return base;
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const pass = report.finalDecision === 'AUTONOMOUS_READY_GO'
    && report.autonomousReady === true
    && report.allChecksPass === true
    && checks.length > 0
    && checks.every((check) => check?.pass === true || check?.status === 'PASS');
  return gate('final_governance', pass, runContext, pass ? null : `FINAL_GOVERNANCE_NOT_PASS: ${report.finalDecision || 'UNKNOWN'}`);
}

module.exports = {
  gate,
  lineageGate,
  openItems,
  evaluateMasterScorecard,
  evaluateSelfProof,
  evaluateTamperDetection,
  evaluateFinalProof,
  evaluateFinalReadiness,
  evaluateFinalGovernance,
};
