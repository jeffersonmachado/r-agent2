'use strict';

const logger = require('../utils/logger');
const { getRedisClientOrNull } = require('../utils/redisClient');

const DEFAULT_TTL_SECONDS = Number(process.env.CONVERSATION_SESSION_TTL_SECONDS || 86400);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function buildConversationSessionKey({ tenantId, sessionId }) {
  return `conversation_session:${String(tenantId)}:${String(sessionId)}`;
}

class ConversationSessionStore {
  constructor() {
    this.memory = new Map();
    this.defaultTtlSeconds = toPositiveInt(process.env.CONVERSATION_SESSION_TTL_SECONDS, DEFAULT_TTL_SECONDS);
    this.redisFallbackCount = 0;
  }

  resolveTtl(ttl) {
    return toPositiveInt(ttl, this.defaultTtlSeconds);
  }

  serialize(value) {
    return JSON.stringify({ value, updatedAt: new Date().toISOString() });
  }

  deserialize(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed.value : null;
    } catch (_) {
      return null;
    }
  }

  getMemory(sessionKey) {
    const row = this.memory.get(sessionKey);
    if (!row) return null;
    if (row.expiresAt && row.expiresAt <= Date.now()) {
      this.memory.delete(sessionKey);
      return null;
    }
    return row.value;
  }

  setMemory(sessionKey, value, ttl) {
    const ttlSeconds = this.resolveTtl(ttl);
    this.memory.set(sessionKey, {
      value,
      expiresAt: Date.now() + (ttlSeconds * 1000),
    });
    return true;
  }

  warnRedisFallback(operation, sessionKey, err) {
    this.redisFallbackCount += 1;
    logger.warn('[ConversationSessionStore] Redis indisponível; usando fallback em memória', {
      operation,
      sessionKey,
      redisFallbackCount: this.redisFallbackCount,
      error: err && err.message ? err.message : String(err || 'unknown_error'),
    });
  }

  async get(sessionKey) {
    const redis = getRedisClientOrNull();
    if (redis) {
      try {
        const raw = await redis.get(sessionKey);
        const parsed = this.deserialize(raw);
        if (parsed !== null) return parsed;
      } catch (err) {
        this.warnRedisFallback('get', sessionKey, err);
      }
    }
    return this.getMemory(sessionKey);
  }

  async set(sessionKey, value, ttl) {
    const ttlSeconds = this.resolveTtl(ttl);
    const redis = getRedisClientOrNull();
    if (redis) {
      try {
        await redis.set(sessionKey, this.serialize(value), 'EX', ttlSeconds);
        return true;
      } catch (err) {
        this.warnRedisFallback('set', sessionKey, err);
      }
    }
    return this.setMemory(sessionKey, value, ttlSeconds);
  }

  async update(sessionKey, patch) {
    const current = await this.get(sessionKey);
    const base = current && typeof current === 'object' ? current : {};
    const applied = patch && typeof patch === 'object'
      ? { ...base, ...patch }
      : base;
    await this.set(sessionKey, applied, this.defaultTtlSeconds);
    return applied;
  }

  async delete(sessionKey) {
    const redis = getRedisClientOrNull();
    if (redis) {
      try {
        await redis.del(sessionKey);
      } catch (err) {
        this.warnRedisFallback('delete', sessionKey, err);
      }
    }
    this.memory.delete(sessionKey);
    return true;
  }
}

const conversationSessionStore = new ConversationSessionStore();

module.exports = {
  ConversationSessionStore,
  conversationSessionStore,
  buildConversationSessionKey,
};
