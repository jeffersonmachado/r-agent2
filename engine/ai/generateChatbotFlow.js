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
const { validateGeneratedPlan } = require('./validateGeneratedPlan');
const logger = require('../../api/utils/logger');

// Caminho do prompt oficial
const PROMPT_PATH = path.join(__dirname, '../../../prompts/chatbot.generator.prompt.md');

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
    action: "create_flow",
    metadata: {
      name: userInput.substring(0, 50) || "Fluxo Gerado",
      description: userInput || "Fluxo gerado automaticamente"
    },
    nodes: [
      {
        id: "start_1",
        type: "start",
        config: {
          message: "Bem-vindo"
        },
        next: "message_1"
      },
      {
        id: "message_1",
        type: "message",
        config: {
          text: "Olá! Como posso ajudar?"
        },
        next: "end_1"
      },
      {
        id: "end_1",
        type: "end",
        config: {}
      }
    ],
    edges: []
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
    return {
      success: false,
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

    // 3. Validação OBRIGATÓRIA pelo gate
    const validation = validateGeneratedPlan(generatedFlow, 'chatbot');
    
    if (!validation.valid) {
      logger.warn('[generateChatbotFlow] Fluxo rejeitado pelo gate', {
        errorCount: validation.errors.length,
        errors: validation.errors
      });

      return {
        success: false,
        validation,
        error: {
          type: 'VALIDATION_FAILED',
          message: 'Fluxo gerado não passou na validação do gate',
          errors: validation.errors,
          domain: validation.domain
        }
      };
    }

    logger.info('[generateChatbotFlow] Fluxo validado com sucesso', {
      nodeCount: generatedFlow.nodes?.length || 0,
      domain: validation.domain
    });

    // 4. Fluxo válido - retorna para uso
    // NOTA: Não persiste automaticamente - o chamador decide o que fazer

    return {
      success: true,
      flow: generatedFlow,
      validation,
      promptVersion: '1.0.0' // Versão do prompt utilizado
    };

  } catch (error) {
    logger.error('[generateChatbotFlow] Erro na geração', { error: error.message, stack: error.stack });
    return {
      success: false,
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

