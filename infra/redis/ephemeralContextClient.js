/**
 * Cliente Redis para contexto efêmero (dry-run).
 *
 * Objetivo:
 * - Armazenar evidências/chunks temporários com TTL (sem persistir em Postgres/pgvector)
 * - Permitir que /system/suggest-description use essas evidências em dry-run
 */

const Redis = require('ioredis');
const logger = require('../../api/utils/logger');
const config = require('../../api/utils/config');

let client = null;
let connectionAttempts = 0;
const MAX_RECONNECTION_ATTEMPTS = process.env.NODE_ENV === 'production' ? null : 8;

function getRedisUrl() {
  return config.get('rateLimit.redis.url')
    || process.env.REDIS_URL
    || process.env.RATE_LIMIT_REDIS_URL
    || 'redis://localhost:6379';
}

function getEphemeralContextClient() {
  // Reaproveita SEMPRE o mesmo cliente quando ele já existe.
  // Importante: com enableOfflineQueue=false, enviar comandos antes de "ready" pode causar
  // "Stream isn't writeable" — por isso quem usa este client deve checar status === 'ready'
  // antes de executar comandos. O objetivo aqui é evitar recriações infinitas enquanto conecta.
  if (client) {
    // Se o client já morreu/fechou, permite recriar.
    if (client.status === 'end' || client.status === 'close') {
      client = null;
    } else {
      return client;
    }
  }

  // Dev: se estourou tentativas, desliga e usa fallback (memória)
  if (MAX_RECONNECTION_ATTEMPTS && connectionAttempts >= MAX_RECONNECTION_ATTEMPTS) {
    logger.warn('[EphemeralContext] Limite de tentativas de conexão excedido, usando modo memória', {
      attempts: connectionAttempts,
      maxAttempts: MAX_RECONNECTION_ATTEMPTS,
    });
    try { client?.disconnect(); } catch {}
    client = null;
    return null;
  }

  const redisUrl = getRedisUrl();
  if (process.env.NODE_ENV === 'production' && !redisUrl) {
    throw new Error('REDIS_URL é obrigatória em produção para contexto efêmero');
  }

  try {
    client = new Redis(redisUrl, {
      keyPrefix: 'erag:',
      retryStrategy: (times) => {
        connectionAttempts = times;
        if (MAX_RECONNECTION_ATTEMPTS && times > MAX_RECONNECTION_ATTEMPTS) {
          logger.warn('[EphemeralContext] Limite de reconexões atingido, desabilitando Redis (dev)', {
            attempts: times,
            maxAttempts: MAX_RECONNECTION_ATTEMPTS,
          });
          try { client?.disconnect(); } catch {}
          client = null;
          return null;
        }
        return Math.min(times * 50, 2000);
      },
      connectTimeout: 8000,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });

    client.on('ready', () => {
      connectionAttempts = 0;
      logger.info('[EphemeralContext] Redis pronto para uso');
    });
    client.on('error', (err) => {
      if (!MAX_RECONNECTION_ATTEMPTS || connectionAttempts <= MAX_RECONNECTION_ATTEMPTS) {
        logger.error('[EphemeralContext] Erro no Redis', { error: err.message });
      }
    });

    // Conecta explicitamente (best-effort em dev)
    client.connect().catch((err) => {
      connectionAttempts += 1;
      if (process.env.NODE_ENV === 'production') {
        throw err;
      }
      logger.warn('[EphemeralContext] Falha ao conectar Redis (dev), usando fallback memória', { error: err.message });
      try { client?.disconnect(); } catch {}
      client = null;
    });

    return client;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('[EphemeralContext] Falha ao criar cliente Redis (dev), usando fallback memória', { error: err.message });
      return null;
    }
    throw err;
  }
}

module.exports = {
  getEphemeralContextClient,
};

