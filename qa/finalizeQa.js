/**
 * Finalização de QA - Geração de Veredito Final
 * 
 * Responsabilidades:
 * 1. Ler qa/latest.json
 * 2. Decidir GO / BLOCK baseado no resultado
 * 3. Gerar qa/final-verdict.json
 * 4. Retornar exit code apropriado (0 = GO, 1 = BLOCK)
 */

const fs = require('fs');
const path = require('path');
const logger = require('../api/utils/logger');

const LATEST_RESULT_PATH = path.join(__dirname, 'latest.json');
const FINAL_VERDICT_PATH = path.join(__dirname, 'final-verdict.json');

/**
 * Lê resultado mais recente de QA.
 * 
 * @returns {Object|null} QaResult ou null se não existir
 */
function readLatestQaResult() {
  try {
    if (!fs.existsSync(LATEST_RESULT_PATH)) {
      logger.warn('[finalizeQa] latest.json não encontrado');
      return null;
    }

    const content = fs.readFileSync(LATEST_RESULT_PATH, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    logger.error('[finalizeQa] Erro ao ler latest.json', { error: error.message });
    return null;
  }
}

/**
 * Gera veredito final (GO / BLOCK).
 * 
 * @param {Object} qaResult - Resultado de QA
 * @returns {Object} Veredito final
 */
function generateFinalVerdict(qaResult) {
  if (!qaResult) {
    return {
      verdict: 'BLOCK',
      reason: 'Resultado de QA não encontrado',
      timestamp: new Date().toISOString()
    };
  }

  const blockingFailures = qaResult.checks.filter(check => check.result === 'FAIL' && check.blocking);
  const warnings = qaResult.checks.filter(check => check.result === 'WARN' || (check.result === 'FAIL' && !check.blocking));

  // Regra: FAIL bloqueante = BLOCK
  if (blockingFailures.length > 0) {
    return {
      verdict: 'BLOCK',
      reason: `${blockingFailures.length} falha(s) bloqueante(s) detectada(s)`,
      status: qaResult.status,
      blockingFailures: blockingFailures.length,
      totalChecks: qaResult.checks.length,
      scopes: qaResult.scope,
      timestamp: new Date().toISOString(),
      qaResultPath: 'qa/latest.json'
    };
  }

  // Regra: FAIL (mesmo sem bloqueantes) = BLOCK
  if (qaResult.status === 'FAIL') {
    return {
      verdict: 'BLOCK',
      reason: 'Status FAIL detectado',
      status: qaResult.status,
      warnings: warnings.length,
      totalChecks: qaResult.checks.length,
      scopes: qaResult.scope,
      timestamp: new Date().toISOString(),
      qaResultPath: 'qa/latest.json'
    };
  }

  // Regra: WARN = GO (mas com aviso)
  if (qaResult.status === 'WARN') {
    return {
      verdict: 'GO',
      reason: 'Warnings detectados, mas nenhuma falha bloqueante',
      status: qaResult.status,
      warnings: warnings.length,
      totalChecks: qaResult.checks.length,
      scopes: qaResult.scope,
      timestamp: new Date().toISOString(),
      qaResultPath: 'qa/latest.json'
    };
  }

  // Regra: PASS = GO
  return {
    verdict: 'GO',
    reason: 'Todos os checks passaram',
    status: qaResult.status,
    totalChecks: qaResult.checks.length,
    scopes: qaResult.scope,
    timestamp: new Date().toISOString(),
    qaResultPath: 'qa/latest.json'
  };
}

/**
 * Finaliza QA e gera veredito.
 * 
 * @returns {Object} Veredito final
 */
function finalizeQa() {
  logger.info('[finalizeQa] Iniciando finalização de QA');

  const qaResult = readLatestQaResult();
  const verdict = generateFinalVerdict(qaResult);

  // Salva veredito
  try {
    fs.writeFileSync(FINAL_VERDICT_PATH, JSON.stringify(verdict, null, 2), 'utf8');
    logger.info('[finalizeQa] Veredito final gerado', {
      verdict: verdict.verdict,
      reason: verdict.reason
    });
  } catch (error) {
    logger.error('[finalizeQa] Erro ao salvar final-verdict.json', { error: error.message });
  }

  return verdict;
}

// Se executado diretamente
if (require.main === module) {
  const verdict = finalizeQa();

  // Log do veredito
  if (verdict.verdict === 'GO') {
    console.log('\n✅ VEREDITO: GO');
    console.log(`   ${verdict.reason}`);
  } else {
    console.error('\n❌ VEREDITO: BLOCK');
    console.error(`   ${verdict.reason}`);
    if (verdict.blockingFailures) {
      console.error(`   Falhas bloqueantes: ${verdict.blockingFailures}`);
    }
  }

  // Retorna exit code
  process.exit(verdict.verdict === 'GO' ? 0 : 1);
}

module.exports = {
  finalizeQa,
  generateFinalVerdict,
  readLatestQaResult
};

