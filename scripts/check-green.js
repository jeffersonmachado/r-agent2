/**
 * Verificação Rápida "Tudo Verde?"
 * 
 * Responsabilidade:
 * - Ler qa/final-verdict.json
 * - Informar claramente se o sistema está pronto ou não
 * - Retornar exit code adequado (0 = verde, 1 = não verde)
 */

const fs = require('fs');
const path = require('path');
const { runtimeAwarePath, resolveWorkspacePath } = require('../tools/system/lib/runtime-paths');

const ROOT = path.join(__dirname, '..');
const FINAL_VERDICT_PATH = resolveWorkspacePath(ROOT, runtimeAwarePath(ROOT, 'qa/final-verdict.json', 'QA_FINAL_VERDICT_PATH'));

/**
 * Verifica se sistema está "verde" (pronto).
 * 
 * @returns {Object} { isGreen: boolean, verdict: string, reason: string }
 */
function checkGreen() {
  try {
    if (!fs.existsSync(FINAL_VERDICT_PATH)) {
      return {
        isGreen: false,
        verdict: 'UNKNOWN',
        reason: 'Veredito final não encontrado. Execute npm run autotest primeiro.'
      };
    }

    const content = fs.readFileSync(FINAL_VERDICT_PATH, 'utf8');
    const verdict = JSON.parse(content);

    return {
      isGreen: verdict.verdict === 'GO',
      verdict: verdict.verdict,
      reason: verdict.reason || 'Sem motivo especificado',
      status: verdict.status,
      timestamp: verdict.timestamp
    };
  } catch (error) {
    return {
      isGreen: false,
      verdict: 'ERROR',
      reason: `Erro ao ler veredito: ${error.message}`
    };
  }
}

// Se executado diretamente
if (require.main === module) {
  const result = checkGreen();

  if (result.isGreen) {
    console.log('\n✅ SISTEMA VERDE - Tudo pronto!');
    console.log(`   ${result.reason}`);
    if (result.timestamp) {
      console.log(`   Veredito gerado em: ${new Date(result.timestamp).toLocaleString('pt-BR')}`);
    }
    process.exit(0);
  } else {
    console.error('\n❌ SISTEMA NÃO ESTÁ VERDE');
    console.error(`   Veredito: ${result.verdict}`);
    console.error(`   Motivo: ${result.reason}`);
    if (result.timestamp) {
      console.error(`   Último veredito: ${new Date(result.timestamp).toLocaleString('pt-BR')}`);
    }
    console.error('\n   Execute: npm run autotest');
    process.exit(1);
  }
}

module.exports = {
  checkGreen
};

