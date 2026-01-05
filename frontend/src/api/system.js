import { fetchJson } from './client';
import logger from '../utils/logger';

/**
 * API client para o sistema de geração e validação único.
 */

/**
 * Verifica o rate limit sem consumir pontos.
 * 
 * @param {Object} payload - Payload para determinar o tipo de operação
 * @returns {Promise<{allowed: boolean, retryAfter?: number, remainingPoints?: number, totalPoints?: number}>}
 */
export function checkRateLimit(payload) {
  if (!payload || typeof payload !== 'object') {
    return Promise.reject(new Error('checkRateLimit: payload é obrigatório'));
  }

  return fetchJson('/system/check-rate-limit', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 5000,
  }).then(
    (result) => {
      logger.debug('Rate limit verificado', result);
      return result;
    },
    (error) => {
      logger.error('Erro ao verificar rate limit', error);
      // Em caso de erro, assume que está permitido (fail-open)
      return { allowed: true };
    }
  );
}

/**
 * Gera e valida sistema completo usando o orquestrador único.
 * 
 * @param {Object} payload - Payload completo conforme especificação
 * @param {Function} onProgress - Callback para atualizar progresso do pipeline
 * @returns {Promise<any>}
 */
export function generateAndValidate(payload, onProgress = null) {
  if (!payload || typeof payload !== 'object') {
    return Promise.reject(new Error('generateAndValidate: payload é obrigatório'));
  }

  logger.info('Iniciando geração e validação completa', { 
    name: payload.name,
    bootstrap: payload.bootstrap || false,
    executionMode: payload.executionMode || 'dry-run',
  });

  // Simula progresso inicial
  if (onProgress) {
    onProgress({
      payloadValid: true,
      contractValid: false,
      contextBuilt: false,
      aiExecuted: false,
      flowGenerated: false,
      seedGenerated: false,
      rpaGenerated: false,
      rpaExecuted: false,
      approved: false,
    });
  }

  return fetchJson('/system/generate-and-validate', {
    method: 'POST',
    body: JSON.stringify(payload),
    // Timeout aumentado para 180 segundos pois o processo completo pode demorar
    // (validação, geração, RPA, etc)
    timeoutMs: 180000,
  }).then(
    (result) => {
      const logData = { 
        success: result?.success,
        rpaPassed: result?.rpaPassed,
      };
      
      // Inclui motivo da reprovação quando houver falha
      if (!result?.success || !result?.rpaPassed) {
        logData.motivo = result?.motivo || 'Motivo não especificado';
      }
      
      logger.info('Geração e validação concluídas', logData);
      
      // Atualiza progresso final
      if (onProgress) {
        onProgress({
          payloadValid: true,
          contractValid: true,
          contextBuilt: true,
          aiExecuted: result?.flowGenerated || false,
          flowGenerated: result?.flowGenerated || false,
          seedGenerated: result?.seedGenerated || false,
          rpaGenerated: result?.rpaGenerated || false,
          rpaExecuted: result?.rpaExecuted || false,
          approved: result?.success && result?.rpaPassed || false,
        });
      }
      
      return result;
    },
    (error) => {
      logger.error('Erro ao gerar e validar sistema', error);
      throw error;
    }
  );
}

