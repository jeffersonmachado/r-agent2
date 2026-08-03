/**
 * Rate Limiting específico para Web Scraping.
 * 
 * Implementa:
 * - Rate limit por domínio (requests por segundo)
 * - Rate limit por execução (páginas por execução)
 */

const { RateLimiterRedis, RateLimiterMemory } = require('rate-limiter-flexible');
const { getRateLimitClient } = require('../redis/rateLimitClient');
const { getScrapingDomainPolicy } = require('./policies');
const logger = require('../../api/utils/logger');
const { auditEventAsync } = require('./index');

// Cache de limiters por domínio e por execução, com bound:
// Maps cresceriam sem limite (um limiter por domínio/executionId).
// Cap com evicção do menos recentemente usado (LRU simples sobre a
// ordem de inserção do Map; cada acesso re-insere a chave no fim).
const MAX_LIMITERS_CACHE_SIZE = 500;
const domainLimitersCache = new Map();
const executionLimitersCache = new Map();

/**
 * Lê limiter do cache, marcando-o como usado recentemente.
 *
 * @param {Map<string, Object>} cache - Cache de limiters
 * @param {string} key - Chave
 * @returns {Object|undefined} Limiter ou undefined
 */
function getCachedLimiter(cache, key) {
  const limiter = cache.get(key);
  if (limiter !== undefined) {
    // Re-insere no fim do Map (mais recentemente usado)
    cache.delete(key);
    cache.set(key, limiter);
  }
  return limiter;
}

/**
 * Insere limiter no cache, evictando o menos recentemente usado
 * quando o cap é excedido.
 *
 * @param {Map<string, Object>} cache - Cache de limiters
 * @param {string} key - Chave
 * @param {Object} limiter - Limiter
 */
function setCachedLimiter(cache, key, limiter) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, limiter);
  while (cache.size > MAX_LIMITERS_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

/**
 * Extrai domínio de uma URL.
 * 
 * @param {string} url - URL
 * @returns {string} Domínio
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (err) {
    logger.warn('[RateLimit:Scraping] URL inválida', { url, error: err.message });
    return 'unknown';
  }
}

/**
 * Obtém ou cria rate limiter para um domínio.
 * 
 * @param {string} domain - Domínio
 * @returns {RateLimiterRedis|RateLimiterMemory} Rate limiter
 */
function getDomainLimiter(domain) {
  const cacheKey = `domain:${domain}`;
  
  const cached = getCachedLimiter(domainLimitersCache, cacheKey);
  if (cached) {
    return cached;
  }

  const policy = getScrapingDomainPolicy('REQUESTS_PER_SECOND');
  if (!policy) {
    throw new Error('Política REQUESTS_PER_SECOND não encontrada');
  }

  let limiter;

  const redisClient = getRateLimitClient();
  if (redisClient) {
    try {
      limiter = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: `rl:scraping:domain:${domain}:`,
        points: policy.points,
        duration: policy.duration,
        blockDuration: 0,
      });
    } catch (err) {
      logger.warn('[RateLimit:Scraping] Erro ao criar limiter Redis, usando memória', { error: err.message });
      limiter = new RateLimiterMemory({
        points: policy.points,
        duration: policy.duration,
        blockDuration: 0,
      });
    }
  } else {
    limiter = new RateLimiterMemory({
      points: policy.points,
      duration: policy.duration,
      blockDuration: 0,
    });
  }

  setCachedLimiter(domainLimitersCache, cacheKey, limiter);
  return limiter;
}

/**
 * Obtém ou cria rate limiter para execução (páginas por execução).
 * 
 * @param {string} executionId - ID da execução
 * @returns {RateLimiterRedis|RateLimiterMemory} Rate limiter
 */
function getExecutionLimiter(executionId) {
  const cacheKey = `execution:${executionId}`;
  
  const cached = getCachedLimiter(executionLimitersCache, cacheKey);
  if (cached) {
    return cached;
  }

  const policy = getScrapingDomainPolicy('PAGES_PER_EXECUTION');
  if (!policy) {
    throw new Error('Política PAGES_PER_EXECUTION não encontrada');
  }

  let limiter;

  const redisClient = getRateLimitClient();
  if (redisClient) {
    try {
      limiter = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: `rl:scraping:execution:${executionId}:`,
        points: policy.points,
        duration: policy.duration,
        blockDuration: 0,
      });
    } catch (err) {
      logger.warn('[RateLimit:Scraping] Erro ao criar limiter Redis, usando memória', { error: err.message });
      limiter = new RateLimiterMemory({
        points: policy.points,
        duration: policy.duration,
        blockDuration: 0,
      });
    }
  } else {
    limiter = new RateLimiterMemory({
      points: policy.points,
      duration: policy.duration,
      blockDuration: 0,
    });
  }

  setCachedLimiter(executionLimitersCache, cacheKey, limiter);
  return limiter;
}

/**
 * Verifica rate limit para scraping de uma URL.
 * 
 * @param {Object} options - Opções
 * @param {string} options.url - URL a raspar
 * @param {string} [options.executionId] - ID da execução (para limite por execução)
 * @param {string} [options.userId] - ID do usuário (para auditoria)
 * @returns {Promise<{allowed: boolean, retryAfter?: number, reason?: string}>}
 */
async function checkScrapingRateLimit(options) {
  const { url, executionId, userId } = options;

  // Desativa rate limit em desenvolvimento
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'development') {
    logger.debug('[RateLimit:Scraping] Rate limit desativado em desenvolvimento', { url, executionId });
    return { allowed: true };
  }

  if (!url) {
    throw new Error('URL é obrigatória');
  }

  const domain = extractDomain(url);

  // 1. Verifica limite por domínio (requests por segundo)
  try {
    const domainLimiter = getDomainLimiter(domain);
    const domainKey = domain;
    
    await domainLimiter.consume(domainKey);
  } catch (rateLimiterRes) {
    const policy = getScrapingDomainPolicy('REQUESTS_PER_SECOND');
    // Calcula retryAfter: usa msBeforeNext se disponível, senão usa duração da política
    let retryAfter;
    if (rateLimiterRes.msBeforeNext !== undefined && rateLimiterRes.msBeforeNext !== null) {
      retryAfter = Math.ceil(rateLimiterRes.msBeforeNext / 1000);
    } else {
      // Fallback: usa duração da política em segundos
      retryAfter = policy?.duration || 1;
    }
    
    // Garante que retryAfter é um número válido
    if (isNaN(retryAfter) || retryAfter <= 0) {
      retryAfter = policy?.duration || 1;
    }
    
    auditEventAsync({
      userId: userId || 'unknown',
      operationType: 'SCRAPING_DOMAIN',
      policy: policy,
      blocked: true,
      retryAfter,
      metadata: { domain, url },
    });

    return {
      allowed: false,
      retryAfter,
      reason: `Limite de requisições por segundo excedido para domínio ${domain}`,
    };
  }

  // 2. Verifica limite por execução (se executionId fornecido)
  if (executionId) {
    try {
      const executionLimiter = getExecutionLimiter(executionId);
      const executionKey = executionId;
      
      await executionLimiter.consume(executionKey);
    } catch (rateLimiterRes) {
      const policy = getScrapingDomainPolicy('PAGES_PER_EXECUTION');
      // Calcula retryAfter: usa msBeforeNext se disponível, senão usa duração da política
      let retryAfter;
      if (rateLimiterRes.msBeforeNext !== undefined && rateLimiterRes.msBeforeNext !== null) {
        retryAfter = Math.ceil(rateLimiterRes.msBeforeNext / 1000);
      } else {
        // Fallback: usa duração da política em segundos
        retryAfter = policy?.duration || 3600;
      }
      
      // Garante que retryAfter é um número válido
      if (isNaN(retryAfter) || retryAfter <= 0) {
        retryAfter = policy?.duration || 3600;
      }
      
      auditEventAsync({
        userId: userId || 'unknown',
        operationType: 'SCRAPING_EXECUTION',
        policy: policy,
        blocked: true,
        retryAfter,
        metadata: { executionId, url },
      });

      return {
        allowed: false,
        retryAfter,
        reason: `Limite de páginas por execução excedido (máximo ${policy?.points || 20} páginas)`,
      };
    }
  }

  // Registra evento (permitido) em background — nunca bloqueia o request
  auditEventAsync({
    userId: userId || 'unknown',
    operationType: 'SCRAPING',
    policy: getScrapingDomainPolicy('REQUESTS_PER_SECOND'),
    blocked: false,
    metadata: { domain, url, executionId },
  });

  return { allowed: true };
}

/**
 * Aplica rate limiting e lança erro se exceder.
 * 
 * @param {Object} options - Opções
 * @param {string} options.url - URL a raspar
 * @param {string} [options.executionId] - ID da execução
 * @param {string} [options.userId] - ID do usuário
 * @throws {Error} Se rate limit excedido
 */
async function enforceScrapingRateLimit(options) {
  const result = await checkScrapingRateLimit(options);

  if (!result.allowed) {
    const error = new Error(result.reason || 'RATE_LIMIT_EXCEEDED');
    error.code = 'RATE_LIMIT_EXCEEDED';
    error.retryAfter = result.retryAfter;
    error.statusCode = 429;
    throw error;
  }
}

module.exports = {
  checkScrapingRateLimit,
  enforceScrapingRateLimit,
  extractDomain,
  getDomainLimiter,
  getExecutionLimiter,
  // Exportados para testes/diagnóstico do bound dos caches
  MAX_LIMITERS_CACHE_SIZE,
  domainLimitersCache,
  executionLimitersCache,
};

