const logger = require('./logger');
/**
 * Validador estrutural completo para planos RPA.
 * 
 * PAPEL: Valida FORMA (schema JSON, estrutura, tipos)
 * 
 * Este validador garante:
 * - Schema JSON válido (FORMA)
 * - Ações na whitelist (RAG_ACTIONS define LIMITES)
 * - Seletores válidos (RAG_SELECTORS define LIMITES)
 * - Páginas válidas (RAG_PAGES define LIMITES)
 * - Erros conhecidos não reintroduzidos (RAG_ERRORS define LIMITES)
 * 
 * NOTA: Validação SEMÂNTICA (regras de negócio) é feita no gate (validateGeneratedPlan)
 * 
 * @param {Object} plan - Plano RPA a ser validado
 * @returns {Object} Resultado da validação com {valid: boolean, errors: Array}
 */

const fs = require('fs');
const path = require('path');
const { validateJsonSchema } = require('../../engine/utils/jsonSchemaValidator');

// Caminhos dos arquivos RAG_RPA (estrutura isolada em rag/rpa/)
// NOTA: project.rules.json foi movido para api/data/docs/ (documentação, não executável)
const RAG_BASE = path.join(__dirname, '../data/rag/rpa');
const schemaPath = path.join(RAG_BASE, 'rpa.schema.json');
const actionsPath = path.join(RAG_BASE, 'rpa.actions.json');
const selectorsPath = path.join(RAG_BASE, 'frontend.selectors.json');
const pagesPath = path.join(RAG_BASE, 'frontend.pages.json');
const restrictionsPath = path.join(RAG_BASE, 'rpa.restrictions.json');
const errorsPath = path.join(RAG_BASE, 'known_errors.json');

// Carregar dados RAG_RPA (apenas executáveis)
let schema, actions, selectors, pages, restrictions, knownErrors;

try {
  schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  actions = JSON.parse(fs.readFileSync(actionsPath, 'utf8'));
  selectors = JSON.parse(fs.readFileSync(selectorsPath, 'utf8'));
  pages = JSON.parse(fs.readFileSync(pagesPath, 'utf8'));
  restrictions = JSON.parse(fs.readFileSync(restrictionsPath, 'utf8'));
  knownErrors = JSON.parse(fs.readFileSync(errorsPath, 'utf8'));
} catch (err) {
  logger.error('[validateRpaPlan] Erro ao carregar arquivos RAG_RPA:', err.message);
  throw new Error(`Falha ao carregar arquivos RAG_RPA: ${err.message}`);
}

/**
 * Valida um plano RPA completo
 * @param {Object} plan - Plano RPA a ser validado
 * @returns {Object} Resultado da validação com {valid: boolean, errors: Array}
 */
function validateRpaPlan(plan) {
  const errors = [];

  // 1. Validação básica de estrutura
  if (!plan || typeof plan !== 'object') {
    return {
      valid: false,
      errors: [{
        type: 'INVALID_PLAN',
        message: 'Plano deve ser um objeto válido'
      }]
    };
  }

  // 2. Validação de schema JSON (FORMA)
  // Schema valida FORMA: estrutura JSON, tipos, campos obrigatórios
  // Adaptar schema para formato suportado pelo validador
  const adaptedSchema = {
    type: 'object',
    required: ['version', 'type', 'context', 'steps', 'assertions'],
    properties: {
      version: { type: 'string' },
      type: { type: 'string' },
      context: {
        type: 'object',
        required: ['application', 'mode'],
        properties: {
          application: { type: 'string' },
          mode: { type: 'string' }
        }
      },
      steps: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['action', 'target'],
          properties: {
            action: { type: 'string' },
            target: { type: 'string' },
            value: { type: 'string' },
            timeout: { type: 'number' }
          }
        }
      },
      assertions: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string' },
            selector: { type: 'string' },
            value: { type: 'string' }
          }
        }
      }
    }
  };

  const schemaValidation = validateJsonSchema(adaptedSchema, plan);
  if (!schemaValidation.valid) {
    errors.push({
      type: 'SCHEMA_VALIDATION',
      message: 'Plano não atende ao schema JSON',
      details: schemaValidation.errors
    });
  }

  // Validação explícita de minItems (validador não suporta nativamente)
  if (plan.steps && Array.isArray(plan.steps) && plan.steps.length === 0) {
    errors.push({
      type: 'STEPS_REQUIRED',
      message: 'Plano RPA deve ter pelo menos um step (minItems: 1)'
    });
  }
  
  if (plan.assertions && Array.isArray(plan.assertions) && plan.assertions.length === 0) {
    errors.push({
      type: 'ASSERTIONS_REQUIRED',
      message: 'Plano RPA deve ter pelo menos uma assertion (minItems: 1)'
    });
  }

  // 3. Validação de versão e tipo
  if (plan.version && plan.version !== '1.0') {
    errors.push({
      type: 'VERSION_VALIDATION',
      message: `Versão deve ser '1.0', recebido: ${plan.version}`,
      value: plan.version
    });
  }

  if (plan.type && plan.type !== 'rpa_test_plan') {
    errors.push({
      type: 'TYPE_VALIDATION',
      message: `Tipo deve ser 'rpa_test_plan', recebido: ${plan.type}`,
      value: plan.type
    });
  }

  // 4. Validação de contexto
  if (plan.context) {
    if (plan.context.mode && plan.context.mode !== 'test-only') {
      errors.push({
        type: 'CONTEXT_VALIDATION',
        message: "Mode deve ser 'test-only'",
        value: plan.context.mode
      });
    }
  }

  // 5. Validação de ações (whitelist)
  // RAG define LIMITES: rpa.actions.json contém a lista de ações permitidas
  // Schema valida FORMA: estrutura JSON, tipos, campos obrigatórios
  // Gate valida SEMÂNTICA: regras de negócio (test-only, assertions obrigatórias)
  if (plan.steps && Array.isArray(plan.steps)) {
    if (plan.steps.length === 0) {
      errors.push({
        type: 'STEPS_REQUIRED',
        message: 'Pelo menos um step é obrigatório'
      });
    }

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      
      // Validação de FORMA: ação deve estar na whitelist (RAG define LIMITES)
      if (step.action && !actions.allowed.includes(step.action)) {
        errors.push({
          type: 'ACTION_WHITELIST',
          message: `Ação não permitida: ${step.action}`,
          step: i + 1,
          action: step.action,
          allowed: actions.allowed
        });
      }

      // Validação de seletores (FORMA)
      // RAG define LIMITES: frontend.selectors.json contém seletores conhecidos
      if (step.target) {
        const selectorFound = selectors.available.some(sel => {
          if (step.target === sel) return true;
          // Verifica se é um seletor CSS válido (começa com #, ., [, etc)
          if (/^[#.\[a-zA-Z]/.test(step.target)) return true;
          return false;
        });

        // Se não encontrou na lista, verifica se é um seletor CSS válido genérico
        if (!selectorFound && !/^[#.\[a-zA-Z-]/.test(step.target)) {
          errors.push({
            type: 'SELECTOR_VALIDATION',
            message: `Seletor não encontrado ou inválido: ${step.target}`,
            step: i + 1,
            selector: step.target,
            available: selectors.available
          });
        }
      }

      // Validação de URLs (navegação)
      if (step.action === 'navigate' && step.target) {
        // Verifica se não está usando domínios fictícios
        if (step.target.includes('rpa.local') || 
            step.target.includes('test.local') ||
            step.target.includes('localhost.fake')) {
          errors.push({
            type: 'FICTITIOUS_DOMAIN',
            message: 'Uso de domínio fictício detectado',
            step: i + 1,
            target: step.target
          });
        }

        // Verifica se não está acessando produção
        if (step.target.includes('production') || 
            step.target.includes('/prod/') ||
            step.target.includes('.prod.')) {
          errors.push({
            type: 'PRODUCTION_ACCESS',
            message: 'Tentativa de acesso a produção detectada',
            step: i + 1,
            target: step.target
          });
        }
      }
    }
  }

  // 6. Validação de assertions
  if (!plan.assertions || !Array.isArray(plan.assertions) || plan.assertions.length === 0) {
    errors.push({
      type: 'ASSERTIONS_REQUIRED',
      message: 'Pelo menos uma assertion é obrigatória'
    });
  } else {
    for (let i = 0; i < plan.assertions.length; i++) {
      const assertion = plan.assertions[i];
      
      if (assertion.selector) {
        const selectorFound = selectors.available.some(sel => {
          if (assertion.selector === sel) return true;
          if (/^[#.\[a-zA-Z]/.test(assertion.selector)) return true;
          return false;
        });

        if (!selectorFound && !/^[#.\[a-zA-Z-]/.test(assertion.selector)) {
          errors.push({
            type: 'ASSERTION_SELECTOR_VALIDATION',
            message: `Seletor de assertion inválido: ${assertion.selector}`,
            assertion: i + 1,
            selector: assertion.selector
          });
        }
      }
    }
  }

  // 7. Verificação de erros conhecidos
  for (const knownError of knownErrors.errors) {
    if (plan.steps) {
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        
        // Verifica seletores inventados
        if (knownError.id === 'ERR_INVENTED_SELECTOR') {
          for (const example of knownError.examples) {
            if (step.target && step.target.includes(example)) {
              errors.push({
                type: 'KNOWN_ERROR',
                message: `Erro conhecido detectado: ${knownError.id}`,
                description: knownError.description,
                step: i + 1,
                fix: knownError.fix
              });
            }
          }
        }

        // Verifica rotas inválidas
        if (knownError.id === 'ERR_INVALID_ROUTE') {
          for (const example of knownError.examples) {
            if (step.target && step.target.includes(example)) {
              errors.push({
                type: 'KNOWN_ERROR',
                message: `Erro conhecido detectado: ${knownError.id}`,
                description: knownError.description,
                step: i + 1,
                fix: knownError.fix
              });
            }
          }
        }
      }
    }
  }

  // 8. Validação de regras do projeto
  // NOTA: project.rules.json foi movido para docs/ (documentação)
  // As regras hard são validadas semanticamente no gate (validateGeneratedPlan)
  // Aqui validamos apenas a estrutura (FORMA), não a semântica

  if (errors.length > 0) {
    return {
      valid: false,
      errors
    };
  }

  return { valid: true };
}

/**
 * Gera relatório de erro estruturado
 * @param {Object} validationResult - Resultado da validação
 * @param {number} step - Número do step que falhou (opcional)
 * @returns {Object} Relatório de erro formatado
 */
function generateErrorReport(validationResult, step = null) {
  if (validationResult.valid) {
    return null;
  }

  return {
    status: 'failed',
    step: step,
    errors: validationResult.errors,
    suggestedFixes: validationResult.errors.map(err => ({
      error: err.type,
      message: err.message,
      fix: err.fix || 'Consulte RAG_ERRORS para correção'
    }))
  };
}

module.exports = {
  validateRpaPlan,
  generateErrorReport
};
