/**
 * Auto Teste do Sistema
 * 
 * Orquestra:
 * 1. Execução de todos os testes
 * 2. Execução de QA com governança
 * 3. Geração de veredito final
 * 
 * Retorna exit code 0 (GO) ou 1 (BLOCK)
 */

const { execSync } = require('child_process');
const path = require('path');
const logger = require('../api/utils/logger');

/**
 * Executa comando e retorna resultado.
 */
function runCommand(command, description) {
  try {
    logger.info(`[autotest] ${description}`);
    execSync(command, {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
    return { success: true };
  } catch (error) {
    logger.error(`[autotest] ${description} falhou`, { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Executa auto teste completo.
 */
function runAutotest() {
  logger.info('[autotest] Iniciando auto teste do sistema');

  // 1. Executa todos os testes
  const testResult = runCommand('npm run test:all', 'Executando todos os testes');
  if (!testResult.success) {
    logger.error('[autotest] Testes falharam, abortando');
    return { success: false, reason: 'Testes falharam' };
  }

  // 2. Executa QA com governança
  const qaResult = runCommand('node qa/runQa.js', 'Executando QA com governança');
  if (!qaResult.success) {
    logger.error('[autotest] QA falhou, abortando');
    return { success: false, reason: 'QA falhou' };
  }

  // 3. Finaliza QA e gera veredito
  const finalizeResult = runCommand('node qa/finalizeQa.js', 'Gerando veredito final');
  if (!finalizeResult.success) {
    logger.error('[autotest] Finalização falhou, abortando');
    return { success: false, reason: 'Finalização falhou' };
  }

  logger.info('[autotest] Auto teste concluído com sucesso');
  return { success: true };
}

// Se executado diretamente
if (require.main === module) {
  const result = runAutotest();
  process.exit(result.success ? 0 : 1);
}

module.exports = {
  runAutotest
};

