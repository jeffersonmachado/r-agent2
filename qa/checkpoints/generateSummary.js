'use strict';

const fs = require('fs');
const path = require('path');
const checkpointManager = require('./checkpointManager');

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function runGenerateSummary() {
  checkpointManager.ensureStateFiles();

  const waves = fs.readdirSync(checkpointManager.paths.WAVES_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => safeReadJson(path.join(checkpointManager.paths.WAVES_DIR, file), null))
    .filter(Boolean)
    .sort((a, b) => String(a.wave).localeCompare(String(b.wave)));

  const progress = safeReadJson(checkpointManager.paths.PROGRESS_PATH, {
    currentWave: null,
    completedWaves: [],
    failedWaves: [],
    globalStatus: 'running',
    lastSuccessfulCheckpoint: null,
  });

  const aggregate = {
    generatedAt: new Date().toISOString(),
    totalWaves: waves.length,
    passed: waves.filter((item) => item.status === 'passed').length,
    failed: waves.filter((item) => item.status === 'failed').length,
    blocked: waves.filter((item) => item.status === 'blocked').length,
    partial: waves.filter((item) => item.status === 'partial').length,
    running: waves.filter((item) => item.status === 'running').length,
    totals: {
      testsPassed: waves.reduce((acc, item) => acc + Number(item.metrics?.testsPassed || 0), 0),
      testsFailed: waves.reduce((acc, item) => acc + Number(item.metrics?.testsFailed || 0), 0),
      warnings: waves.reduce((acc, item) => acc + Number(item.metrics?.warnings || 0), 0),
      criticalFlowsValidated: waves.reduce((acc, item) => acc + Number(item.metrics?.criticalFlowsValidated || 0), 0),
      durationMs: waves.reduce((acc, item) => acc + Number(item.metrics?.durationMs || 0), 0),
    },
    progress,
    waves: waves.map((item) => ({
      wave: item.wave,
      title: item.title,
      status: item.status,
      blockers: item.blockers || [],
      validation: item.validation || {},
      metrics: item.metrics || {},
    })),
  };

  const jsonPath = path.join(checkpointManager.paths.REPORTS_DIR, 'final-summary.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify(aggregate, null, 2)}\n`, 'utf8');

  const mdPath = path.join(checkpointManager.paths.REPORTS_DIR, 'final-summary.md');
  const lines = [
    '# Final Summary - Checkpoints',
    '',
    `- generatedAt: ${aggregate.generatedAt}`,
    `- totalWaves: ${aggregate.totalWaves}`,
    `- passed: ${aggregate.passed}`,
    `- failed: ${aggregate.failed}`,
    `- blocked: ${aggregate.blocked}`,
    `- partial: ${aggregate.partial}`,
    '',
    '## Totais',
    `- testsPassed: ${aggregate.totals.testsPassed}`,
    `- testsFailed: ${aggregate.totals.testsFailed}`,
    `- warnings: ${aggregate.totals.warnings}`,
    `- criticalFlowsValidated: ${aggregate.totals.criticalFlowsValidated}`,
    `- durationMs: ${aggregate.totals.durationMs}`,
    '',
    '## Ondas',
  ];

  for (const wave of aggregate.waves) {
    lines.push(`- ${wave.wave} | ${wave.status} | tests: ${wave.metrics.testsPassed || 0}/${wave.metrics.testsFailed || 0} | blockers: ${(wave.blockers || []).join(', ') || 'nenhum'}`);
  }

  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');

  if (aggregate.failed === 0 && aggregate.blocked === 0 && aggregate.running === 0) {
    checkpointManager.markGlobalCompleted();
  }

  return { jsonPath, mdPath, aggregate };
}

if (require.main === module) {
  const result = runGenerateSummary();
  console.log(JSON.stringify({
    summary: result.aggregate,
    files: {
      json: result.jsonPath,
      md: result.mdPath,
    },
  }, null, 2));
}

module.exports = {
  runGenerateSummary,
};
