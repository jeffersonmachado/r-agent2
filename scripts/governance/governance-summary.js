'use strict';

const fs = require('fs');
const path = require('path');
const { REPORTS_DIR, readJson, writeReport } = require('./common');

const DEFAULT_REPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const DIMENSIONS = Object.freeze([
  { key: 'architectureConsistency', file: 'ai-memory-validation-report.json', accepted: ['PASS'] },
  { key: 'runtimeValidation', file: 'runtime-routes-validation-report.json', accepted: ['PASS'] },
  { key: 'qaGovernance', file: 'qa-governance-validation-report.json', accepted: ['PASS'] },
  { key: 'replayIntegrity', file: 'replay-governance-validation-report.json', accepted: ['PASS'] },
  { key: 'releaseHardening', file: 'release-governance-validation-report.json', accepted: ['PASS'] },
  { key: 'agentAdherence', file: 'agent-adherence-report.json', accepted: ['PASS'] },
  { key: 'selfProving', file: 'self-proving-report.json', accepted: ['PASS'] },
  {
    key: 'visibilityPolicy',
    file: 'visibility-policy-report.json',
    accepted: ['PASS'],
    timestampFields: ['generatedAt', 'checkedAt'],
  },
  {
    key: 'coverageGate',
    file: 'coverage-gate-report.json',
    accepted: ['GO'],
    validate(report) {
      return report?.releaseGate?.decision === 'GO' ? null : 'coverage_release_gate_not_go';
    },
  },
  {
    key: 'ragDomainSegregation',
    file: 'rag-domain-segregation-report.json',
    accepted: ['PASS'],
    validate(report) {
      if (report?.probes?.serviceReachable !== true) return 'rag_runtime_unreachable';
      const requiredProbes = [
        'crossDomainLeakage',
        'crossTenantLeakage',
        'operationalAccessToSystemDomain',
      ];
      if (requiredProbes.some((key) => typeof report.probes?.[key] !== 'number')) {
        return 'rag_runtime_probes_incomplete';
      }
      return null;
    },
  },
]);

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function reportTimestamp(report, fields = ['generatedAt']) {
  for (const field of fields) {
    const parsed = Date.parse(report?.[field] || '');
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

function evaluateDimension(spec, report, { now, maxAgeMs }) {
  if (!report || typeof report !== 'object') {
    return { score: 0, status: 'MISSING', sourceStatus: null, reason: 'report_missing' };
  }

  const sourceStatus = String(report.status || '').toUpperCase();
  if (!spec.accepted.includes(sourceStatus)) {
    return { score: 0, status: 'FAIL', sourceStatus, reason: 'source_status_not_accepted' };
  }

  const timestamp = reportTimestamp(report, spec.timestampFields);
  if (!Number.isFinite(timestamp)) {
    return { score: 0, status: 'STALE', sourceStatus, reason: 'report_timestamp_missing' };
  }

  const ageMs = now - timestamp;
  if (ageMs < -5 * 60 * 1000) {
    return { score: 0, status: 'STALE', sourceStatus, reason: 'report_timestamp_from_future', ageMs };
  }
  if (ageMs > maxAgeMs) {
    return { score: 0, status: 'STALE', sourceStatus, reason: 'report_stale', ageMs };
  }

  const semanticFailure = typeof spec.validate === 'function' ? spec.validate(report) : null;
  if (semanticFailure) {
    return { score: 0, status: 'FAIL', sourceStatus, reason: semanticFailure, ageMs };
  }

  return { score: 100, status: 'PASS', sourceStatus, reason: null, ageMs };
}

function buildGovernanceScore({
  reader = (file) => readJson(`reports/${file}`, null),
  now = Date.now(),
  maxAgeMs = positiveNumber(process.env.GOVERNANCE_SUMMARY_REPORT_MAX_AGE_MS, DEFAULT_REPORT_MAX_AGE_MS),
} = {}) {
  const evaluations = {};
  const scores = {};
  const statuses = {};
  const sourceStatuses = {};
  const issues = [];

  for (const spec of DIMENSIONS) {
    const evaluation = evaluateDimension(spec, reader(spec.file), { now, maxAgeMs });
    evaluations[spec.key] = { file: `reports/${spec.file}`, ...evaluation };
    scores[spec.key] = evaluation.score;
    statuses[spec.key] = evaluation.status;
    sourceStatuses[spec.key] = evaluation.sourceStatus;
    if (evaluation.status !== 'PASS') {
      issues.push({
        dimension: spec.key,
        file: `reports/${spec.file}`,
        status: evaluation.status,
        reason: evaluation.reason,
      });
    }
  }

  const dimensionScores = Object.values(scores);
  scores.overallGovernance = Math.round(
    dimensionScores.reduce((sum, value) => sum + value, 0) / dimensionScores.length
  );

  return {
    name: 'governance-score',
    status: scores.overallGovernance >= 95 && issues.length === 0 ? 'PASS' : 'FAIL',
    ...scores,
    statuses,
    sourceStatuses,
    maxReportAgeMs: maxAgeMs,
    evaluations,
    issues,
  };
}

function writeDashboard(scoreReport) {
  const dashboardPath = path.join(REPORTS_DIR, 'governance-dashboard.html');
  const rows = DIMENSIONS.map(({ key }) => (
    `<tr><td>${key}</td><td>${scoreReport[key]}</td><td>${scoreReport.statuses[key] || ''}</td></tr>`
  )).join('\n');

  fs.writeFileSync(dashboardPath, `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>RAP Governance Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 32px; color: #17202a; }
    table { border-collapse: collapse; width: 100%; max-width: 960px; }
    th, td { border: 1px solid #ccd3da; padding: 10px 12px; text-align: left; }
    th { background: #edf2f7; }
    .fail { color: #9f1239; font-weight: 700; }
    .pass { color: #166534; font-weight: 700; }
  </style>
</head>
<body>
  <h1>RAP Governance Dashboard</h1>
  <p>Status: <span class="${scoreReport.status === 'PASS' ? 'pass' : 'fail'}">${scoreReport.status}</span></p>
  <p>Overall Governance: ${scoreReport.overallGovernance}</p>
  <table>
    <thead><tr><th>Dimension</th><th>Score</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p>Reports are stored in <code>reports/*.json</code>.</p>
</body>
</html>
`);
}

function main() {
  const scoreReport = buildGovernanceScore();
  writeReport('governance-score.json', scoreReport);
  writeDashboard(scoreReport);
  console.log(JSON.stringify(scoreReport, null, 2));
  if (scoreReport.status !== 'PASS') process.exitCode = 1;
  return scoreReport;
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_REPORT_MAX_AGE_MS,
  DIMENSIONS,
  buildGovernanceScore,
  evaluateDimension,
  main,
};
