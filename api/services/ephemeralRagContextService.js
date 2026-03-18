const crypto = require('crypto');
const logger = require('../utils/logger');
const { getEphemeralContextClient } = require('../../infra/redis/ephemeralContextClient');

const memoryStore = new Map(); // key -> { value, expiresAt }

function nowMs() {
  return Date.now();
}

function getReadyRedisClientOrNull() {
  const redis = getEphemeralContextClient();
  if (!redis) return null;
  // Com enableOfflineQueue=false, não podemos enviar comandos enquanto não estiver "ready"
  if (redis.status !== 'ready') return null;
  return redis;
}

function safeString(v) {
  if (v === null || v === undefined) return '';
  try { return String(v); } catch (_) { return ''; }
}

function safeErrorMessage(err, fallback = '') {
  if (err == null) return fallback;
  try { return String(err.message); } catch (_) { return safeString(err) || fallback; }
}

function normalizeText(s) {
  return safeString(s).replace(/\s+/g, ' ').trim();
}

function sha256(text) {
  return crypto.createHash('sha256').update(safeString(text), 'utf8').digest('hex');
}

function getTtlSeconds(input) {
  const env = Number(process.env.EPHEMERAL_RAG_TTL_SECONDS);
  const fallback = Number.isFinite(env) && env > 0 ? env : 1800; // 30min
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(60, Math.min(6 * 3600, Math.floor(n))); // 1min..6h
}

function buildKey(tenantId, executionId) {
  return `ctx:${tenantId}:${executionId}`;
}

function coerceChunk(c) {
  const sourceType = safeString(c?.sourceType || '').trim();
  const sourceId = safeString(c?.sourceId || '').trim();
  const text = normalizeText(c?.text || c?.excerpt || '');
  if (!text || text.length < 20) return null;
  if (!sourceId) return null;
  const finalSourceType = (sourceType === 'uploaded_file' || sourceType === 'web_scraping' || sourceType === 'unknown')
    ? sourceType
    : 'unknown';
  return {
    sourceType: finalSourceType,
    sourceId: sourceId.slice(0, 240),
    text: text.slice(0, 4000),
    score: 0, // efêmero: não há score vetorial
  };
}

function dedupeAndCapWithStats(chunks) {
  const out = [];
  const seen = new Set();
  let totalChars = 0;
  const stats = {
    received: Array.isArray(chunks) ? chunks.length : 0,
    droppedShortText: 0,
    droppedMissingSourceId: 0,
    droppedInvalid: 0,
    droppedDuplicate: 0,
    cappedByCount: false,
    cappedByChars: false,
  };

  for (const c of Array.isArray(chunks) ? chunks : []) {
    if (!c || typeof c !== 'object') {
      stats.droppedInvalid += 1;
      continue;
    }
    const sourceId = safeString(c?.sourceId || '').trim();
    const text = normalizeText(c?.text || c?.excerpt || '');
    if (!sourceId) {
      stats.droppedMissingSourceId += 1;
      continue;
    }
    if (!text || text.length < 20) {
      stats.droppedShortText += 1;
      continue;
    }
    const cc = coerceChunk(c);
    if (!cc) {
      stats.droppedInvalid += 1;
      continue;
    }
    const h = sha256(`${cc.sourceType}|${cc.sourceId}|${cc.text}`);
    if (seen.has(h)) {
      stats.droppedDuplicate += 1;
      continue;
    }
    seen.add(h);
    out.push(cc);
    totalChars += cc.text.length;
    if (out.length >= 30) {
      stats.cappedByCount = true;
      break;
    }
    if (totalChars >= 30000) {
      stats.cappedByChars = true;
      break;
    }
  }

  return { chunks: out, stats };
}

function dedupeAndCap(chunks) {
  return dedupeAndCapWithStats(chunks).chunks;
}

async function getFromMemory(key) {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

async function setToMemory(key, value, ttlSeconds) {
  memoryStore.set(key, { value, expiresAt: nowMs() + ttlSeconds * 1000 });
}

/**
 * Upsert contexto efêmero (chunks) com TTL.
 *
 * @param {{
 *  tenantId: string,
 *  executionId: string,
 *  chunks: Array<{sourceType: string, sourceId: string, text: string}>,
 *  ttlSeconds?: number,
 *  replace?: boolean,
 * }} input
 */
async function upsertEphemeralContext(input) {
  const tenantId = safeString(input?.tenantId).trim();
  const executionId = safeString(input?.executionId).trim();
  if (!tenantId) throw new Error('tenantId é obrigatório');
  if (!executionId) throw new Error('executionId é obrigatório');
  if (executionId.length > 120) throw new Error('executionId muito longo');

  const ttlSeconds = getTtlSeconds(input?.ttlSeconds);
  const key = buildKey(tenantId, executionId);

  const { chunks: incoming, stats } = dedupeAndCapWithStats(input?.chunks || []);
  if (incoming.length === 0) {
    logger.info('[EphemeralContext] Upsert noop (nenhum chunk válido)', {
      tenantId,
      executionId,
      ttlSeconds,
      key,
      used: 'noop',
      stats,
    });
    return { ok: true, stored: 0, ttlSeconds, key, used: 'noop', stats };
  }

  const redis = getReadyRedisClientOrNull();
  const replace = input?.replace === true;

  let merged = incoming;

  try {
    if (!replace) {
      let existing = null;
      if (redis) {
        const raw = await redis.get(key);
        existing = raw ? JSON.parse(raw) : null;
      } else {
        existing = await getFromMemory(key);
      }
      const prevChunks = Array.isArray(existing?.chunks) ? existing.chunks : [];
      merged = dedupeAndCap([...prevChunks, ...incoming]);
    }
  } catch (err) {
    logger.warn('[EphemeralContext] Falha ao ler contexto existente, sobrescrevendo', { tenantId, executionId, error: safeErrorMessage(err) });
    merged = incoming;
  }

  const payload = {
    tenantId,
    executionId,
    chunks: merged,
    updatedAt: new Date().toISOString(),
  };

  try {
    if (redis) {
      await redis.set(key, JSON.stringify(payload), 'EX', ttlSeconds);
      logger.info('[EphemeralContext] Contexto efêmero gravado', {
        tenantId,
        executionId,
        ttlSeconds,
        key,
        used: 'redis',
        stored: merged.length,
        replace,
        stats,
      });
      return { ok: true, stored: merged.length, ttlSeconds, key, used: 'redis', stats };
    }
  } catch (err) {
    // Em dev, é comum o Redis ainda não estar pronto (enableOfflineQueue=false).
    // Não devemos falhar a requisição: degradamos para memória e seguimos.
    logger.warn('[EphemeralContext] Falha ao persistir no Redis, usando fallback memória', {
      tenantId,
      executionId,
      error: safeErrorMessage(err),
    });
  }

  await setToMemory(key, payload, ttlSeconds);
  logger.info('[EphemeralContext] Contexto efêmero gravado', {
    tenantId,
    executionId,
    ttlSeconds,
    key,
    used: 'memory',
    stored: merged.length,
    replace,
    stats,
  });
  return { ok: true, stored: merged.length, ttlSeconds, key, used: 'memory', stats };

}

/**
 * Recupera contexto efêmero.
 *
 * @param {{ tenantId: string, executionId: string }} input
 */
async function getEphemeralContext(input) {
  const tenantId = safeString(input?.tenantId).trim();
  const executionId = safeString(input?.executionId).trim();
  if (!tenantId || !executionId) return { ok: true, found: false, chunks: [], used: 'noop' };
  const key = buildKey(tenantId, executionId);

  const redis = getReadyRedisClientOrNull();
  try {
    const data = redis ? await redis.get(key) : await getFromMemory(key);
    if (!data) return { ok: true, found: false, chunks: [], used: redis ? 'redis' : 'memory' };
    const parsed = redis ? JSON.parse(data) : data;
    const chunks = Array.isArray(parsed?.chunks) ? parsed.chunks : [];
    return { ok: true, found: chunks.length > 0, chunks, used: redis ? 'redis' : 'memory' };
  } catch (err) {
    logger.warn('[EphemeralContext] Falha ao recuperar contexto', { tenantId, executionId, error: safeErrorMessage(err) });
    return { ok: true, found: false, chunks: [], used: redis ? 'redis' : 'memory' };
  }
}

module.exports = {
  upsertEphemeralContext,
  getEphemeralContext,
};

