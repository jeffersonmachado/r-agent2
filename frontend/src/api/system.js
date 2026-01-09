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

  // Em desenvolvimento, rate limit é desativado
  const isDevelopment = import.meta.env.DEV || import.meta.env.MODE === 'development';
  if (isDevelopment) {
    logger.debug('[RateLimit] Rate limit desativado em desenvolvimento');
    return Promise.resolve({
      allowed: true,
      remainingPoints: 999999,
      totalPoints: 999999,
      retryAfter: 0,
    });
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
      // CRÍTICO: Fail-closed ao invés de fail-open
      // Em produção, bloqueia ao invés de permitir silenciosamente
      const isProduction = import.meta.env.PROD || import.meta.env.MODE === 'production';
      if (isProduction) {
        logger.error('[RateLimit] CRÍTICO: Erro ao verificar rate limit em produção. Bloqueando requisição.', {
          error: error.message,
          errorStack: error.stack,
        });
        // Em produção, bloqueia por segurança
        return { 
          allowed: false, 
          retryAfter: 60,
          error: 'RATE_LIMIT_CHECK_FAILED',
        };
      }
      // Em desenvolvimento, permite mas loga como erro crítico
      logger.error('[RateLimit] ERRO: Erro ao verificar rate limit (permitindo apenas em desenvolvimento)', {
        error: error.message,
        warning: 'Em produção, isso bloquearia a requisição',
      });
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
/**
 * Tenta fazer uma requisição com retry automático em caso de erro de conexão.
 * Útil quando o servidor pode estar reiniciando (ex: nodemon).
 */
async function fetchWithRetry(path, init, maxRetries = 3, retryDelay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchJson(path, init);
    } catch (error) {
      lastError = error;
      
      // Se não for erro de conexão, não tenta novamente
      const isConnectionError = error.connectionRefused || 
                                error.status === 0 || 
                                error.message === 'Failed to fetch' ||
                                error.message?.includes('ERR_CONNECTION_REFUSED');
      
      if (!isConnectionError || attempt === maxRetries) {
        throw error;
      }
      
      // Log do retry
      logger.warn(`Tentativa ${attempt}/${maxRetries} falhou, tentando novamente em ${retryDelay}ms...`, {
        path,
        error: error.message,
        attempt,
        maxRetries
      });
      
      // Aguarda antes de tentar novamente (backoff exponencial)
      await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
    }
  }
  
  throw lastError;
}

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

  // Em modo real, usa retry para lidar com reinicializações do servidor
  const fetchFn = payload.executionMode === 'real' 
    ? (path, init) => fetchWithRetry(path, init, 3, 2000) // 3 tentativas, 2s, 4s, 6s
    : fetchJson;

  return fetchFn('/system/generate-and-validate', {
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

