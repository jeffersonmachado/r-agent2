const timers = require('../../shared/scheduler');
const clock = require('../../shared/clock');
/**
 * Interface base para providers de LLM.
 * 
 * Regras:
 * - LLM atrás de interface
 * - Timeout configurável
 * - Retry controlado
 * - Fallback seguro
 * - Logs antes e depois do gate
 * 
 * A troca de modelo NÃO pode afetar:
 * - contratos
 * - wrappers
 * - QA
 */

const logger = require('../../../api/utils/logger');

/**
 * Interface base para providers de LLM.
 * 
 * @typedef {Object} LlmProvider
 * @property {string} id - Identificador único do provider
 * @property {Function} generate - Função de geração
 * @property {Function} validate - Função de validação de configuração
 */

/**
 * Configuração padrão de timeout e retry.
 */
const DEFAULT_CONFIG = {
  timeout: 30000, // 30 segundos
  maxRetries: 3,
  retryDelay: 1000, // 1 segundo
  fallbackEnabled: true
};

/**
 * Wrapper com timeout para chamadas de LLM.
 * 
 * @param {Promise} promise - Promise a ser executada
 * @param {number} timeoutMs - Timeout em milissegundos
 * @returns {Promise}
 */
function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timers.setTimeout(() => {
        reject(new Error(`Timeout após ${timeoutMs}ms`));
      }, timeoutMs);
    })
  ]);
}

/**
 * Executa retry controlado.
 * 
 * @param {Function} fn - Função a ser executada
 * @param {Object} options - Opções de retry
 * @param {number} options.maxRetries - Número máximo de tentativas
 * @param {number} options.retryDelay - Delay entre tentativas (ms)
 * @returns {Promise}
 */
async function withRetry(fn, options = {}) {
  const { maxRetries = DEFAULT_CONFIG.maxRetries, retryDelay = DEFAULT_CONFIG.retryDelay } = options;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      logger.warn('[LLM Provider] Tentativa falhou', {
        attempt,
        maxRetries,
        error: error.message
      });

      if (attempt < maxRetries) {
        await new Promise(resolve => timers.setTimeout(resolve, retryDelay * attempt));
      }
    }
  }

  throw lastError;
}

/**
 * Cria provider base com timeout, retry e logging.
 * 
 * @param {Object} provider - Provider concreto
 * @param {Object} config - Configuração
 * @returns {Object} Provider wrapper
 */
function createBaseProvider(provider, config = {}) {
  const {
    timeout = DEFAULT_CONFIG.timeout,
    maxRetries = DEFAULT_CONFIG.maxRetries,
    retryDelay = DEFAULT_CONFIG.retryDelay,
    fallbackEnabled = DEFAULT_CONFIG.fallbackEnabled
  } = config;

  return {
    id: provider.id,
    
    async generate(prompt, options = {}) {
      const startTime = clock.nowMs();
      logger.debug('[LLM Provider] Iniciando geração', {
        providerId: provider.id,
        promptLength: prompt?.length || 0,
        timeout
      });

      try {
        // Log antes do gate
        logger.debug('[LLM Provider] Antes do gate', {
          providerId: provider.id
        });

        // Executa com timeout e retry
        const result = await withTimeout(
          withRetry(
            () => provider.generate(prompt, options),
            { maxRetries, retryDelay }
          ),
          timeout
        );

        // Log depois do gate
        const duration = clock.nowMs() - startTime;
        logger.debug('[LLM Provider] Após o gate', {
          providerId: provider.id,
          duration,
          hasResult: !!result
        });

        return result;
      } catch (error) {
        const duration = clock.nowMs() - startTime;
        logger.error('[LLM Provider] Erro na geração', {
          providerId: provider.id,
          duration,
          error: error.message,
          stack: error.stack
        });

        // Fallback seguro
        if (fallbackEnabled && options.fallback) {
          logger.warn('[LLM Provider] Usando fallback', {
            providerId: provider.id
          });
          return options.fallback;
        }

        throw error;
      }
    },

    validate() {
      if (provider.validate) {
        return provider.validate();
      }
      return { valid: true };
    }
  };
}

module.exports = {
  createBaseProvider,
  withTimeout,
  withRetry,
  DEFAULT_CONFIG
};

