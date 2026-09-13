/**
 * Telemetria básica de falhas da IA.
 * 
 * Registra falhas do gate de validação para observabilidade.
 * 
 * Quando validateGeneratedPlan falhar, registra:
 * - domain (chatbot | rpa)
 * - tipo do erro
 * - prompt utilizado
 * - versão do RAG (string fixa inicialmente)
 * - timestamp
 * 
 * 🚫 NÃO integrar com sistemas externos
 * 🚫 NÃO criar dashboard agora
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Diretório para logs de telemetria
// Usa cwd para ficar ancorado na raiz do repo (evita path relativo quebrado).
const TELEMETRY_DIR = path.resolve(process.cwd(), 'logs', 'ai-telemetry');
const TELEMETRY_FILE = path.join(TELEMETRY_DIR, 'failures.jsonl');
const TELEMETRY_SUCCESS_FILE = path.join(TELEMETRY_DIR, 'success.jsonl');

// Versão do RAG (fixa inicialmente)
const RAG_VERSION = '1.0.0';

/**
 * Garante que o diretório de telemetria existe
 */
function ensureTelemetryDir() {
  if (!fs.existsSync(TELEMETRY_DIR)) {
    fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
  }
}

/**
 * Registra falha de validação da IA
 * 
 * @param {Object} params - Parâmetros da falha
 * @param {string} params.domain - Domínio ('chatbot' ou 'rpa')
 * @param {Array} params.errors - Lista de erros de validação
 * @param {string} params.promptUsed - Nome do prompt utilizado (ex: 'rpa.generator.prompt.md')
 * @param {Object} params.plan - Plano que falhou (opcional, para debug)
 */
function recordValidationFailure({ domain, errors, promptUsed, plan = null }) {
  try {
    ensureTelemetryDir();

    const telemetryEntry = {
      timestamp: new Date().toISOString(),
      domain: domain || 'unknown',
      ragVersion: RAG_VERSION,
      promptUsed: promptUsed || 'unknown',
      errorCount: errors?.length || 0,
      errors: errors?.map(err => ({
        type: err.type,
        message: err.message,
        rule: err.rule || null
      })) || [],
      // Não inclui o plano completo para evitar logs enormes
      planSummary: plan ? {
        hasSteps: !!plan.steps,
        hasNodes: !!plan.nodes,
        stepCount: plan.steps?.length || 0,
        nodeCount: plan.nodes?.length || 0
      } : null
    };

    // Escreve em formato JSONL (uma linha por entrada)
    const line = JSON.stringify(telemetryEntry) + '\n';
    fs.appendFileSync(TELEMETRY_FILE, line, 'utf8');

    // Também loga no console estruturado
    logger.warn('[aiTelemetry] Falha de validação registrada', {
      domain: telemetryEntry.domain,
      errorCount: telemetryEntry.errorCount,
      promptUsed: telemetryEntry.promptUsed
    });

  } catch (error) {
    // Não deve quebrar o fluxo se telemetria falhar
    logger.error('[aiTelemetry] Erro ao registrar telemetria', {
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * API preferida (spec): logFailure(...)
 * Mantém compatibilidade com recordValidationFailure().
 *
 * @param {Object} params
 * @param {string} params.domain
 * @param {string|null} [params.requestId]
 * @param {string|null} [params.promptUsed]
 * @param {string|null} [params.stage]
 * @param {Array} [params.errors]
 * @param {Object|null} [params.plan]
 */
function logFailure({ domain, requestId = null, promptUsed = null, stage = null, errors = [], plan = null }) {
  try {
    ensureTelemetryDir();
    const entry = {
      timestamp: new Date().toISOString(),
      domain: domain || 'unknown',
      requestId,
      stage,
      ragVersion: RAG_VERSION,
      promptUsed: promptUsed || 'unknown',
      errorCount: Array.isArray(errors) ? errors.length : 0,
      errors: Array.isArray(errors) ? errors : [],
    };
    fs.appendFileSync(TELEMETRY_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // best-effort
  }

  // Mantém log antigo também (para compatibilidade)
  try {
    recordValidationFailure({ domain, errors, promptUsed, plan });
  } catch {
    // best-effort
  }
}

/**
 * Registra sucesso (best-effort) para observabilidade.
 *
 * @param {Object} params
 * @param {string} params.domain
 * @param {string|null} [params.requestId]
 * @param {string|null} [params.promptUsed]
 * @param {number|null} [params.qualityScore]
 * @param {string[]} [params.riskFlags]
 */
function logSuccess({ domain, requestId = null, promptUsed = null, qualityScore = null, riskFlags = [] }) {
  try {
    ensureTelemetryDir();
    const entry = {
      timestamp: new Date().toISOString(),
      domain: domain || 'unknown',
      requestId,
      ragVersion: RAG_VERSION,
      promptUsed: promptUsed || 'unknown',
      qualityScore,
      riskFlags: Array.isArray(riskFlags) ? riskFlags : [],
    };
    fs.appendFileSync(TELEMETRY_SUCCESS_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (error) {
    logger.error('[aiTelemetry] Erro ao registrar sucesso', {
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Lê falhas registradas (últimas N entradas)
 * 
 * @param {number} limit - Número máximo de entradas a retornar
 * @returns {Array} Lista de falhas registradas
 */
function readFailures(limit = 100) {
  try {
    if (!fs.existsSync(TELEMETRY_FILE)) {
      return [];
    }

    const content = fs.readFileSync(TELEMETRY_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    // Pega as últimas N linhas
    const entries = lines
      .slice(-limit)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (err) {
          logger.warn('[aiTelemetry] Erro ao parsear linha', { line, error: err.message });
          return null;
        }
      })
      .filter(entry => entry !== null);

    return entries.reverse(); // Mais recentes primeiro

  } catch (error) {
    logger.error('[aiTelemetry] Erro ao ler falhas', { error: error.message });
    return [];
  }
}

/**
 * Obtém estatísticas de falhas
 * 
 * @returns {Object} Estatísticas agregadas
 */
function getFailureStats() {
  const failures = readFailures(1000); // Últimas 1000 falhas

  const stats = {
    total: failures.length,
    byDomain: {},
    byErrorType: {},
    byPrompt: {},
    recentFailures: failures.slice(0, 10) // 10 mais recentes
  };

  failures.forEach(failure => {
    // Por domínio
    stats.byDomain[failure.domain] = (stats.byDomain[failure.domain] || 0) + 1;

    // Por prompt
    stats.byPrompt[failure.promptUsed] = (stats.byPrompt[failure.promptUsed] || 0) + 1;

    // Por tipo de erro
    failure.errors.forEach(err => {
      stats.byErrorType[err.type] = (stats.byErrorType[err.type] || 0) + 1;
    });
  });

  return stats;
}

module.exports = {
  recordValidationFailure,
  logFailure,
  logSuccess,
  readFailures,
  getFailureStats,
  RAG_VERSION
};

