'use strict';

const { failIfNeeded, readJson, statusFromIssues, writeReport } = require('./common');

const issues = [];
const warnings = [];
const mesh = readJson('qa-mesh/go-no-go-report.json', {});
const readiness = readJson('governance/final-readiness-report.json', {});
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

const blockingDomains = readiness.qaCoverage?.blockingDomains || mesh.totals?.blockingDomains || [];
if (blockingDomains.length > 0) {
  warnings.push({ code: 'qa_blocking_domains', blockingDomains, message: `Blocking domains: ${blockingDomains.join(', ')}.` });
}

const report = {
  name: 'validate-qa-governance',
  status: statusFromIssues(issues),
  qaStatus: status || null,
  executionId: mesh.executionId || totals.executionId || null,
  totals,
  blockingDomains,
  issues,
  warnings,
  suggestions: issues.concat(warnings).map((entry) => entry.message),
};

writeReport('qa-governance-validation-report.json', report);
failIfNeeded(report);
