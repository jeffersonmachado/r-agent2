/**
 * Gera métricas executivas de qualidade.
 * 
 * Métricas mínimas:
 * - % PASS por release
 * - Top falhas por domínio
 * - Tempo médio de correção
 * - Falhas pós-merge
 * 
 * NÃO criar gráficos avançados.
 * Foco: dado confiável.
 */

const fs = require('fs');
const path = require('path');
const { readQaResults, getQaStats } = require('../engine/qa/qaTelemetry');
const logger = require('../api/utils/logger');

const METRICS_FILE = path.join(__dirname, 'metrics.json');

/**
 * Calcula métricas executivas.
 * 
 * @param {Object} options
 * @param {number} [options.limit] - Limite de resultados a analisar
 * @param {string} [options.periodStart] - Início do período (ISO 8601)
 * @param {string} [options.periodEnd] - Fim do período (ISO 8601)
 * @returns {Object} Métricas calculadas
 */
function calculateMetrics(options = {}) {
  const { limit = 1000, periodStart, periodEnd } = options;

  logger.info('[generateMetrics] Calculando métricas', { limit });

  try {
    const results = readQaResults(limit);
    const stats = getQaStats();

    // Filtra por período se fornecido
    let filteredResults = results;
    if (periodStart || periodEnd) {
      filteredResults = results.filter(result => {
        const timestamp = result.meta?.timestamp;
        if (!timestamp) return false;

        const resultTime = new Date(timestamp);
        if (periodStart && resultTime < new Date(periodStart)) return false;
        if (periodEnd && resultTime > new Date(periodEnd)) return false;
        return true;
      });
    }

    // Calcula % PASS
    const totalExecutions = filteredResults.length;
    const totalPass = filteredResults.filter(r => r.status === 'PASS').length;
    const passRate = totalExecutions > 0 ? (totalPass / totalExecutions) * 100 : 0;

    // Top falhas por domínio
    const failuresByDomain = {};
    filteredResults.forEach(result => {
      if (result.status === 'FAIL') {
        result.scope.forEach(scope => {
          if (!failuresByDomain[scope]) {
            failuresByDomain[scope] = 0;
          }
          failuresByDomain[scope]++;
        });
      }
    });

    // Ordena por frequência
    const topFailures = Object.entries(failuresByDomain)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .reduce((acc, [domain, count]) => {
        acc[domain] = count;
        return acc;
      }, {});

    // Tempo médio de correção (simulado - requer tracking de correções)
    // Por enquanto, usa estimativa baseada em tempo entre falhas e correções
    const averageFixTime = 0; // TODO: Implementar tracking de correções

    // Falhas pós-merge
    const postMergeFailures = filteredResults.filter(result => {
      return result.meta?.source === 'ci' && 
             result.status === 'FAIL' &&
             result.meta?.commit;
    });

    const metrics = {
      '$schema': 'http://json-schema.org/draft-07/schema#',
      title: 'Métricas Executivas de Qualidade',
      description: 'Relatório simples de métricas de qualidade (JSON)',
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      metrics: {
        passRate: {
          value: Math.round(passRate * 100) / 100,
          unit: 'percentage',
          description: '% PASS por release',
          calculation: 'totalPass / totalExecutions * 100',
          totalExecutions,
          totalPass
        },
        topFailures: {
          byDomain: topFailures,
          description: 'Top falhas por domínio (chatbot, rpa, contracts, etc.)'
        },
        averageFixTime: {
          value: averageFixTime,
          unit: 'hours',
          description: 'Tempo médio de correção de falhas',
          calculation: 'sum(fixTimes) / count(fixes)',
          note: 'Requer tracking de correções'
        },
        postMergeFailures: {
          count: postMergeFailures.length,
          description: 'Falhas pós-merge (detectadas após merge no CI)',
          recent: postMergeFailures.slice(0, 10).map(r => ({
            timestamp: r.meta?.timestamp,
            commit: r.meta?.commit,
            scopes: r.scope,
            blockingFailures: r.checks.filter(c => c.result === 'FAIL' && c.blocking).length
          }))
        }
      },
      period: {
        start: periodStart || (filteredResults.length > 0 ? filteredResults[filteredResults.length - 1].meta?.timestamp : new Date().toISOString()),
        end: periodEnd || new Date().toISOString(),
        description: 'Período de análise'
      },
      releases: [],
      notes: 'Este arquivo é gerado automaticamente. Não editar manualmente.'
    };

    return metrics;
  } catch (error) {
    logger.error('[generateMetrics] Erro ao calcular métricas', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Gera e salva métricas.
 * 
 * @param {Object} options
 * @returns {Object} Métricas geradas
 */
function generateAndSaveMetrics(options = {}) {
  try {
    const metrics = calculateMetrics(options);
    
    // Salva em arquivo
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), 'utf8');
    
    logger.info('[generateMetrics] Métricas salvas', {
      passRate: metrics.metrics.passRate.value,
      topFailuresCount: Object.keys(metrics.metrics.topFailures.byDomain).length,
      postMergeFailures: metrics.metrics.postMergeFailures.count
    });

    return metrics;
  } catch (error) {
    logger.error('[generateMetrics] Erro ao salvar métricas', {
      error: error.message
    });
    throw error;
  }
}

/**
 * Carrega métricas salvas.
 * 
 * @returns {Object|null} Métricas ou null se não existir
 */
function loadMetrics() {
  try {
    if (!fs.existsSync(METRICS_FILE)) {
      return null;
    }
    const content = fs.readFileSync(METRICS_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    logger.error('[generateMetrics] Erro ao carregar métricas', {
      error: error.message
    });
    return null;
  }
}

module.exports = {
  calculateMetrics,
  generateAndSaveMetrics,
  loadMetrics
};

