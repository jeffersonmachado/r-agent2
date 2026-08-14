'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, failIfNeeded, readJson, statusFromIssues, writeReport } = require('./common');
const {
  buildQaWavesEnterpriseGovernance,
  validateQaWavesEnterpriseGovernance,
} = require('../../tools/system/lib/qa-waves-enterprise-governance-bridge');

const DEFAULT_CANONICAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function validateCanonicalEvidence({
  mesh,
  promotion,
  root = ROOT,
  now = Date.now(),
  maxAgeMs = DEFAULT_CANONICAL_MAX_AGE_MS,
} = {}) {
  const issues = [];
  const executionId = String(mesh?.executionId || promotion?.executionId || '').trim();

  if (mesh?.isCanonicalExecution !== true) {
    issues.push({
      code: 'qa_mesh_not_canonical',
      message: 'QA Mesh GO não está marcado como execução canônica.',
    });
  }

  if (!executionId) {
    issues.push({ code: 'qa_canonical_execution_missing', message: 'Canonical QA Mesh executionId is missing.' });
    return { issues, executionId: null, historyPath: null, history: null };
  }

  if (!promotion || promotion.executionId !== executionId) {
    issues.push({
      code: 'qa_canonical_promotion_mismatch',
      executionId,
      promotedExecutionId: promotion?.executionId || null,
      message: 'Canonical promotion does not match the QA Mesh GO execution.',
    });
  }

  const expectedHistoryPath = path.join(root, 'qa-mesh', 'meshHistory', `${executionId}.json`);
  const declaredHistoryName = promotion?.historyPath ? path.basename(String(promotion.historyPath)) : null;
  if (declaredHistoryName && declaredHistoryName !== `${executionId}.json`) {
    issues.push({
      code: 'qa_canonical_history_reference_mismatch',
      historyPath: promotion.historyPath,
      message: 'Canonical promotion historyPath does not match executionId.',
    });
  }

  if (!fs.existsSync(expectedHistoryPath)) {
    issues.push({
      code: 'qa_canonical_history_missing',
      historyPath: expectedHistoryPath,
      message: `Canonical QA Mesh history is missing: ${path.relative(root, expectedHistoryPath)}.`,
    });
    return { issues, executionId, historyPath: expectedHistoryPath, history: null };
  }

  const history = loadJsonFile(expectedHistoryPath);
  if (!history) {
    issues.push({
      code: 'qa_canonical_history_invalid',
      historyPath: expectedHistoryPath,
      message: 'Canonical QA Mesh history is not valid JSON.',
    });
    return { issues, executionId, historyPath: expectedHistoryPath, history: null };
  }

  const historyExecutionId = history.executionId || history.summary?.executionId || null;
  if (historyExecutionId !== executionId) {
    issues.push({
      code: 'qa_canonical_history_execution_mismatch',
      executionId,
      historyExecutionId,
      message: 'Canonical QA Mesh history belongs to a different execution.',
    });
  }

  const historyCanonical = history.isCanonicalExecution === true || history.summary?.isCanonicalExecution === true;
  if (!historyCanonical) {
    issues.push({
      code: 'qa_canonical_history_not_canonical',
      message: 'Canonical QA Mesh history is not marked as canonical.',
    });
  }

  const historyDecision = String(history.summary?.goNoGo || history.governance?.goNoGo || '');
  if (historyDecision !== 'GO') {
    issues.push({
      code: 'qa_canonical_history_no_go',
      status: historyDecision || 'missing',
      message: `Canonical QA Mesh history is not GO: ${historyDecision || 'missing'}.`,
    });
  }

  const expectedTotal = Number(mesh?.totals?.registryTotal || promotion?.registryTotal || 0);
  const historyTotal = Number(history.summary?.registryTotal || history.governance?.registryTotal || 0);
  if (!expectedTotal || historyTotal !== expectedTotal) {
    issues.push({
      code: 'qa_canonical_history_registry_mismatch',
      expectedTotal,
      historyTotal,
      message: 'Canonical QA Mesh history registry total does not match the promoted summary.',
    });
  }

  const evidenceTimestamp = Date.parse(
    promotion?.promotedAt || history.finishedAt || history.summary?.timestamp || history.startedAt || ''
  );
  if (!Number.isFinite(evidenceTimestamp)) {
    issues.push({
      code: 'qa_canonical_history_timestamp_invalid',
      message: 'Canonical QA Mesh history has no valid evidence timestamp.',
    });
  } else {
    const ageMs = now - evidenceTimestamp;
    if (ageMs < -5 * 60 * 1000) {
      issues.push({
        code: 'qa_canonical_history_from_future',
        ageMs,
        message: 'Canonical QA Mesh evidence timestamp is in the future.',
      });
    } else if (ageMs > maxAgeMs) {
      issues.push({
        code: 'qa_canonical_history_stale',
        ageMs,
        maxAgeMs,
        message: 'Canonical QA Mesh history is stale and must be regenerated.',
      });
    }
  }

  return { issues, executionId, historyPath: expectedHistoryPath, history };
}

function main() {
  const issues = [];
  const warnings = [];
  const mesh = readJson('qa-mesh/go-no-go-report.json', {});
  const readiness = readJson('governance/final-readiness-report.json', {});
  const promotion = readJson('qa-mesh/canonical-promotion.json', null);
  const status = String(mesh.status || mesh.goNoGo || readiness.qaCoverage?.status || '');

  if (status !== 'GO') {
    issues.push({ code: 'qa_mesh_no_go', status, reasons: mesh.reasons || [], message: `QA Mesh is not GO: ${status || 'missing'}.` });
  }

  const totals = mesh.totals || {};
  if (Number(totals.failed || 0) > 0 || Number(totals.infraErrors || 0) > 0) {
    issues.push({
      code: 'qa_mesh_failures_present',
      failed: totals.failed || 0,
      infraErrors: totals.infraErrors || 0,
      message: `QA Mesh has ${totals.failed || 0} failures and ${totals.infraErrors || 0} infra errors.`,
    });
  }

  const canonicalMaxAgeMs = parsePositiveNumber(
    process.env.QA_GOVERNANCE_CANONICAL_MAX_AGE_MS,
    DEFAULT_CANONICAL_MAX_AGE_MS
  );
  const canonicalEvidence = validateCanonicalEvidence({ mesh, promotion, maxAgeMs: canonicalMaxAgeMs });
  issues.push(...canonicalEvidence.issues);

  const qaWavesEnterprise = buildQaWavesEnterpriseGovernance({ root: ROOT });
  const qaWavesValidation = validateQaWavesEnterpriseGovernance(qaWavesEnterprise);
  if (!qaWavesValidation.valid) {
    issues.push({
      code: 'qa_waves_enterprise_governance_no_go',
      status: qaWavesEnterprise.governanceStatus || 'missing',
      reasons: qaWavesValidation.reasons,
      evidenceReasons: qaWavesEnterprise.continuousValidationStatus?.reasons || [],
      message: `QA Waves enterprise governance is not ready: ${qaWavesValidation.reasons.join(', ')}.`,
    });
  }

  const blockingDomains = readiness.qaCoverage?.blockingDomains || mesh.totals?.blockingDomains || [];
  if (blockingDomains.length > 0) {
    warnings.push({ code: 'qa_blocking_domains', blockingDomains, message: `Blocking domains: ${blockingDomains.join(', ')}.` });
  }

  const report = {
    name: 'validate-qa-governance',
    status: statusFromIssues(issues),
    qaStatus: status || null,
    executionId: mesh.executionId || totals.executionId || null,
    canonicalHistoryPath: canonicalEvidence.historyPath,
    canonicalMaxAgeMs,
    qaWavesEnterprise: {
      status: qaWavesEnterprise.governanceStatus,
      operationalConfidence: qaWavesEnterprise.operationalConfidence,
      valid: qaWavesValidation.valid,
      reasons: qaWavesValidation.reasons,
      continuousValidation: qaWavesEnterprise.continuousValidationStatus,
    },
    totals,
    blockingDomains,
    issues,
    warnings,
    suggestions: issues.concat(warnings).map((entry) => entry.message),
  };

  writeReport('qa-governance-validation-report.json', report);
  failIfNeeded(report);
  return report;
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_CANONICAL_MAX_AGE_MS,
  main,
  validateCanonicalEvidence,
};
