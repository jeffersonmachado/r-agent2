/**
 * Wrapper oficial de geração de teste RPA.
 * 
 * Responsabilidade EXATA:
 * - Receber input do usuário
 * - Aplicar o prompt rpa.generator.prompt.md
 * - Receber o JSON gerado (simulado)
 * - Passar OBRIGATORIAMENTE pelo validateGeneratedPlan(plan, "rpa")
 * - Se válido: encaminhar para executor RPA já existente
 * - Se inválido: retornar erro estruturado
 * 
 * 🚫 NÃO implementar executor novo
 * 🚫 NÃO chamar IA real
 * 🚫 NÃO duplicar lógica do gate
 */

const fs = require('fs');
const path = require('path');
const { validateGeneratedPlan } = require('./validateGeneratedPlan');
const logger = require('../../api/utils/logger');
const config = require('../../api/utils/config');
const { buildAiEnvelope, validateAiEnvelopeOrThrow, validateByContract } = require('./aiEnvelope');

// Caminho do prompt oficial
// Corrigido: usa caminho absoluto baseado na raiz do projeto
const PROMPT_PATH = path.resolve(__dirname, '../../prompts/rpa.generator.prompt.md');

/**
 * Carrega o prompt oficial de geração RPA
 * @returns {string} Conteúdo do prompt
 */
function loadPrompt() {
  try {
    return fs.readFileSync(PROMPT_PATH, 'utf8');
  } catch (err) {
    logger.error('[generateRpaTest] Erro ao carregar prompt', { error: err.message });
    throw new Error(`Falha ao carregar prompt oficial: ${err.message}`);
  }
}

/**
 * Simula geração de plano RPA pela IA
 * 
 * NOTA: Esta é uma simulação. Em produção, aqui seria a chamada real à IA.
 * 
 * @param {string} userInput - Input do usuário
 * @param {string} prompt - Prompt oficial
 * @returns {Object} Plano RPA gerado (simulado)
 */
function simulateAiGeneration(userInput, prompt) {
  // SIMULAÇÃO: Retorna um plano RPA básico válido
  // Em produção, aqui seria a chamada real à IA com o prompt
  const baseUrl = config.get('api.baseUrl') || config.get('frontend.apiBaseUrl') || 'http://localhost:3000';
  return {
    id: `test-${Date.now()}`,
    name: `IA - Teste RPA - ${userInput.substring(0, 50)}`,
    version: '1.0',
    type: 'rpa_test_plan',
    metadata: {
      generatedAt: new Date().toISOString(),
      generatedBy: 'ai',
      status: 'draft',
      requiresReview: true,
    },
    context: {
      application: 'chatbot',
      mode: 'test-only',
    },
    steps: [
      {
        action: 'navigate',
        target: baseUrl,
        value: '',
        timeout: 15000,
      }
    ],
    assertions: [
      {
        type: 'visible',
        selector: 'body',
        value: 'true',
      }
    ]
  };
}

/**
 * Gera teste RPA a partir do input do usuário
 * 
 * @param {string} userInput - Descrição do teste desejado
 * @param {Object} options - Opções adicionais
 * @param {Object} options.flowData - Dados do fluxo a ser testado (opcional)
 * @returns {Promise<Object>} Resultado da geração
 * @returns {boolean} success - Se a geração foi bem-sucedida
 * @returns {Object} plan - Plano RPA gerado (se válido)
 * @returns {Object} validation - Resultado da validação
 * @returns {Object} error - Erro estruturado (se inválido)
 */
async function generateRpaTest(userInput, options = {}) {
  if (!userInput || typeof userInput !== 'string') {
    const envelope = validateAiEnvelopeOrThrow(buildAiEnvelope('rpa_test', {}, {
      valid: false,
      errors: [{ type: 'INVALID_INPUT', message: 'Input do usuário deve ser uma string não vazia' }],
      warnings: [],
      qualityScore: 0,
      riskFlags: ['INVALID_INPUT'],
    }, options?._aiMeta || {}));

    return {
      success: false,
      envelope,
      error: {
        type: 'INVALID_INPUT',
        message: 'Input do usuário deve ser uma string não vazia'
      }
    };
  }

  try {
    // 1. Carrega prompt oficial
    const prompt = loadPrompt();
    logger.debug('[generateRpaTest] Prompt carregado', { promptLength: prompt.length });

    // 2. Simula geração pela IA (em produção, aqui seria chamada real)
    const generatedPlan = simulateAiGeneration(userInput, prompt);
    logger.debug('[generateRpaTest] Plano gerado (simulado)', { planId: generatedPlan.id });

    // 3. Validação OBRIGATÓRIA pelo gate
    const gateValidation = validateGeneratedPlan(generatedPlan, 'rpa');

    // 3.1 Validação OBRIGATÓRIA por contrato (AJV)
    const contractPath = 'api/data/rag/rpa/rpa.schema.json';
    const contractValidation = validateByContract(contractPath, generatedPlan);

    /** @type {any} */
    const validation = {
      ...gateValidation,
      valid: gateValidation.valid === true && contractValidation.valid === true,
      errors: [
        ...(Array.isArray(gateValidation.errors) ? gateValidation.errors : []),
        ...(contractValidation.valid
          ? []
          : [{
            type: 'AJV_CONTRACT_VALIDATION_FAILED',
            message: `Plano RPA não passou no contrato AJV (${contractPath})`,
            rule: 'CONTRACT_AJV',
            details: contractValidation.errors || [],
          }]),
      ],
    };
    
    if (!validation.valid) {
      logger.warn('[generateRpaTest] Plano rejeitado pelo gate', {
        errorCount: validation.errors.length,
        errors: validation.errors
      });

      const envelope = validateAiEnvelopeOrThrow(buildAiEnvelope(
        'rpa_test',
        generatedPlan,
        validation,
        options?._aiMeta || {},
      ));

      return {
        success: false,
        validation,
        envelope,
        error: {
          type: 'VALIDATION_FAILED',
          message: 'Plano gerado não passou na validação do gate',
          errors: validation.errors,
          domain: validation.domain
        }
      };
    }

    logger.info('[generateRpaTest] Plano validado com sucesso', {
      planId: generatedPlan.id,
      domain: validation.domain
    });

    // 4. Envelope padronizado (obrigatório) + contrato AJV (envelope)
    const envelope = validateAiEnvelopeOrThrow(buildAiEnvelope(
      'rpa_test',
      generatedPlan,
      validation,
      options?._aiMeta || {},
    ));

    // 5. Plano válido - pode ser encaminhado para executor RPA
    // NOTA: O executor RPA já existe (api/services/rpaService.js)
    // Aqui apenas retornamos o plano validado
    // A execução real deve ser feita pelo chamador usando o executor existente

    return {
      success: true,
      plan: generatedPlan,
      validation,
      envelope,
      promptVersion: '1.0.0' // Versão do prompt utilizado
    };

  } catch (error) {
    logger.error('[generateRpaTest] Erro na geração', { error: error.message, stack: error.stack });
    const envelope = (() => {
      try {
        return validateAiEnvelopeOrThrow(buildAiEnvelope('rpa_test', {}, {
          valid: false,
          errors: [{ type: 'GENERATION_ERROR', message: error.message }],
          warnings: [],
          qualityScore: 0,
          riskFlags: ['GENERATION_ERROR'],
        }, options?._aiMeta || {}));
      } catch {
        return null;
      }
    })();
    return {
      success: false,
      envelope,
      error: {
        type: 'GENERATION_ERROR',
        message: error.message,
        stack: error.stack
      }
    };
  }
}

module.exports = {
  generateRpaTest,
  loadPrompt
};

