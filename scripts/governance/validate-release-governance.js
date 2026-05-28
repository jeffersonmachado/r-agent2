'use strict';

const { exists, failIfNeeded, readJson, statusFromIssues, writeReport } = require('./common');

const issues = [];
const warnings = [];

const packageValidation = readJson('governance/package-validation-report.json', {});
const packageIntegrity = readJson('governance/package-integrity-report.json', {});
const readiness = readJson('governance/final-readiness-report.json', {});

if (!exists('dist/release')) {
  issues.push({ code: 'dist_release_missing', message: 'dist/release is missing. Run npm run zip:release.' });
}
if (packageValidation.ok !== true) {
  issues.push({ code: 'package_validation_not_ok', message: 'package-validation-report.json is not ok.' });
}
if (!(packageIntegrity.pass === true || packageIntegrity.status === 'PACKAGE_INTEGRITY_GO')) {
  issues.push({ code: 'package_integrity_not_go', message: 'package-integrity-report.json is not GO/PASS.' });
}
const decision = String(readiness.finalDecision || readiness.status || '');
if (!decision || /NO_GO/i.test(decision)) {
  issues.push({ code: 'release_readiness_no_go', decision, message: `Release readiness is not GO: ${decision || 'missing'}.` });
}
if (/MESH_BLOCKED/i.test(decision)) {
  warnings.push({ code: 'mesh_blocks_release', decision, message: 'Release hardening package may pass while operational readiness remains blocked by QA Mesh.' });
}

const report = {
  name: 'validate-release-governance',
  status: statusFromIssues(issues),
  decision,
  packageValidationOk: packageValidation.ok === true,
  packageIntegrityOk: packageIntegrity.pass === true || packageIntegrity.status === 'PACKAGE_INTEGRITY_GO',
  issues,
  warnings,
  suggestions: issues.concat(warnings).map((entry) => entry.message),
};

writeReport('release-governance-validation-report.json', report);
failIfNeeded(report);
