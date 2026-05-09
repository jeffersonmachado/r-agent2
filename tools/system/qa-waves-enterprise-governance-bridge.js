#!/usr/bin/env node
'use strict';

const path = require('path');
const { runtimeAwarePath, resolveWorkspacePath } = require('./lib/runtime-paths');
const {
  buildQaWavesEnterpriseGovernance,
  validateQaWavesEnterpriseGovernance,
  writeQaWavesEnterpriseGovernance,
} = require('./lib/qa-waves-enterprise-governance-bridge');

const ROOT = path.join(__dirname, '..', '..');
const OUTPUT_PATH = runtimeAwarePath(ROOT, 'qa/qa-waves-enterprise-governance.json', 'QA_WAVES_ENTERPRISE_GOVERNANCE_PATH');
const AUDIT_PATH = runtimeAwarePath(ROOT, 'qa/qa-waves-governance-audit.jsonl', 'QA_WAVES_GOVERNANCE_AUDIT_PATH');

function main() {
  const report = buildQaWavesEnterpriseGovernance({
    root: ROOT,
    threshold: process.env.QA_WAVES_OPERATIONAL_CONFIDENCE_THRESHOLD,
  });
  const persisted = writeQaWavesEnterpriseGovernance(
    report,
    resolveWorkspacePath(ROOT, OUTPUT_PATH),
    resolveWorkspacePath(ROOT, AUDIT_PATH)
  );
  const validation = validateQaWavesEnterpriseGovernance(persisted);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    status: persisted.governanceStatus,
    operationalConfidence: persisted.operationalConfidence,
    confidenceGrade: persisted.confidenceGrade,
    riskLevel: persisted.riskLevel,
    outputPath: OUTPUT_PATH,
    auditPath: AUDIT_PATH,
    reasons: validation.reasons,
  }, null, 2));
  if (!validation.valid) process.exitCode = 1;
}

if (require.main === module) {
  main();
}
