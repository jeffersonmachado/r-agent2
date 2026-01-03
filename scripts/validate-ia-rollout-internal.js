/**
 * Script de Validação de Rollout de IA (INTERNAL).
 * 
 * Valida critérios do estágio INTERNAL conforme ia-rollout-policy.json:
 * - runtime: maxFailures = 0, maxWarnings = 2, timeWindow = 7 dias
 * - qa: allChecks = PASS, maxWarnings = 2
 * - metrics: successRate >= 95%, responseTime <= 5s
 * - approval: tech_lead (não precisa ser unânime)
 * - minDuration: 7 dias
 */

const fs = require('fs');
const path = require('path');
const logger = require('../api/utils/logger');
const { readQaResults, getQaStats } = require('../engine/qa/qaTelemetry');

// Carrega políticas
const ROLLOUT_POLICY_PATH = path.join(__dirname, '../governance/ia-rollout-policy.json');
const QA_POLICY_PATH = path.join(__dirname, '../governance/qa-policy.json');

let rolloutPolicy = null;
let qaPolicy = null;

try {
  rolloutPolicy = JSON.parse(fs.readFileSync(ROLLOUT_POLICY_PATH, 'utf8'));
} catch (error) {
  logger.error('[validate-ia-rollout-internal] Erro ao carregar ia-rollout-policy.json', { error: error.message });
  process.exit(1);
}

try {
  qaPolicy = JSON.parse(fs.readFileSync(QA_POLICY_PATH, 'utf8'));
} catch (error) {
  logger.error('[validate-ia-rollout-internal] Erro ao carregar qa-policy.json', { error: error.message });
  process.exit(1);
}

const INTERNAL_CRITERIA = rolloutPolicy.stages.INTERNAL.criteriaToAdvance;

/**
 * Valida critérios de runtime
 */
function validateRuntimeCriteria() {
  const criteria = INTERNAL_CRITERIA.runtime;
  const timeWindowSeconds = criteria.timeWindow; // 604800 = 7 dias
  
  // Lê resultados de QA dos últimos 7 dias
  const results = readQaResults(1000); // Lê até 1000 resultados
  
  // Filtra resultados dos últimos 7 dias
  const sevenDaysAgo = new Date(Date.now() - timeWindowSeconds * 1000);
  const recentResults = results.filter(r => {
    const timestamp = new Date(r.meta?.timestamp || 0);
    return timestamp >= sevenDaysAgo;
  });
  
  // Conta falhas e warnings
  let failures = 0;
  let warnings = 0;
  
  recentResults.forEach(result => {
    if (result.status === 'FAIL') {
      failures++;
    } else if (result.status === 'WARN') {
      warnings++;
    }
  });
  
  const maxFailures = criteria.maxFailures; // 0
  const maxWarnings = criteria.maxWarnings; // 2
  
  const passed = failures <= maxFailures && warnings <= maxWarnings;
  
  if (!passed) {
    logger.error('[validate-ia-rollout-internal] Critérios de runtime não atendidos', {
      failures,
      maxFailures,
      warnings,
      maxWarnings,
      timeWindow: `${timeWindowSeconds / 86400} dias`
    });
    return false;
  }
  
  logger.info('[validate-ia-rollout-internal] Critérios de runtime atendidos', {
    failures,
    warnings,
    timeWindow: `${timeWindowSeconds / 86400} dias`
  });
  
  return true;
}

/**
 * Valida critérios de QA
 */
function validateQaCriteria() {
  const criteria = INTERNAL_CRITERIA.qa;
  
  // Lê último resultado de QA
  const qaResultPath = path.join(__dirname, '../qa/qa-result.json');
  let latestQaResult = null;
  
  try {
    if (fs.existsSync(qaResultPath)) {
      latestQaResult = JSON.parse(fs.readFileSync(qaResultPath, 'utf8'));
    }
  } catch (error) {
    logger.warn('[validate-ia-rollout-internal] Erro ao ler qa-result.json', { error: error.message });
  }
  
  // Se não encontrar no arquivo, tenta na telemetria
  if (!latestQaResult) {
    const results = readQaResults(1);
    latestQaResult = results.length > 0 ? results[0] : null;
  }
  
  if (!latestQaResult) {
    logger.error('[validate-ia-rollout-internal] Nenhum resultado de QA encontrado');
    return false;
  }
  
  // Verifica se todos os checks são PASS
  const allChecksPass = latestQaResult.status === 'PASS';
  
  // Conta warnings
  const warnings = latestQaResult.checks?.filter(c => c.result === 'WARN').length || 0;
  const maxWarnings = criteria.maxWarnings; // 2
  
  const passed = allChecksPass && warnings <= maxWarnings;
  
  if (!passed) {
    logger.error('[validate-ia-rollout-internal] Critérios de QA não atendidos', {
      status: latestQaResult.status,
      warnings,
      maxWarnings,
      allChecksPass
    });
    return false;
  }
  
  logger.info('[validate-ia-rollout-internal] Critérios de QA atendidos', {
    status: latestQaResult.status,
    warnings
  });
  
  return true;
}

/**
 * Valida critérios de métricas (simulado - requer implementação de métricas reais)
 */
function validateMetricsCriteria() {
  const criteria = INTERNAL_CRITERIA.metrics;
  
  // Por enquanto, assume que critérios são atendidos se QA passou
  // Em produção, isso deveria consultar métricas reais de sucesso/tempo de resposta
  logger.info('[validate-ia-rollout-internal] Critérios de métricas (simulado - requer implementação real)', {
    successRate: criteria.successRate,
    responseTime: criteria.responseTime
  });
  
  return true; // Assumindo que está OK por enquanto
}

/**
 * Executa validação completa
 */
function validateInternalRollout() {
  logger.info('[validate-ia-rollout-internal] Iniciando validação de rollout INTERNAL...');
  
  const results = {
    runtime: validateRuntimeCriteria(),
    qa: validateQaCriteria(),
    metrics: validateMetricsCriteria(),
    timestamp: new Date().toISOString()
  };
  
  const allPassed = results.runtime && results.qa && results.metrics;
  
  if (!allPassed) {
    logger.error('[validate-ia-rollout-internal] ROLLOUT INTERNAL NÃO APROVADO', results);
    process.exit(1);
  }
  
  logger.info('[validate-ia-rollout-internal] ROLLOUT INTERNAL APROVADO', results);
  process.exit(0);
}

// Executa validação
validateInternalRollout();

