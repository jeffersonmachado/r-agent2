'use strict';

/**
 * Cache de respostas RAG (caminho de chat) — SOMENTE memória.
 *
 * Segue o mesmo padrão de rag/ragContextCache.js: Map com
 * { value, expiresAt }, TTL + capacidade máxima com evicção do mais antigo
 * (Map preserva ordem de inserção; a primeira chave é a mais antiga).
 * Sem persistência em disco.
 *
 * Chave: SHA-256 de `${tenantId}::${pergunta normalizada}::${escopo}`.
 * A normalização da pergunta replica a do rag-service Python
 * (rag-service/services/embedding_service.py:_normalize_query_text):
 * strip + lowercase + colapso de whitespace.
 *
 * DECISÃO DE PROJETO: TTL simples, SEM invalidação por reindex.
 *
 * NOTA: Em produção, isso pode ser substituído por cache distribuído
 * (Redis, etc.).
 */

const crypto = require('crypto');
const logger = require('../../utils/logger');

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 min
const DEFAULT_MAX_ENTRIES = 1000;

// Cache em memória: cacheKey -> { value, expiresAt }
const responseCache = new Map();

/**
 * Coerção defensiva de inteiro positivo vindo de env.
 */
function coercePositiveInt(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

function getTtlMs() {
  return coercePositiveInt(process.env.RAG_RESPONSE_CACHE_TTL_MS, DEFAULT_TTL_MS);
}

function getMaxEntries() {
  return coercePositiveInt(process.env.RAG_RESPONSE_CACHE_MAX, DEFAULT_MAX_ENTRIES);
}

/**
 * Normalização da pergunta igual à do Python (_normalize_query_text):
 * strip + lowercase + colapso de whitespace.
 *
 * @param {string} question
 * @returns {string}
 */
function normalizeQuestion(question) {
  return String(question == null ? '' : question)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Constrói a chave de cache: SHA-256 de tenant + pergunta normalizada +
 * escopo serializado (tudo que afeta o resultado do /rag/query: scope de
 * domínio, filtros, opções e tenant_context injetado na query).
 *
 * @param {string} tenantId
 * @param {string} question - Pergunta ORIGINAL (será normalizada aqui)
 * @param {Object|null} [scope] - Partes do request que afetam o resultado
 * @returns {string} Hash hex SHA-256
 */
function buildCacheKey(tenantId, question, scope = null) {
  const scopePart = scope ? JSON.stringify(scope) : '';
  return crypto
    .createHash('sha256')
    .update(`${tenantId}::${normalizeQuestion(question)}::${scopePart}`)
    .digest('hex');
}

/**
 * Evicção do mais antigo quando a capacidade máxima é atingida.
 * Map preserva ordem de inserção: a primeira chave é a mais antiga.
 */
function evictOldestIfNeeded() {
  const maxEntries = getMaxEntries();
  while (responseCache.size >= maxEntries && responseCache.size > 0) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
    logger.debug('[ragResponseCache] Entrada mais antiga removida por limite de capacidade', {
      evictedKey: oldestKey.substring(0, 16),
      maxEntries,
    });
  }
}

/**
 * Lê entrada válida (não expirada). Entrada expirada = miss (e remove).
 * Retorna uma CÓPIA superficial do valor cacheado, para que mutações do
 * chamador nunca alterem a entrada cacheada.
 *
 * @param {string} cacheKey
 * @returns {Object|null} Cópia da resposta cacheada ou null
 */
function getCachedResponse(cacheKey) {
  if (!cacheKey || !responseCache.has(cacheKey)) {
    return null;
  }
  const entry = responseCache.get(cacheKey);
  if (!entry || typeof entry !== 'object' || !('value' in entry)) {
    responseCache.delete(cacheKey);
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(cacheKey);
    logger.debug('[ragResponseCache] Entrada de cache expirada', {
      cacheKey: cacheKey.substring(0, 16),
    });
    return null;
  }
  return { ...entry.value };
}

/**
 * Armazena resposta no cache. Valores inválidos (null, não-objeto) são
 * ignorados — erros/fallbacks nunca devem ser cacheados pelo chamador.
 *
 * @param {string} cacheKey
 * @param {Object} response - Resposta de sucesso do queryRag
 */
function setCachedResponse(cacheKey, response, tenantId = null) {
  if (!cacheKey || !response || typeof response !== 'object') {
    return;
  }
  if (!responseCache.has(cacheKey)) {
    evictOldestIfNeeded();
  }
  responseCache.set(cacheKey, {
    value: response,
    expiresAt: Date.now() + getTtlMs(),
    tenantId: tenantId ? String(tenantId) : null,
  });
  logger.debug('[ragResponseCache] Resposta RAG armazenada em cache', {
    cacheKey: cacheKey.substring(0, 16),
    ttlMs: getTtlMs(),
  });
}

/** Invalida respostas após qualquer mutação/revogação do corpus do tenant. */
function invalidateTenant(tenantId) {
  if (!tenantId) return 0;
  const normalized = String(tenantId);
  let removed = 0;
  for (const [key, entry] of responseCache.entries()) {
    if (entry?.tenantId === normalized) {
      responseCache.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Limpa o cache (uso operacional/testes).
 */
function clearResponseCache() {
  responseCache.clear();
}

module.exports = {
  buildCacheKey,
  normalizeQuestion,
  getCachedResponse,
  setCachedResponse,
  invalidateTenant,
  clearResponseCache,
};
