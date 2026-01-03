/**
 * Orquestração de QA com Aplicação de Governança
 * 
 * Responsabilidades:
 * 1. Executar QA (reutiliza qaRunner.js)
 * 2. Aplicar avaliadores de governança (policyEvaluator, timeEvaluator)
 * 3. Salvar resultado em qa/latest.json
 * 
 * Reutiliza módulos existentes:
 * - qa/qaRunner.js (runQa)
 * - governance/evaluators.js (policyEvaluator, timeEvaluator)
 */

const fs = require('fs');
const path = require('path');
const { runQa } = require('./qaRunner');
const { policyEvaluator, timeEvaluator } = require('../governance/evaluators');
const logger = require('../api/utils/logger');

// Carrega política de QA
const qaPolicyPath = path.join(__dirname, '../governance/qa-policy.json');
const qaPolicy = JSON.parse(fs.readFileSync(qaPolicyPath, 'utf8'));

const LATEST_RESULT_PATH = path.join(__dirname, 'latest.json');

/**
 * Executa QA completo com aplicação de governança.
 * 
 * @param {Object} options
 * @param {Array<string>} [options.changedFiles] - Arquivos alterados
 * @param {string} [options.baseRef] - Referência base para Git diff
 * @param {string} [options.source] - Origem da execução ('ci', 'local', 'autotest')
 * @returns {Object} QaResult com governança aplicada
 */
function runQaWithGovernance(options = {}) {
  const { changedFiles, baseRef, source = 'autotest' } = options;
  const startTime = Date.now();

  logger.info('[runQa] Iniciando QA com governança', { source });

  // Executa QA base
  const qaResult = runQa({ changedFiles, baseRef, source });

  // Aplica policyEvaluator
  const policyEvaluation = policyEvaluator(qaResult, qaPolicy);
  
  // Aplica timeEvaluator (SLA de CI)
  const executionTime = (Date.now() - startTime) / 1000; // em segundos
  const timeEvaluation = timeEvaluator(executionTime, qaPolicy.sla.ci);

  // Adiciona avaliação de governança ao resultado
  const resultWithGovernance = {
    ...qaResult,
    governance: {
      policyEvaluation,
      timeEvaluation,
      appliedAt: new Date().toISOString()
    }
  };

  // Se SLA foi excedido e action é fail_build, força FAIL
  if (timeEvaluation.exceeded && timeEvaluation.action === 'fail_build') {
    logger.warn('[runQa] SLA de CI excedido, forçando FAIL', {
      executionTime: timeEvaluation.executionTime,
      maxTime: timeEvaluation.maxTime
    });
    resultWithGovernance.status = 'FAIL';
    resultWithGovernance.checks.push({
      id: 'governance.sla.ci.exceeded',
      result: 'FAIL',
      blocking: true,
      details: {
        message: `SLA de CI excedido: ${timeEvaluation.executionTime.toFixed(2)}s > ${timeEvaluation.maxTime}s`,
        executionTime: timeEvaluation.executionTime,
        maxTime: timeEvaluation.maxTime
      }
    });
  }

  // Salva resultado em latest.json
  try {
    fs.writeFileSync(LATEST_RESULT_PATH, JSON.stringify(resultWithGovernance, null, 2), 'utf8');
    logger.info('[runQa] Resultado salvo em latest.json', {
      status: resultWithGovernance.status,
      scopes: resultWithGovernance.scope.length
    });
  } catch (error) {
    logger.error('[runQa] Erro ao salvar latest.json', { error: error.message });
  }

  return resultWithGovernance;
}

// Se executado diretamente
if (require.main === module) {
  const result = runQaWithGovernance({ source: 'autotest' });
  
  // Log resumido
  const blockingFailures = result.checks.filter(check => check.result === 'FAIL' && check.blocking);
  logger.info('[runQa] QA com governança concluído', {
    status: result.status,
    scopes: result.scope,
    totalChecks: result.checks.length,
    blockingFailures: blockingFailures.length,
    executionTime: result.governance?.timeEvaluation?.executionTime
  });

  // Retorna exit code baseado no status
  if (result.status === 'FAIL' || blockingFailures.length > 0) {
    process.exit(1);
  }

  process.exit(0);
}

module.exports = {
  runQaWithGovernance
};

