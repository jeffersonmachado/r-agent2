'use strict';

/**
 * stabilityEngine — gera snapshot de estabilidade para uma execução do mesh.
 * Os dados são persistidos por stabilityHistory e consultados na UI de QA Waves.
 */
function generateStabilitySnapshot({ execution } = {}) {
  const results = execution?.results || [];
  const total = results.length;
  const failed = results.filter((r) => String(r.status || '').toLowerCase() === 'failed' || String(r.status || '').toLowerCase() === 'failure').length;
  const successRate = total > 0 ? Math.round(((total - failed) / total) * 100) : 100;

  const snapshot = {
    executionId: execution?.executionId || null,
    generatedAt: new Date().toISOString(),
    successRate,
    total,
    failed,
    stable: failed === 0,
    trend: 'neutral',
  };

  return { snapshot };
}

module.exports = { generateStabilitySnapshot };
