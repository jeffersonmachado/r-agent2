/**
 * Pipeline mínimo de validação RAG.
 * 
 * Conecta IA → RAG → Validador → Resultado
 * 
 * Este pipeline garante que:
 * - A IA só pode gerar o que o sistema aceita
 * - Toda geração passa por validação estrutural
 * - Erros são retornados de forma estruturada
 * 
 * Uso:
 * - Para fluxos de chatbot: use validateFlowPlan
 * - Para testes RPA: use validateRpaPlan
 */

const { validateFlowPlan, generateErrorReport: generateFlowErrorReport } = require('./validateFlowPlan');
const { validateRpaPlan, generateErrorReport: generateRpaErrorReport } = require('./validateRpaPlan');

/**
 * Valida um plano gerado por IA baseado no tipo
 * 
 * @param {Object} plan - Plano a ser validado (flow ou rpa)
 * @param {string} type - Tipo do plano: 'chatbot' ou 'rpa'
 * @returns {Object} Resultado da validação
 */
function validatePlan(plan, type) {
  if (!plan || typeof plan !== 'object') {
    return {
      valid: false,
      errors: [{
        type: 'INVALID_PLAN',
        message: 'Plano deve ser um objeto válido'
      }]
    };
  }

  if (type === 'chatbot' || type === 'flow') {
    return validateFlowPlan(plan);
  } else if (type === 'rpa' || type === 'rpa_test') {
    return validateRpaPlan(plan);
  } else {
    return {
      valid: false,
      errors: [{
        type: 'UNKNOWN_PLAN_TYPE',
        message: `Tipo de plano desconhecido: ${type}. Use 'chatbot' ou 'rpa'`
      }]
    };
  }
}

/**
 * Gera relatório de erro estruturado baseado no tipo
 * 
 * @param {Object} validationResult - Resultado da validação
 * @param {string} type - Tipo do plano: 'chatbot' ou 'rpa'
 * @returns {Object} Relatório de erro formatado
 */
function generateErrorReport(validationResult, type) {
  if (type === 'chatbot' || type === 'flow') {
    return generateFlowErrorReport(validationResult);
  } else if (type === 'rpa' || type === 'rpa_test') {
    return generateRpaErrorReport(validationResult);
  }
  return null;
}

/**
 * Pipeline completo: valida e retorna resultado formatado
 * 
 * @param {Object} plan - Plano a ser validado
 * @param {string} type - Tipo do plano: 'chatbot' ou 'rpa'
 * @returns {Object} Resultado completo com {valid, errors, report}
 */
function validateWithPipeline(plan, type) {
  const validationResult = validatePlan(plan, type);
  const report = generateErrorReport(validationResult, type);

  return {
    ...validationResult,
    report
  };
}

module.exports = {
  validatePlan,
  generateErrorReport,
  validateWithPipeline
};

