#!/usr/bin/env node
'use strict';

/**
 * qa:waves:analyze
 *
 * Analisa a cobertura atual de QA Waves e exibe o resultado no terminal.
 * Uso:
 *   node scripts/qa-waves-analyze.js [--vertical=fitness] [--journey=fitness_new_customer]
 */

require('../api/utils/runtimePaths').configureRuntimeRoot('/tmp/ragent2-runtime');

const {
  analyzeCoverageGaps,
  getCoverageSummary,
} = require('../api/services/qaWavesIntelligenceService');

const { listLatestScenarios } = require('../api/services/qaWavesScenarioService');

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2)
      .filter((a) => a.startsWith('--'))
      .map((a) => a.replace('--', '').split('='))
  );

  let scenarios = [];
  try {
    const result = listLatestScenarios({});
    scenarios = Array.isArray(result?.items) ? result.items : (Array.isArray(result) ? result : []);
  } catch (err) {
    console.warn('[warn] Não foi possível carregar cenários do store:', err.message);
  }

  if (args.vertical) {
    const gap = analyzeCoverageGaps(
      { vertical: args.vertical, journey: args.journey || null },
      scenarios,
    );
    console.log(JSON.stringify(gap, null, 2));
  } else {
    const summary = getCoverageSummary(scenarios);
    console.log(JSON.stringify(summary, null, 2));
  }
}

main().catch((err) => {
  console.error('[qa:waves:analyze] Erro:', err.message);
  process.exit(1);
});
