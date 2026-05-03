'use strict';

/**
 * learning — pipeline de aprendizado pós-execução.
 * Analisa o histórico de execuções para detectar padrões de falha recorrentes
 * e produz recomendações que são anexadas ao objeto de execução.
 */
function runLearningPipeline(execution, priorHistory = []) {
  const results = execution?.results || [];
  const failed = results.filter((r) =>
    String(r.status || '').toLowerCase() === 'failed' ||
    String(r.status || '').toLowerCase() === 'failure'
  );

  // Conta quantas vezes cada cenário falhou no histórico anterior
  const failureCounts = new Map();
  for (const hist of priorHistory) {
    for (const r of (hist.results || [])) {
      if (String(r.status || '').toLowerCase() === 'failure' || String(r.status || '').toLowerCase() === 'failed') {
        const id = r.id || r.scenarioId;
        if (id) failureCounts.set(id, (failureCounts.get(id) || 0) + 1);
      }
    }
  }

  const recurring = failed
    .map((r) => ({ id: r.id || r.scenarioId, count: failureCounts.get(r.id || r.scenarioId) || 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    generatedAt: new Date().toISOString(),
    recurring,
    totalFailed: failed.length,
    recommendations: recurring.slice(0, 5).map((entry) => ({
      scenarioId: entry.id,
      message: `Falhou ${entry.count + 1} vez(es). Considere revisar o cenário ou marcar como flaky.`,
    })),
  };
}

module.exports = { runLearningPipeline };
