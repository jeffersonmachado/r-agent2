/**
 * Telemetria unificada de QA.
 * 
 * Unifica todas as falhas de QA em um único ponto:
 * - Falhas de gate de validação IA
 * - Falhas de governança IA
 * - Falhas críticas de RPA
 * - Falhas de validação de contratos
 * 
 * Todas geram um QaResult com source="runtime".
 * 
 * 🚫 NÃO integrar sistemas externos
 * 🚫 Apenas registro estruturado (JSON)
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Diretório para logs de telemetria QA
const QA_TELEMETRY_DIR = path.join(__dirname, '../../../logs/qa-telemetry');
const QA_TELEMETRY_FILE = path.join(QA_TELEMETRY_DIR, 'qa-results.jsonl');

/**
 * Garante que o diretório de telemetria QA existe
 */
function ensureTelemetryDir() {
  if (!fs.existsSync(QA_TELEMETRY_DIR)) {
    fs.mkdirSync(QA_TELEMETRY_DIR, { recursive: true });
  }
}

/**
 * Registra um resultado de QA (runtime).
 * 
 * @param {Object} qaResult - Resultado de QA seguindo o contrato qa-result.schema.json
 */
function recordQaResult(qaResult) {
  try {
    ensureTelemetryDir();

    // Valida estrutura básica
    if (!qaResult.status || !qaResult.scope || !qaResult.checks || !qaResult.meta) {
      logger.warn('[qaTelemetry] QaResult inválido, ignorando', { qaResult });
      return;
    }

    // Garante que source é "runtime" para telemetria
    const telemetryResult = {
      ...qaResult,
      meta: {
        ...qaResult.meta,
        source: 'runtime'
      }
    };

    // Escreve em formato JSONL (uma linha por entrada)
    const line = JSON.stringify(telemetryResult) + '\n';
    fs.appendFileSync(QA_TELEMETRY_FILE, line, 'utf8');

    // Log estruturado
    const blockingFailures = telemetryResult.checks.filter(
      check => check.result === 'FAIL' && check.blocking
    );

    if (blockingFailures.length > 0) {
      logger.warn('[qaTelemetry] QA com falhas bloqueantes registrado', {
        status: telemetryResult.status,
        scope: telemetryResult.scope,
        blockingFailures: blockingFailures.length,
        totalChecks: telemetryResult.checks.length
      });
    } else {
      logger.debug('[qaTelemetry] QA registrado', {
        status: telemetryResult.status,
        scope: telemetryResult.scope
      });
    }

  } catch (error) {
    // Não deve quebrar o fluxo se telemetria falhar
    logger.error('[qaTelemetry] Erro ao registrar QA', {
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Registra falha de gate de validação IA como QA.
 * 
 * @param {Object} params
 * @param {string} params.domain - Domínio ('chatbot' ou 'rpa')
 * @param {Array} params.errors - Lista de erros de validação
 * @param {string} params.promptUsed - Nome do prompt utilizado
 */
function recordAiGateFailure({ domain, errors, promptUsed }) {
  const qaResult = {
    status: 'FAIL',
    scope: ['wrappers', 'contracts'],
    checks: errors.map((err, index) => ({
      id: `ai.gate.${domain}.${err.type || 'unknown'}.${index}`,
      result: 'FAIL',
      blocking: true,
      details: {
        domain,
        errorType: err.type,
        message: err.message,
        rule: err.rule || null,
        promptUsed
      }
    })),
    meta: {
      timestamp: new Date().toISOString(),
      source: 'runtime'
    }
  };

  recordQaResult(qaResult);
}

/**
 * Registra falha crítica de RPA como QA.
 * 
 * @param {Object} params
 * @param {string} params.testId - ID do teste RPA
 * @param {string} params.error - Mensagem de erro
 * @param {Object} params.details - Detalhes adicionais
 */
function recordRpaCriticalFailure({ testId, error, details = {} }) {
  const qaResult = {
    status: 'FAIL',
    scope: ['executors'],
    checks: [{
      id: `rpa.critical.${testId || 'unknown'}`,
      result: 'FAIL',
      blocking: true,
      details: {
        testId,
        error,
        ...details
      }
    }],
    meta: {
      timestamp: new Date().toISOString(),
      source: 'runtime'
    }
  };

  recordQaResult(qaResult);
}

/**
 * Lê resultados de QA registrados (últimas N entradas).
 * 
 * @param {number} limit - Número máximo de entradas a retornar
 * @returns {Array} Lista de resultados de QA
 */
function readQaResults(limit = 100) {
  try {
    if (!fs.existsSync(QA_TELEMETRY_FILE)) {
      return [];
    }

    const content = fs.readFileSync(QA_TELEMETRY_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    // Pega as últimas N linhas
    const results = lines
      .slice(-limit)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (err) {
          logger.warn('[qaTelemetry] Erro ao parsear linha', { line, error: err.message });
          return null;
        }
      })
      .filter(result => result !== null);

    return results.reverse(); // Mais recentes primeiro

  } catch (error) {
    logger.error('[qaTelemetry] Erro ao ler resultados QA', { error: error.message });
    return [];
  }
}

/**
 * Obtém estatísticas de QA.
 * 
 * @returns {Object} Estatísticas agregadas
 */
function getQaStats() {
  const results = readQaResults(1000); // Últimas 1000 execuções

  const stats = {
    total: results.length,
    byStatus: { PASS: 0, FAIL: 0, WARN: 0 },
    byScope: {},
    bySource: {},
    blockingFailures: 0,
    recentResults: results.slice(0, 10) // 10 mais recentes
  };

  results.forEach(result => {
    // Por status
    stats.byStatus[result.status] = (stats.byStatus[result.status] || 0) + 1;

    // Por escopo
    result.scope.forEach(scope => {
      stats.byScope[scope] = (stats.byScope[scope] || 0) + 1;
    });

    // Por source
    const source = result.meta?.source || 'unknown';
    stats.bySource[source] = (stats.bySource[source] || 0) + 1;

    // Falhas bloqueantes
    const blockingCount = result.checks.filter(
      check => check.result === 'FAIL' && check.blocking
    ).length;
    if (blockingCount > 0) {
      stats.blockingFailures += blockingCount;
    }
  });

  return stats;
}

module.exports = {
  recordQaResult,
  recordAiGateFailure,
  recordRpaCriticalFailure,
  readQaResults,
  getQaStats
};

