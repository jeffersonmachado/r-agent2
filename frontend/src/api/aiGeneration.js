/**
 * API client para geração por IA (formato alinhado ao orquestrador).
 * 
 * Interface controlada que:
 * - Chama o orquestrador (ou aliases) via API
 * - Retorna o formato do /flows/generate (success, flowDefinition, validationWarnings, etc.)
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
    const payload = {
      name: options.flowName || options.name || 'Fluxo Gerado',
      description: userInput,
      tenantId: options.tenantId, // usado em ambientes sem STRICT_TENANT_MODE
      useRag: options.useRag === true,
      ragSources: Array.isArray(options.ragSources) ? options.ragSources : [],
      useWebScraping: options.useWebScraping === true,
      scrapingTargets: Array.isArray(options.scrapingTargets) ? options.scrapingTargets : [],
      includeQuestions: options.includeQuestions === true,
      questions: Array.isArray(options.questions) ? options.questions : [],
      generateRpaTest: options.generateRpaTest === true,
      rpaMode: options.rpaMode,
    };

    const result = await fetchJson('/flows/generate', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    logger.debug('[aiGeneration] Chatbot gerado', {
      success: result?.success,
      flowId: result?.flowDefinition?.id
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
    // Mantemos a semântica do wrapper: gerar também o RPA.
    // No novo contrato, isso é um alias de /flows/generate com generateRpaTest=true.
    const payload = {
      name: options.flowName || options.name || 'Fluxo Gerado',
      description: userInput,
      tenantId: options.tenantId,
      useRag: options.useRag === true,
      ragSources: Array.isArray(options.ragSources) ? options.ragSources : [],
      useWebScraping: options.useWebScraping === true,
      scrapingTargets: Array.isArray(options.scrapingTargets) ? options.scrapingTargets : [],
      includeQuestions: options.includeQuestions === true,
      questions: Array.isArray(options.questions) ? options.questions : [],
      generateRpaTest: true,
      rpaMode: options.rpaMode || 'infer',
    };

    const result = await fetchJson('/flows/generate', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    logger.debug('[aiGeneration] RPA gerado', {
      success: result?.success,
      flowId: result?.flowDefinition?.id,
      rpaTestId: result?.rpaTest?.id
    });

    return result;
  } catch (error) {
    logger.error('[aiGeneration] Erro ao gerar RPA', {
      error: error.message
    });
    throw error;
  }
}

