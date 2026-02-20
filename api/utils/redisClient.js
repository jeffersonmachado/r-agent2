// utils/redisClient.js
// Cliente Redis (singleton) para uso interno da API.
// - Usa ioredis (já presente nas dependências)
// - Lê URL de REDIS_URL / RATE_LIMIT_REDIS_URL / config.rateLimit.redis.url
// - Falha de Redis NÃO deve derrubar a API: retorna null se indisponível.

'use strict';

const Redis = require('ioredis');
const config = require('./config');
const logger = require('./logger');

let _client = null;
let _initTried = false;

function resolveRedisUrl() {
  const envUrl = process.env.RATE_LIMIT_REDIS_URL || process.env.REDIS_URL;
  if (envUrl && typeof envUrl === 'string') return envUrl;

  try {
    const fromConfig = config?.get?.('rateLimit.redis.url');
    if (fromConfig && typeof fromConfig === 'string') return fromConfig;
  } catch (_) {
    // ignore
  }
  return null;
}

function getRedisClientOrNull() {
  if (_client) return _client;
  if (_initTried) return null;
  _initTried = true;

  const url = resolveRedisUrl();
  if (!url) return null;

  try {
    const c = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });

    c.on('error', (err) => {
      try {
        logger.warn('[Redis] erro no cliente Redis (não fatal)', { message: err?.message || String(err) });
      } catch (_) {}
    });

    // Conecta de forma best-effort
    c.connect().catch((err) => {
      try {
        logger.warn('[Redis] falha ao conectar (não fatal)', { message: err?.message || String(err) });
      } catch (_) {}
    });

    _client = c;
    return _client;
  } catch (err) {
    try {
      logger.warn('[Redis] não foi possível inicializar o cliente (não fatal)', { message: err?.message || String(err) });
    } catch (_) {}
    return null;
  }
}

module.exports = { getRedisClientOrNull };
