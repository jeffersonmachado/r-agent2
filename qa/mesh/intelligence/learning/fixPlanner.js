'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const OUTPUT_PATH = path.join(ROOT, 'qa', 'mesh', 'intelligence', 'learning', 'fixPlans.json');

function targetsByModule(moduleName) {
  if (moduleName === 'pbx') return ['scripts/test-pbx-voice-tts-asr-smoke.js', 'qa-mesh/meshRunner.js'];
  if (moduleName === 'frontend') return ['frontend/src/pages/QaMeshPage.jsx', 'frontend/src/pages/qa/StabilityPage.jsx'];
  if (moduleName === 'qa-mesh') return ['qa-mesh/meshRunner.js', 'qa/mesh/intelligence/stabilityEngine.js'];
  return [`core/${moduleName}`, 'qa-mesh/meshRunner.js'];
}

function buildFixPlans(suggestions) {
  const plans = (suggestions.suggestions || []).map((item, index) => ({
    failureSignature: item.signatures[0] || `cluster:${item.clusterId}`,
    clusterId: item.clusterId,
    proposedFix: {
      type: item.suggestionType,
      targets: targetsByModule(item.module),
      actions: item.recommendations,
    },
    validationPlan: [
      'run qa technical',
      'run qa mesh',
      'run critical replay',
      'compare stability score before/after',
    ],
    executionMode: index < 3 ? 'patch-controlled' : 'suggestion-only',
  }));

  const output = {
    generatedAt: new Date().toISOString(),
    totalPlans: plans.length,
    plans,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return output;
}

module.exports = {
  buildFixPlans,
  OUTPUT_PATH,
};
