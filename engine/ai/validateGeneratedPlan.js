/**
 * Gate de validação obrigatória para planos gerados por IA.
 * 
 * Este é o ÚNICO ponto de entrada para validação de planos gerados por IA.
 * Nenhum plano pode ser executado sem passar por este gate.
 * 
 * ARQUITETURA DE VALIDAÇÃO:
 * - RAG define LIMITES (o que a IA pode usar: ações, seletores, páginas)
 * - Schema valida FORMA (estrutura JSON, tipos, campos obrigatórios)
 * - Gate valida SEMÂNTICA (regras de negócio, contexto, segurança)
 * 
 * 🚫 IA NUNCA executa nada sem passar por esse gate
 * 
 * Responsabilidades:
 * 1. Receber explicitamente o domínio ("chatbot" ou "rpa")
 * 2. Validar schema correspondente (FORMA)
 * 3. Validar semântica específica do domínio (SEMÂNTICA)
 * 4. Retornar erro estruturado se inválido
 */

const { validateFlowPlan } = require('../../api/utils/validateFlowPlan');
const { validateRpaPlan } = require('../../api/utils/validateRpaPlan');
const logger = require('../../api/utils/logger');
const { recordValidationFailure } = require('./aiTelemetry');
const { recordAiGateFailure } = require('../qa/qaTelemetry');

/**
 * Identifica o domínio do plano (chatbot ou rpa)
 * @param {Object} plan - Plano a ser identificado
 * @returns {string|null} 'chatbot', 'rpa' ou null se não identificado
 */
function identifyDomain(plan) {
  if (!plan || typeof plan !== 'object') {
    return null;
  }

  // Identifica RPA pelo campo "type" ou estrutura
  if (plan.type === 'rpa_test_plan' || 
      (plan.steps && Array.isArray(plan.steps)) ||
      (plan.assertions && Array.isArray(plan.assertions))) {
    return 'rpa';
  }

  // Identifica chatbot pelo campo "nodes" ou estrutura de fluxo
  if (plan.nodes && Array.isArray(plan.nodes) ||
      plan.type === 'flow' ||
      plan.flowId) {
    return 'chatbot';
  }

  return null;
}

/**
 * Valida um plano gerado por IA ANTES da execução
 * 
 * TODO conteúdo gerado por IA passa por este gate.
 * 
 * @param {Object} plan - Plano a ser validado (flow ou rpa)
 * @param {string|Object} domainOrOptions - Domínio explícito ('chatbot' ou 'rpa') OU objeto de opções
 * @param {Object} options - Opções de validação (se domainOrOptions for string, este parâmetro é ignorado)
 * @param {string} options.domain - Domínio forçado ('chatbot' ou 'rpa'). Se não fornecido, será identificado automaticamente
 * @param {boolean} options.strict - Se true, falha em qualquer erro. Se false, retorna warnings
 * @returns {Object} Resultado da validação
 * @returns {boolean} valid - Se o plano é válido
 * @returns {Array} errors - Lista de erros encontrados
 * @returns {Array} warnings - Lista de avisos (se strict=false)
 * @returns {string} domain - Domínio identificado
 */
function validateGeneratedPlan(plan, domainOrOptions = {}, options = {}) {
  // Suporta duas assinaturas:
  // 1. validateGeneratedPlan(plan, domain) - domínio explícito
  // 2. validateGeneratedPlan(plan, options) - domínio em options
  let forcedDomain, strict = true;
  
  if (typeof domainOrOptions === 'string') {
    // Assinatura: validateGeneratedPlan(plan, domain)
    forcedDomain = domainOrOptions;
    strict = true;
  } else {
    // Assinatura: validateGeneratedPlan(plan, options)
    const opts = domainOrOptions;
    forcedDomain = opts.domain;
    strict = opts.strict !== undefined ? opts.strict : true;
  }

  // 1. Validação básica
  if (!plan || typeof plan !== 'object') {
    return {
      valid: false,
      domain: null,
      errors: [{
        type: 'INVALID_PLAN',
        message: 'Plano deve ser um objeto válido'
      }],
      warnings: []
    };
  }

  // 2. Identifica domínio
  const domain = forcedDomain || identifyDomain(plan);
  
  if (!domain) {
    return {
      valid: false,
      domain: null,
      errors: [{
        type: 'UNKNOWN_DOMAIN',
        message: 'Não foi possível identificar o domínio do plano. Deve ser "chatbot" (fluxo) ou "rpa" (teste RPA)'
      }],
      warnings: []
    };
  }

  logger.debug('[validateGeneratedPlan] Domínio identificado', { domain });

  // 3. Valida conforme domínio
  let validationResult;
  
  if (domain === 'rpa') {
    // Valida FORMA primeiro (schema, estrutura)
    validationResult = validateRpaPlan(plan);
    
    // Validações SEMÂNTICAS obrigatórias para RPA (regras de negócio)
    // Estas validações NÃO vão para o schema, ficam no gate
    const semanticErrors = [];
    
    // REGRA 1: Rejeitar se context.mode !== "test-only"
    if (!plan.context || plan.context.mode !== 'test-only') {
      semanticErrors.push({
        type: 'TEST_ONLY_REQUIRED',
        message: 'Plano RPA deve ter context.mode = "test-only" (regra semântica obrigatória)',
        rule: 'RPA_TEST_ONLY'
      });
    }
    
    // REGRA 2: Rejeitar planos sem steps
    if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      semanticErrors.push({
        type: 'STEPS_REQUIRED',
        message: 'Plano RPA deve ter pelo menos um step (regra semântica obrigatória)',
        rule: 'MANDATORY_STEPS'
      });
    }
    
    // REGRA 3: Rejeitar planos sem assertions
    if (!plan.assertions || !Array.isArray(plan.assertions) || plan.assertions.length === 0) {
      semanticErrors.push({
        type: 'ASSERTIONS_REQUIRED',
        message: 'Plano RPA deve ter pelo menos uma assertion (regra semântica obrigatória)',
        rule: 'MANDATORY_ASSERTS'
      });
    }
    
    // REGRA 4: Rejeitar qualquer action que NÃO esteja em rpa.actions.json
    // (Esta validação já é feita em validateRpaPlan, mas garantimos aqui também)
    if (plan.steps && Array.isArray(plan.steps)) {
      const fs = require('fs');
      const path = require('path');
      const actionsPath = path.join(__dirname, '../../api/data/rag/rpa/rpa.actions.json');
      try {
        const actions = JSON.parse(fs.readFileSync(actionsPath, 'utf8'));
        for (let i = 0; i < plan.steps.length; i++) {
          const step = plan.steps[i];
          if (step.action && !actions.allowed.includes(step.action)) {
            semanticErrors.push({
              type: 'ACTION_NOT_IN_WHITELIST',
              message: `Ação "${step.action}" não está em rpa.actions.json (regra semântica obrigatória)`,
              step: i + 1,
              action: step.action,
              allowed: actions.allowed,
              rule: 'ACTION_WHITELIST'
            });
          }
        }
      } catch (err) {
        // Se não conseguir carregar actions.json, deixa validateRpaPlan tratar
        logger.warn('[validateGeneratedPlan] Não foi possível carregar rpa.actions.json para validação semântica', { error: err.message });
      }
    }
    
    // Combina erros de forma (schema) com erros semânticos
    if (semanticErrors.length > 0) {
      validationResult = {
        valid: false,
        errors: [...(validationResult.errors || []), ...semanticErrors]
      };
    }
    
  } else if (domain === 'chatbot') {
    validationResult = validateFlowPlan(plan);
  } else {
    return {
      valid: false,
      domain,
      errors: [{
        type: 'UNSUPPORTED_DOMAIN',
        message: `Domínio não suportado: ${domain}. Use "chatbot" ou "rpa"`
      }],
      warnings: []
    };
  }

  // 4. Formata resultado
  const result = {
    valid: validationResult.valid || false,
    domain,
    errors: validationResult.errors || [],
    warnings: strict ? [] : (validationResult.warnings || [])
  };

  if (!result.valid && result.errors.length > 0) {
    logger.warn('[validateGeneratedPlan] Plano inválido bloqueado', {
      domain,
      errorCount: result.errors.length,
      firstError: result.errors[0]
    });

    // Registra telemetria de falha (sistema antigo)
    const promptUsed = domain === 'rpa' 
      ? 'rpa.generator.prompt.md' 
      : 'chatbot.generator.prompt.md';
    
    recordValidationFailure({
      domain,
      errors: result.errors,
      promptUsed,
      plan
    });

    // Registra também no sistema unificado de QA
    recordAiGateFailure({
      domain,
      errors: result.errors,
      promptUsed
    });
  } else if (result.valid) {
    logger.debug('[validateGeneratedPlan] Plano válido', { domain });
  }

  return result;
}

/**
 * Valida e lança erro se inválido (para uso em try/catch)
 * 
 * @param {Object} plan - Plano a ser validado
 * @param {string|Object} domainOrOptions - Domínio explícito ('chatbot' ou 'rpa') OU objeto de opções
 * @param {Object} options - Opções de validação (se domainOrOptions for string, este parâmetro é ignorado)
 * @throws {Error} Se o plano for inválido
 */
function validateGeneratedPlanOrThrow(plan, domainOrOptions = {}, options = {}) {
  let result;
  if (typeof domainOrOptions === 'string') {
    result = validateGeneratedPlan(plan, domainOrOptions);
  } else {
    result = validateGeneratedPlan(plan, { ...domainOrOptions, strict: true });
  }
  
  if (!result.valid) {
    const errorMessage = result.errors
      .map(err => `${err.type}: ${err.message}`)
      .join('; ');
    
    throw new Error(`Plano gerado por IA é inválido (${result.domain}): ${errorMessage}`);
  }
  
  return result;
}

module.exports = {
  validateGeneratedPlan,
  validateGeneratedPlanOrThrow,
  identifyDomain
};

