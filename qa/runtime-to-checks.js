/**
 * QA Runtime como Sinal Forte.
 * 
 * Função:
 * - Ler telemetria runtime
 * - Detectar falhas recorrentes
 * - Gerar automaticamente novos checks de QA
 * - Marcar esses checks como blocking após N ocorrências
 * 
 * NÃO criar dashboard.
 * NÃO integrar sistemas externos.
 */

const { readQaResults } = require('../engine/qa/qaTelemetry');
const logger = require('../api/utils/logger');
const fs = require('fs');
const path = require('path');

// Caminho para política de QA
const QA_POLICY_PATH = path.join(__dirname, '../docs/qa/qa-policy.json');

/**
 * Carrega política de QA.
 */
function loadQaPolicy() {
  try {
    const content = fs.readFileSync(QA_POLICY_PATH, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    logger.warn('[runtime-to-checks] Política de QA não encontrada, usando padrões', { error: error.message });
    return {
      failures: {
        recurringFailureThreshold: 3
      }
    };
  }
}

/**
 * Analisa telemetria runtime e detecta falhas recorrentes.
 * 
 * @param {number} limit - Limite de resultados a analisar
 * @returns {Array<Object>} Lista de checks gerados automaticamente
 */
function analyzeRuntimeFailures(limit = 1000) {
  const results = readQaResults(limit);
  const policy = loadQaPolicy();
  const threshold = policy.failures?.recurringFailureThreshold || 3;

  // Agrupa falhas por check ID
  const failureMap = new Map();

  results.forEach(result => {
    if (result.meta?.source !== 'runtime') {
      return; // Apenas runtime
    }

    if (result.status !== 'FAIL') {
      return; // Apenas falhas
    }

    result.checks.forEach(check => {
      if (check.result === 'FAIL') {
        const checkId = check.id;
        if (!failureMap.has(checkId)) {
          failureMap.set(checkId, {
            id: checkId,
            count: 0,
            firstSeen: result.meta.timestamp,
            lastSeen: result.meta.timestamp,
            details: check.details,
            blocking: check.blocking || false
          });
        }

        const entry = failureMap.get(checkId);
        entry.count++;
        if (result.meta.timestamp > entry.lastSeen) {
          entry.lastSeen = result.meta.timestamp;
        }
        if (result.meta.timestamp < entry.firstSeen) {
          entry.firstSeen = result.meta.timestamp;
        }
      }
    });
  });

  // Gera checks automáticos para falhas recorrentes
  const autoChecks = [];

  failureMap.forEach((entry, checkId) => {
    if (entry.count >= threshold) {
      // Falha recorrente detectada - cria check automático
      autoChecks.push({
        id: `runtime.auto.${checkId}`,
        result: 'FAIL',
        blocking: true, // Após N ocorrências, vira blocking
        details: {
          source: 'runtime-analysis',
          originalCheckId: checkId,
          occurrenceCount: entry.count,
          firstSeen: entry.firstSeen,
          lastSeen: entry.lastSeen,
          threshold,
          message: `Falha recorrente detectada: ${checkId} ocorreu ${entry.count} vezes (threshold: ${threshold})`,
          originalDetails: entry.details
        }
      });
    }
  });

  return autoChecks;
}

/**
 * Gera checks de QA baseados em telemetria runtime.
 * 
 * @param {Object} options
 * @param {number} [options.limit] - Limite de resultados a analisar
 * @returns {Array<Object>} Lista de checks gerados
 */
function generateRuntimeChecks(options = {}) {
  const { limit = 1000 } = options;

  logger.info('[runtime-to-checks] Analisando telemetria runtime', { limit });

  try {
    const autoChecks = analyzeRuntimeFailures(limit);

    if (autoChecks.length > 0) {
      logger.warn('[runtime-to-checks] Falhas recorrentes detectadas', {
        count: autoChecks.length,
        checks: autoChecks.map(c => c.id)
      });
    } else {
      logger.debug('[runtime-to-checks] Nenhuma falha recorrente detectada');
    }

    return autoChecks;
  } catch (error) {
    logger.error('[runtime-to-checks] Erro ao gerar checks runtime', {
      error: error.message,
      stack: error.stack
    });
    return [];
  }
}

/**
 * Integra checks runtime no resultado de QA.
 * 
 * @param {Object} qaResult - Resultado de QA existente
 * @param {Array<Object>} runtimeChecks - Checks gerados do runtime
 * @returns {Object} QaResult atualizado
 */
function mergeRuntimeChecks(qaResult, runtimeChecks) {
  if (!runtimeChecks || runtimeChecks.length === 0) {
    return qaResult;
  }

  // Adiciona checks runtime aos checks existentes
  const mergedChecks = [...(qaResult.checks || []), ...runtimeChecks];

  // Recalcula status
  const blockingFailures = mergedChecks.filter(
    check => check.result === 'FAIL' && check.blocking
  );
  const hasFailures = mergedChecks.some(check => check.result === 'FAIL');
  const hasWarnings = mergedChecks.some(
    check => check.result === 'WARN' || (check.result === 'FAIL' && !check.blocking)
  );

  let status = 'PASS';
  if (blockingFailures.length > 0) {
    status = 'FAIL';
  } else if (hasWarnings || hasFailures) {
    status = 'WARN';
  }

  // Adiciona escopo runtime se houver checks
  const scopes = new Set(qaResult.scope || []);
  if (runtimeChecks.length > 0) {
    scopes.add('telemetry');
  }

  return {
    ...qaResult,
    status,
    scope: Array.from(scopes),
    checks: mergedChecks,
    meta: {
      ...qaResult.meta,
      runtimeChecksAdded: runtimeChecks.length
    }
  };
}

module.exports = {
  generateRuntimeChecks,
  analyzeRuntimeFailures,
  mergeRuntimeChecks
};

