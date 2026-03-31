'use strict';

const apiAdapter = require('./apiAdapter');

async function executeScenario(scenario, context = {}) {
  const result = await apiAdapter.executeScenario(scenario, context);
  return {
    ...result,
    metrics: {
      ...(result.metrics || {}),
      adapter: 'pbx',
      domain: scenario.domain,
    },
  };
}

module.exports = {
  executeScenario,
};
