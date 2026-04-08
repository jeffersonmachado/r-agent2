'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MESH_REPORT_PATH = process.env.QA_MESH_REPORT_PATH || path.join(ROOT, 'qa-mesh', 'meshReport.json');
const MESH_INTELLIGENCE_PATH = process.env.QA_MESH_INTELLIGENCE_PATH || path.join(ROOT, 'qa-mesh', 'intelligence', 'latest.json');
const QA_FINAL_VERDICT_PATH = process.env.QA_FINAL_VERDICT_PATH || path.join(__dirname, 'final-verdict.json');
const OUTPUT_PATH = process.env.QA_FINAL_REPORT_PATH || path.join(__dirname, 'final-report.json');

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function generateFinalReport() {
  const mesh = safeReadJson(MESH_REPORT_PATH, null);
  const intelligence = safeReadJson(MESH_INTELLIGENCE_PATH, null);
  const verdict = safeReadJson(QA_FINAL_VERDICT_PATH, null);

  const report = {
    generatedAt: new Date().toISOString(),
    deterministic: mesh ? mesh.executionQuality === 'valid' : false,
    mesh: mesh ? {
      executionId: mesh.executionId,
      goNoGo: mesh.goNoGo,
      reasons: mesh.reasons,
      passed: mesh.passed,
      failed: mesh.failed,
      skipped: mesh.skipped,
      executionCoverage: mesh.executionCoverage,
      fallbackUsed: mesh.fallbackUsed || 0,
    } : null,
    intelligence: intelligence ? {
      totalClusters: intelligence.totalClusters,
      topProblems: (intelligence.rankedProblems || []).slice(0, 10),
      weakestModules: (intelligence.moduleStability || []).slice(0, 10),
    } : null,
    qaVerdict: verdict,
    status: (!mesh || mesh.goNoGo === 'NO_GO' || verdict?.verdict === 'BLOCK') ? 'BLOCK' : 'GO',
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

if (require.main === module) {
  const report = generateFinalReport();
  if (report.status !== 'GO') {
    process.exitCode = 1;
  }
}

module.exports = {
  generateFinalReport,
  OUTPUT_PATH,
};