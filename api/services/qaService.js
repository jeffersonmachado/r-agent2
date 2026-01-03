/**
 * Serviço de QA.
 * 
 * Fornece acesso aos resultados de QA:
 * - Último resultado
 * - Histórico
 * - Resultado por ID
 * - Execução manual de QA
 */

const fs = require('fs');
const path = require('path');
const { runQa } = require('../../qa/qaRunner');
const { readQaResults, getQaStats } = require('../../engine/qa/qaTelemetry');
const logger = require('../utils/logger');

// Diretório onde resultados de QA são salvos
const QA_RESULTS_DIR = path.join(__dirname, '../../qa');
const QA_RESULT_FILE = path.join(QA_RESULTS_DIR, 'qa-result.json');

/**
 * Obtém o último resultado de QA (do arquivo ou telemetria).
 * 
 * @returns {Object|null} Último QaResult ou null
 */
function getLatestQaResult() {
  try {
    // Tenta ler do arquivo (CI/local)
    if (fs.existsSync(QA_RESULT_FILE)) {
      const content = fs.readFileSync(QA_RESULT_FILE, 'utf8');
      return JSON.parse(content);
    }

    // Se não encontrar, busca na telemetria (runtime)
    const results = readQaResults(1);
    return results.length > 0 ? results[0] : null;
  } catch (error) {
    logger.error('[qaService] Erro ao obter último resultado QA', { error: error.message });
    return null;
  }
}

/**
 * Obtém histórico de resultados de QA.
 * 
 * @param {Object} options
 * @param {number} [options.limit] - Limite de resultados (padrão: 50)
 * @param {string} [options.source] - Filtrar por source ('ci', 'local', 'runtime', 'manual')
 * @returns {Array} Lista de QaResult
 */
function getQaHistory(options = {}) {
  const { limit = 50, source } = options;

  try {
    let results = readQaResults(limit * 2); // Lê mais para filtrar depois

    // Filtra por source se fornecido
    if (source) {
      results = results.filter(result => result.meta?.source === source);
    }

    // Limita resultados
    return results.slice(0, limit);
  } catch (error) {
    logger.error('[qaService] Erro ao obter histórico QA', { error: error.message });
    return [];
  }
}

/**
 * Obtém resultado de QA por ID (commit hash ou timestamp).
 * 
 * @param {string} id - ID do resultado (commit hash ou timestamp)
 * @returns {Object|null} QaResult ou null
 */
function getQaResultById(id) {
  try {
    const results = readQaResults(1000); // Busca em mais resultados

    // Tenta encontrar por commit
    let result = results.find(r => r.meta?.commit === id);
    if (result) return result;

    // Tenta encontrar por timestamp (aproximado)
    result = results.find(r => {
      const ts = r.meta?.timestamp;
      return ts && (ts.includes(id) || ts.startsWith(id));
    });

    return result || null;
  } catch (error) {
    logger.error('[qaService] Erro ao obter resultado QA por ID', { error: error.message });
    return null;
  }
}

/**
 * Executa QA manualmente.
 * 
 * @param {Object} options
 * @param {Array<string>} [options.changedFiles] - Lista de arquivos alterados
 * @param {string} [options.source] - Source da execução ('manual' por padrão)
 * @returns {Object} QaResult
 */
function runQaManual(options = {}) {
  const { changedFiles, source = 'manual' } = options;

  try {
    const result = runQa({ changedFiles, source });

    // Salva resultado
    if (!fs.existsSync(QA_RESULTS_DIR)) {
      fs.mkdirSync(QA_RESULTS_DIR, { recursive: true });
    }
    fs.writeFileSync(QA_RESULT_FILE, JSON.stringify(result, null, 2), 'utf8');

    logger.info('[qaService] QA manual executado', {
      status: result.status,
      scopes: result.scope,
      checks: result.checks.length
    });

    return result;
  } catch (error) {
    logger.error('[qaService] Erro ao executar QA manual', { error: error.message });
    throw error;
  }
}

/**
 * Obtém estatísticas de QA.
 * 
 * @returns {Object} Estatísticas agregadas
 */
function getQaStatistics() {
  try {
    return getQaStats();
  } catch (error) {
    logger.error('[qaService] Erro ao obter estatísticas QA', { error: error.message });
    return {
      total: 0,
      byStatus: { PASS: 0, FAIL: 0, WARN: 0 },
      byScope: {},
      bySource: {},
      blockingFailures: 0,
      recentResults: []
    };
  }
}

module.exports = {
  getLatestQaResult,
  getQaHistory,
  getQaResultById,
  runQaManual,
  getQaStatistics
};

