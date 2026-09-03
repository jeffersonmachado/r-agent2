'use strict';

const fs = require('fs');

const { learnPath } = require('./paths');

const OUTPUT_PATH = learnPath('validationPlans.json');

function buildValidationPlans(fixPlans) {
  const plans = (fixPlans.plans || []).map((item) => ({
    failureSignature: item.failureSignature,
    requiredChecks: {
      backendBuild: true,
      frontendBuild: true,
      qaTechnical: true,
      qaBusiness: false,
      criticalReplay: true,
    },
    tests: [
      'npm run test:unit',
      'npm run frontend:build',
      'npm run qa',
      'npm run qa:mesh',
      'npm run test:rpa:reliability:smoke',
    ],
    replay: ['critical'],
    compareMetrics: ['stabilityScore', 'flakyRate', 'criticalFlowSuccess', 'releaseReadiness'],
    gates: ['backendBuild', 'frontendBuild', 'qaTechnical', 'criticalReplay', 'checkpointPersisted'],
  }));

  const output = {
    generatedAt: new Date().toISOString(),
    totalValidationPlans: plans.length,
    plans,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return output;
}

module.exports = {
  buildValidationPlans,
  OUTPUT_PATH,
};
