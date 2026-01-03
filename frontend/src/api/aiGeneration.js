/**
 * API client para geração por IA (wrappers).
 * 
 * Interface controlada que:
 * - Chama wrappers via API interna
 * - Retorna sempre IaGenerationResult
 * - NÃO persiste automaticamente
 * - NÃO executa efeitos colaterais
 */

import { fetchJson } from './client';
import logger from '../utils/logger';

/**
 * Gera fluxo de chatbot via wrapper oficial.
 * 
 * @param {string} userInput - Descrição do fluxo desejado
 * @param {Object} options - Opções adicionais
 * @returns {Promise<Object>} IaGenerationResult
 */
export async function generateChatbotFlow(userInput, options = {}) {
  if (!userInput || typeof userInput !== 'string') {
    throw new Error('userInput deve ser uma string não vazia');
  }

  logger.info('[aiGeneration] Gerando chatbot via API', {
    inputLength: userInput.length
  });

  try {
    const result = await fetchJson('/ai/chatbot/generate', {
      method: 'POST',
      body: JSON.stringify({
        userInput,
        options
      })
    });

    logger.debug('[aiGeneration] Chatbot gerado', {
      success: result.success,
      domain: result.domain
    });

    return result;
  } catch (error) {
    logger.error('[aiGeneration] Erro ao gerar chatbot', {
      error: error.message
    });
    throw error;
  }
}

/**
 * Gera teste RPA via wrapper oficial.
 * 
 * @param {string} userInput - Descrição do teste desejado
 * @param {Object} options - Opções adicionais
 * @returns {Promise<Object>} IaGenerationResult
 */
export async function generateRpaTest(userInput, options = {}) {
  if (!userInput || typeof userInput !== 'string') {
    throw new Error('userInput deve ser uma string não vazia');
  }

  logger.info('[aiGeneration] Gerando RPA via API', {
    inputLength: userInput.length
  });

  try {
    const result = await fetchJson('/ai/rpa/generate', {
      method: 'POST',
      body: JSON.stringify({
        userInput,
        options
      })
    });

    logger.debug('[aiGeneration] RPA gerado', {
      success: result.success,
      domain: result.domain
    });

    return result;
  } catch (error) {
    logger.error('[aiGeneration] Erro ao gerar RPA', {
      error: error.message
    });
    throw error;
  }
}

