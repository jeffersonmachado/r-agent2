/**
 * Wrapper oficial de geração de fluxo de chatbot.
 * 
 * Responsabilidade EXATA:
 * - Receber input do usuário
 * - Aplicar o prompt chatbot.generator.prompt.md
 * - Receber o JSON gerado (simulado)
 * - Validar usando validador estrutural de fluxo já existente
 * - Se válido: retornar fluxo
 * - Se inválido: retornar erro estruturado
 * 
 * 🚫 NÃO persistir automaticamente
 * 🚫 NÃO alterar editor
 * 🚫 NÃO criar novos validadores
 */

const fs = require('fs');
const path = require('path');
const { validateGeneratedPlan } = require('../../engine/ai/validateGeneratedPlan');
// NOTE: este módulo roda no contexto da engine e não deve depender da API.
// Para logs, usamos console (compatível com .debug/.info/.warn/.error).
const logger = console;
const { buildAiEnvelope, validateAiEnvelopeOrThrow, validateByContract } = require('../../engine/ai/aiEnvelope');

// Caminho do prompt oficial
// Corrigido: usa caminho absoluto baseado na raiz do projeto
const PROMPT_PATH = path.resolve(__dirname, '../../prompts/chatbot.generator.prompt.md');

/**
 * Carrega o prompt oficial de geração de chatbot
 * @returns {string} Conteúdo do prompt
 */
function loadPrompt() {
  try {
    return fs.readFileSync(PROMPT_PATH, 'utf8');
  } catch (err) {
    logger.error('[generateChatbotFlow] Erro ao carregar prompt', { error: err.message });
    throw new Error(`Falha ao carregar prompt oficial: ${err.message}`);
  }
}

/**
 * Simula geração de fluxo de chatbot pela IA
 * 
 * NOTA: Esta é uma simulação. Em produção, aqui seria a chamada real à IA.
 * 
 * @param {string} userInput - Input do usuário
 * @param {string} prompt - Prompt oficial
 * @returns {Object} Fluxo gerado (simulado)
 */
function simulateAiGeneration(userInput, prompt) {
  // SIMULAÇÃO: Retorna um fluxo básico válido
  // Em produção, aqui seria a chamada real à IA com o prompt
  return {
    nodes: [
      {
        id: "start_1",
        type: "start",
        config: {},
        next: "message_1"
      },
      {
        id: "message_1",
        type: "message",
        config: {
          text: "Olá! Como posso ajudar?"
        },
        next: "fallback_1"
      },
      {
        id: "fallback_1",
        type: "fallback",
        config: {
          maxAttempts: 3,
          escalationMode: "ticket"
        },
        next: "end_1"
      },
      {
        id: "end_1",
        type: "end",
        config: {}
      }
    ]
  };
}

/**
 * Garante que o fluxo tem metadados obrigatórios antes da validação
 * 
 * @param {Object} flow - Fluxo gerado
 * @param {Object} options - Opções com tenantId, flowId, flowName
 * @returns {Object} Fluxo com metadados garantidos
 */
function ensureFlowMetadata(flow, options = {}) {
  const tenantId = options.tenantId || 'demo-tenant';
  const flowId = options.flowId || `flow-${Date.now()}`;
  const flowName = options.flowName || flow?.metadata?.name || flow?.name || 'Fluxo Gerado';
  
  return {
    // Sanitiza: mantém apenas shape do FlowDefinition (schema RAG_CHATBOT)
    nodes: Array.isArray(flow?.nodes) ? flow.nodes : [],
    id: flow.id || flowId,
    tenantId: flow.tenantId || tenantId,
    version: typeof flow.version === 'number' && flow.version >= 1 ? flow.version : 1,
    name: flow.name || flowName,
    metadata: {
      ...(flow && typeof flow.metadata === 'object' ? flow.metadata : {}),
      generatedBy: 'ai',
      generated: true,
      generatedAt: new Date().toISOString(),
      // Safe-mode obrigatório
      status: 'draft',
      requiresReview: true,
    }
  };
}

/**
 * Gera fluxo de chatbot a partir do input do usuário
 * 
 * @param {string} userInput - Descrição do fluxo desejado
 * @param {Object} options - Opções adicionais
 * @returns {Promise<Object>} Resultado da geração
 * @returns {boolean} success - Se a geração foi bem-sucedida
 * @returns {Object} flow - Fluxo gerado (se válido)
 * @returns {Object} validation - Resultado da validação
 * @returns {Object} error - Erro estruturado (se inválido)
 */
async function generateChatbotFlow(userInput, options = {}) {
  if (!userInput || typeof userInput !== 'string') {
    const envelope = validateAiEnvelopeOrThrow(buildAiEnvelope('chatbot_flow', {}, {
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
    logger.debug('[generateChatbotFlow] Prompt carregado', { promptLength: prompt.length });

    // 2. Simula geração pela IA (em produção, aqui seria chamada real)
    const generatedFlow = simulateAiGeneration(userInput, prompt);
    logger.debug('[generateChatbotFlow] Fluxo gerado (simulado)', { 
      nodeCount: generatedFlow.nodes?.length || 0 
    });

    // 2.5. Garante metadados obrigatórios ANTES da validação
    const flowWithMetadata = ensureFlowMetadata(generatedFlow, options);

    // 3. Validação OBRIGATÓRIA pelo gate
    const gateValidation = validateGeneratedPlan(flowWithMetadata, 'chatbot');

    // 3.1 Validação OBRIGATÓRIA por contrato (AJV) (FORMA)
    const contractPath = 'api/data/rag/chatbot/schema/flow.schema.json';
    const contractValidation = validateByContract(contractPath, flowWithMetadata);

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
            message: `Fluxo não passou no contrato AJV (${contractPath})`,
            rule: 'CONTRACT_AJV',
            details: contractValidation.errors || [],
          }]),
      ],
    };
    
    if (!validation.valid) {
      logger.warn('[generateChatbotFlow] Fluxo rejeitado pelo gate', {
        errorCount: validation.errors.length,
        errors: validation.errors
      });

      const envelope = validateAiEnvelopeOrThrow(buildAiEnvelope(
        'chatbot_flow',
        flowWithMetadata,
        validation,
        options?._aiMeta || {},
      ));

      return {
        success: false,
        validation,
        envelope,
        error: {
          type: 'VALIDATION_FAILED',
          message: 'Fluxo gerado não passou na validação do gate',
          errors: validation.errors,
          domain: validation.domain
        }
      };
    }

    logger.info('[generateChatbotFlow] Fluxo validado com sucesso', {
      nodeCount: flowWithMetadata.nodes?.length || 0,
      domain: validation.domain
    });

    // 4. Envelope padronizado (obrigatório) + contrato AJV (envelope)
    const envelope = validateAiEnvelopeOrThrow(buildAiEnvelope(
      'chatbot_flow',
      flowWithMetadata,
      validation,
      options?._aiMeta || {},
    ));

    // 5. Fluxo válido - retorna para uso
    // NOTA: Não persiste automaticamente - o chamador decide o que fazer

    return {
      success: true,
      flow: flowWithMetadata,
      validation,
      envelope,
      promptVersion: '1.0.0' // Versão do prompt utilizado
    };

  } catch (error) {
    logger.error('[generateChatbotFlow] Erro na geração', { error: error.message, stack: error.stack });
    const envelope = (() => {
      try {
        return validateAiEnvelopeOrThrow(buildAiEnvelope('chatbot_flow', {}, {
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
  generateChatbotFlow,
  loadPrompt
};

