/**
 * Engine genérica de Rate Limiting.
 * 
 * Responsabilidades:
 * - Aplicar políticas de rate limiting
 * - Bloquear execuções que excedem limites
 * - Retornar erros padronizados
 * - Registrar eventos para auditoria
 */

const { RateLimiterRedis, RateLimiterMemory } = require('rate-limiter-flexible');
const { getRateLimitClient, isRedisAvailable } = require('../redis/rateLimitClient');
const { getPolicy } = require('./policies');
const logger = require('../../api/utils/logger');
const path = require('path');
const fs = require('fs').promises;

// Cache de limiters por tipo de operação
const limitersCache = new Map();

// Diretório para relatórios de auditoria
const AUDIT_DIR = path.join(__dirname, '../../../reports');
const AUDIT_FILE = path.join(AUDIT_DIR, 'rate-limit-events.json');

/**
 * Garante que o diretório de auditoria existe.
 */
async function ensureAuditDir() {
  try {
    await fs.mkdir(AUDIT_DIR, { recursive: true });
  } catch (err) {
    logger.warn('[RateLimit] Erro ao criar diretório de auditoria', { error: err.message });
  }
}

/**
 * Registra evento de rate limiting para auditoria.
 * 
 * @param {Object} event - Evento a registrar
 */
async function auditEvent(event) {
  try {
    await ensureAuditDir();
    
    const auditData = {
      timestamp: new Date().toISOString(),
      userId: event.userId || 'unknown',
      operationType: event.operationType,
      policy: event.policy,
      blocked: event.blocked || false,
      retryAfter: event.retryAfter || null,
      remainingPoints: event.remainingPoints || null,
      totalPoints: event.totalPoints || null,
    };

    // Lê arquivo existente ou cria novo
    let events = [];
    try {
      const content = await fs.readFile(AUDIT_FILE, 'utf-8');
      events = JSON.parse(content);
    } catch (err) {
      // Arquivo não existe, cria novo
      events = [];
    }

    // Adiciona novo evento
    events.push(auditData);

    // Mantém apenas últimos 1000 eventos
    if (events.length > 1000) {
      events = events.slice(-1000);
    }

    // Salva arquivo
    await fs.writeFile(AUDIT_FILE, JSON.stringify(events, null, 2), 'utf-8');
  } catch (err) {
    logger.error('[RateLimit] Erro ao registrar evento de auditoria', { error: err.message });
  }
}

/**
 * Obtém ou cria rate limiter para um tipo de operação.
 * 
 * @param {string} operationType - Tipo de operação
 * @returns {RateLimiterRedis|RateLimiterMemory} Rate limiter
 */
function getLimiter(operationType) {
  // Verifica cache
  if (limitersCache.has(operationType)) {
    return limitersCache.get(operationType);
  }

  const policy = getPolicy(operationType);
  if (!policy) {
    throw new Error(`Política não encontrada para operação: ${operationType}`);
  }

  let limiter;

  // Tenta usar Redis, fallback para memória
  const redisClient = getRateLimitClient();
  if (redisClient) {
    try {
      limiter = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: `rl:${operationType}:`,
        points: policy.points,
        duration: policy.duration,
        // Comportamento quando excede limite
        blockDuration: 0, // Não bloqueia permanentemente, apenas retorna erro
      });
    } catch (err) {
      logger.warn('[RateLimit] Erro ao criar limiter Redis, usando memória', { error: err.message });
      limiter = new RateLimiterMemory({
        points: policy.points,
        duration: policy.duration,
        blockDuration: 0,
      });
    }
  } else {
    // Fallback para memória (não recomendado em produção)
    logger.warn('[RateLimit] Redis não disponível, usando limiter em memória', { operationType });
    limiter = new RateLimiterMemory({
      points: policy.points,
      duration: policy.duration,
      blockDuration: 0,
    });
  }

  // Cache limiter
  limitersCache.set(operationType, limiter);

  return limiter;
}

/**
 * Aplica rate limiting para uma operação.
 * 
 * @param {Object} options - Opções
 * @param {string} options.userId - ID do usuário (ou sessão)
 * @param {string} options.operationType - Tipo de operação
 * @returns {Promise<{allowed: boolean, retryAfter?: number, remainingPoints?: number, totalPoints?: number}>}
 */
async function checkRateLimit(options) {
  const { userId, operationType } = options;

  if (!userId) {
    throw new Error('userId é obrigatório para rate limiting');
  }

  if (!operationType) {
    throw new Error('operationType é obrigatório para rate limiting');
  }

  const policy = getPolicy(operationType);
  if (!policy) {
    logger.warn('[RateLimit] Política não encontrada, permitindo execução', { operationType });
    return { allowed: true };
  }

  try {
    const limiter = getLimiter(operationType);
    
    // Chave única por usuário e tipo de operação
    const key = `${userId}:${operationType}`;

    // Tenta consumir um ponto
    const result = await limiter.consume(key);

    // Sucesso: ainda há pontos disponíveis
    const response = {
      allowed: true,
      remainingPoints: result.remainingPoints,
      totalPoints: result.totalPoints,
      msBeforeNext: result.msBeforeNext,
    };

    // Registra evento (permitido)
    await auditEvent({
      userId,
      operationType,
      policy,
      blocked: false,
      remainingPoints: result.remainingPoints,
      totalPoints: result.totalPoints,
    });

    return response;
  } catch (rateLimiterRes) {
    // Excedeu limite
    // O rate-limiter-flexible retorna msBeforeNext no objeto de erro quando consume() falha
    // Pode estar em rateLimiterRes.msBeforeNext ou rateLimiterRes.msBeforeNext pode ser calculado
    let retryAfter;
    
    // Tenta obter msBeforeNext de diferentes formas
    const msBeforeNext = rateLimiterRes.msBeforeNext 
      || rateLimiterRes.msBeforeNextReset 
      || (rateLimiterRes.remainingTime ? rateLimiterRes.remainingTime * 1000 : null);
    
    if (msBeforeNext !== undefined && msBeforeNext !== null && !isNaN(msBeforeNext) && msBeforeNext > 0) {
      retryAfter = Math.ceil(msBeforeNext / 1000);
    } else {
      // Fallback: usa duração da política em segundos
      // Isso acontece quando o rate limiter não retorna msBeforeNext (pode ocorrer com blockDuration: 0)
      retryAfter = policy.duration || 60;
      logger.debug('[RateLimit] msBeforeNext não disponível, usando duração da política', {
        operationType,
        policyDuration: policy.duration,
        rateLimiterResKeys: Object.keys(rateLimiterRes),
      });
    }
    
    // Garante que retryAfter é um número válido
    if (isNaN(retryAfter) || retryAfter <= 0) {
      retryAfter = policy.duration || 60;
    }

    // Registra evento (bloqueado)
    await auditEvent({
      userId,
      operationType,
      policy,
      blocked: true,
      retryAfter,
      remainingPoints: 0,
      totalPoints: rateLimiterRes.totalPoints,
    });

    return {
      allowed: false,
      retryAfter,
      remainingPoints: 0,
      totalPoints: rateLimiterRes.totalPoints,
    };
  }
}

/**
 * Cria erro padronizado de rate limit.
 * 
 * @param {number} retryAfter - Segundos até poder tentar novamente
 * @returns {Error} Erro padronizado
 */
function createRateLimitError(retryAfter) {
  const error = new Error('RATE_LIMIT_EXCEEDED');
  error.code = 'RATE_LIMIT_EXCEEDED';
  error.retryAfter = retryAfter;
  error.statusCode = 429; // Too Many Requests
  return error;
}

/**
 * Wrapper para aplicar rate limiting e lançar erro se exceder.
 * 
 * @param {Object} options - Opções
 * @param {string} options.userId - ID do usuário
 * @param {string} options.operationType - Tipo de operação
 * @throws {Error} Se rate limit excedido
 */
async function enforceRateLimit(options) {
  const result = await checkRateLimit(options);

  if (!result.allowed) {
    const error = createRateLimitError(result.retryAfter);
    logger.warn('[RateLimit] Rate limit excedido', {
      userId: options.userId,
      operationType: options.operationType,
      retryAfter: result.retryAfter,
    });
    throw error;
  }

  return result;
}

/**
 * Limpa o cache de limiters, forçando recriação com políticas atualizadas.
 * Útil quando políticas são alteradas em config.json.
 */
function clearLimitersCache() {
  const size = limitersCache.size;
  limitersCache.clear();
  logger.info('[RateLimit] Cache de limiters limpo', { clearedCount: size });
}

/**
 * Limpa todas as chaves de rate limiting no Redis.
 * ATENÇÃO: Use apenas em desenvolvimento!
 * 
 * @returns {Promise<number>} Número de chaves deletadas
 */
async function clearRedisRateLimitKeys() {
  const redisClient = getRateLimitClient();
  if (!redisClient) {
    logger.warn('[RateLimit] Redis não disponível, não é possível limpar chaves');
    return 0;
  }

  try {
    // Busca todas as chaves com prefixo rl:
    const keys = await redisClient.keys('rl:*');
    if (keys.length === 0) {
      logger.info('[RateLimit] Nenhuma chave encontrada para limpar');
      return 0;
    }

    // Remove o prefixo das chaves (já que o cliente adiciona automaticamente)
    const keysWithoutPrefix = keys.map(key => key.replace(/^rl:/, ''));

    // Deleta as chaves
    if (keysWithoutPrefix.length > 0) {
      await redisClient.del(...keysWithoutPrefix);
    }

    logger.info('[RateLimit] Chaves do Redis limpas', { deletedCount: keys.length });
    return keys.length;
  } catch (err) {
    logger.error('[RateLimit] Erro ao limpar chaves do Redis', { error: err.message });
    throw err;
  }
}

module.exports = {
  checkRateLimit,
  enforceRateLimit,
  createRateLimitError,
  getLimiter,
  auditEvent,
  clearLimitersCache,
  clearRedisRateLimitKeys,
};

