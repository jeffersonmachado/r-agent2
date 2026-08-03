'use strict';

const config = require('../../utils/config');
const logger = require('../../utils/logger');
const { getSequelize } = require('../../db/sequelize');
const { TenantContext: TenantContextGetter } = require('../../db/models');
const {
  safeTrim,
  safeErrorMessage,
} = require('../../utils/defensiveCoercion');

const DEFAULT_RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || config.get('rag.serviceUrl', 'http://localhost:8001');
const DEFAULT_RAG_TIMEOUT = parseInt(process.env.RAG_TIMEOUT || config.get('rag.timeout', '5000'), 10);
// Timeout dedicado do caminho /rag/query: precisa acomodar a geração LLM no
// serviço Python (que desiste da OpenAI em ~25s). Demais chamadas (health,
// index, etc.) continuam usando DEFAULT_RAG_TIMEOUT.
const DEFAULT_RAG_QUERY_TIMEOUT = parseInt(process.env.RAG_QUERY_TIMEOUT || config.get('rag.queryTimeoutMs', '30000'), 10);

function normalizeTenantId(tenantId) {
  if (tenantId === null || tenantId === undefined) return null;
  const tid = safeTrim(tenantId);
  return tid || null;
}

const TENANT_CONTEXT_CACHE_TTL_MS = 60000;

/**
 * Cache em memória do tenant_context para RAG (chave = tenantId).
 * TTL de 60s cobre a defasagem de writers fora do caminho invalidado
 * explicitamente (ver invalidateTenantContextCache).
 * @type {Map<string, { value: Object|null, expiresAt: number }>}
 */
const tenantContextCache = new Map();

/**
 * Invalida a entrada de cache do tenant_context de um tenant.
 * Deve ser chamada por qualquer writer de tenant_context (ex.: tenantService).
 *
 * @param {string} tenantId
 */
function invalidateTenantContextCache(tenantId) {
  const finalTenantId = normalizeTenantId(tenantId);
  if (!finalTenantId) return;
  tenantContextCache.delete(finalTenantId);
}

async function getTenantContextForRag(tenantId) {
  const finalTenantId = normalizeTenantId(tenantId);
  if (!finalTenantId) return null;
  if (!getSequelize()) return null;

  const cached = tenantContextCache.get(finalTenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const TenantContextModel = typeof TenantContextGetter === 'function' ? TenantContextGetter() : TenantContextGetter;
    if (!TenantContextModel) return null;
    const row = await TenantContextModel.findByPk(finalTenantId);
    const value = row
      ? (() => {
          const base = row.toJSON ? row.toJSON() : (row.dataValues || row);
          return {
            tenantId: base.tenant_key,
            ramo_atividade: base.ramo_atividade || '',
            objetivo: base.objetivo || '',
            site_oficial: base.site_oficial || '',
            prioridade: base.prioridade || 'HIGH',
            escopo: Array.isArray(base.escopo) ? base.escopo : ['rag', 'chatbot', 'classificacao_intencao'],
          };
        })()
      : null;
    tenantContextCache.set(finalTenantId, {
      value,
      expiresAt: Date.now() + TENANT_CONTEXT_CACHE_TTL_MS,
    });
    return value;
  } catch (err) {
    logger.warn('[RAGService] Erro ao consultar tenant_context no PostgreSQL', {
      tenantId: finalTenantId,
      error: safeErrorMessage(err),
    });
    return null;
  }
}

function getRagServiceUrl(tenantId) {
  const finalTenantId = normalizeTenantId(tenantId);
  if (process.env.RAG_SERVICE_URL) {
    return process.env.RAG_SERVICE_URL;
  }

  if (!finalTenantId) {
    return DEFAULT_RAG_SERVICE_URL;
  }

  const ragConfig = config.get('rag', {});
  const tenantsConfig = ragConfig.tenants || {};
  const tenantConfig = tenantsConfig[finalTenantId];

  if (tenantConfig && tenantConfig.serviceUrl) {
    return tenantConfig.serviceUrl;
  }

  return DEFAULT_RAG_SERVICE_URL;
}

function getRagTimeout(tenantId) {
  const finalTenantId = normalizeTenantId(tenantId);
  if (!finalTenantId) {
    return DEFAULT_RAG_TIMEOUT;
  }

  const ragConfig = config.get('rag', {});
  const tenantsConfig = ragConfig.tenants || {};
  const tenantConfig = tenantsConfig[finalTenantId];

  if (tenantConfig && tenantConfig.timeout) {
    return parseInt(tenantConfig.timeout, 10);
  }

  return DEFAULT_RAG_TIMEOUT;
}

/**
 * Timeout dedicado para o caminho de query (/rag/query), que inclui geração
 * LLM no serviço Python. Configurável por tenant via
 * rag.tenants[tenantId].queryTimeoutMs, globalmente via rag.queryTimeoutMs
 * ou RAG_QUERY_TIMEOUT; fallback de 30s.
 */
function getRagQueryTimeout(tenantId) {
  const finalTenantId = normalizeTenantId(tenantId);
  if (!finalTenantId) {
    return DEFAULT_RAG_QUERY_TIMEOUT;
  }

  const ragConfig = config.get('rag', {});
  const tenantsConfig = ragConfig.tenants || {};
  const tenantConfig = tenantsConfig[finalTenantId];

  if (tenantConfig && tenantConfig.queryTimeoutMs) {
    return parseInt(tenantConfig.queryTimeoutMs, 10);
  }

  return DEFAULT_RAG_QUERY_TIMEOUT;
}

/**
 * Headers de autenticação serviço-a-serviço (backend Node -> rag-service).
 * O token é lido de RAG_INTERNAL_TOKEN a cada chamada (sem cache) para
 * permitir rotação sem restart. Quando não configurado, retorna objeto vazio
 * (o serviço Python aceita apenas se também estiver sem token — modo dev).
 */
function getRagInternalHeaders() {
  const token = process.env.RAG_INTERNAL_TOKEN;
  return token ? { 'X-RAG-Internal-Token': token } : {};
}

function getRagDomains(tenantId) {
  const ragConfig = config.get('rag', {});
  const tenantsConfig = ragConfig.tenants || {};
  const tenantConfig = tenantsConfig[tenantId];

  if (tenantConfig && tenantConfig.domains) {
    return tenantConfig.domains;
  }

  return {
    chatbot: {
      sources: ['knowledge_base', 'product_docs', 'chat_upload'],
      defaultCategory: 'general',
      enabled: true,
    },
    rpa: {
      sources: ['knowledge_base', 'product_docs'],
      defaultCategory: 'rpa',
      enabled: true,
    },
  };
}

function getRagDomainConfig(tenantId, domain) {
  const domains = getRagDomains(tenantId);
  return domains[domain] || null;
}

function isRagDomainEnabled(tenantId, domain) {
  const domainConfig = getRagDomainConfig(tenantId, domain);
  return domainConfig ? domainConfig.enabled !== false : true;
}

function getRagDomainSources(tenantId, domain) {
  const domainConfig = getRagDomainConfig(tenantId, domain);
  return domainConfig ? (domainConfig.sources || []) : [];
}

function handleRagHttpError(response, serviceUrl, endpoint, errorText = 'Erro desconhecido') {
  if (response.status === 404) {
    return new Error(`Endpoint não encontrado no serviço RAG (${serviceUrl}${endpoint}). Verifique se o serviço está configurado corretamente e se as rotas foram carregadas. O serviço pode precisar ser reiniciado.`);
  }
  if (response.status === 500) {
    return new Error(`Erro interno no serviço RAG (${serviceUrl}${endpoint}). Detalhes: ${errorText}`);
  }
  if (response.status === 503) {
    return new Error(`Serviço RAG temporariamente indisponível (${serviceUrl}${endpoint}). Tente novamente mais tarde.`);
  }
  return new Error(`Erro HTTP ${response.status} do serviço RAG: ${errorText}`);
}

// ---------------------------------------------------------------------------
// Circuit breaker (nível de módulo) + retry seletivo para chamadas ao
// rag-service. Abre após N falhas consecutivas (timeout, erro de rede ou
// HTTP 5xx — 4xx NÃO conta) e rejeita imediatamente com code 'rag_unavailable'
// durante o período de reset. Após o reset, uma chamada de probe (meio-aberto)
// fecha o circuito em caso de sucesso.
// ---------------------------------------------------------------------------

const CB_DEFAULT_FAILURE_THRESHOLD = 3;
const CB_DEFAULT_RESET_MS = 30000;
const CB_DEFAULT_RETRY_BASE_MS = 250;
const CB_MAX_RETRIES = 2;

function parsePositiveInt(raw, fallback) {
  const value = parseInt(String(raw), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getCbFailureThreshold() {
  return parsePositiveInt(
    process.env.RAG_CB_FAILURE_THRESHOLD || config.get('rag.circuitBreaker.failureThreshold', String(CB_DEFAULT_FAILURE_THRESHOLD)),
    CB_DEFAULT_FAILURE_THRESHOLD
  );
}

function getCbResetMs() {
  return parsePositiveInt(
    process.env.RAG_CB_RESET_MS || config.get('rag.circuitBreaker.resetMs', String(CB_DEFAULT_RESET_MS)),
    CB_DEFAULT_RESET_MS
  );
}

function getCbRetryBaseMs() {
  return parsePositiveInt(
    process.env.RAG_CB_RETRY_BASE_MS || config.get('rag.circuitBreaker.retryBaseMs', String(CB_DEFAULT_RETRY_BASE_MS)),
    CB_DEFAULT_RETRY_BASE_MS
  );
}

const circuitBreaker = {
  state: 'closed', // 'closed' | 'open' | 'half-open'
  consecutiveFailures: 0,
  openedAt: 0,
  halfOpenInFlight: false,
};

function createRagUnavailableError() {
  const err = new Error('Serviço RAG indisponível no momento (circuit breaker aberto). Tente novamente em instantes.');
  err.code = 'rag_unavailable';
  return err;
}

/**
 * true enquanto o circuito está aberto e ainda dentro da janela de reset.
 * Usado por isRagAvailable para responder false sem ir à rede.
 */
function isRagCircuitOpen() {
  if (circuitBreaker.state !== 'open') return false;
  return (Date.now() - circuitBreaker.openedAt) < getCbResetMs();
}

/** Snapshot do estado do breaker (diagnóstico/testes). */
function getRagCircuitBreakerState() {
  return {
    state: circuitBreaker.state,
    consecutiveFailures: circuitBreaker.consecutiveFailures,
    openedAt: circuitBreaker.openedAt,
  };
}

/** Reseta o breaker (uso em testes). */
function resetRagCircuitBreaker() {
  circuitBreaker.state = 'closed';
  circuitBreaker.consecutiveFailures = 0;
  circuitBreaker.openedAt = 0;
  circuitBreaker.halfOpenInFlight = false;
}

function acquireCircuitSlot() {
  if (circuitBreaker.state !== 'open') return;
  const elapsed = Date.now() - circuitBreaker.openedAt;
  if (elapsed >= getCbResetMs() && !circuitBreaker.halfOpenInFlight) {
    // Meio-aberto: permite UMA chamada de probe.
    circuitBreaker.state = 'half-open';
    circuitBreaker.halfOpenInFlight = true;
    return;
  }
  throw createRagUnavailableError();
}

function recordCircuitSuccess() {
  const wasOpen = circuitBreaker.state !== 'closed';
  circuitBreaker.consecutiveFailures = 0;
  circuitBreaker.state = 'closed';
  circuitBreaker.halfOpenInFlight = false;
  if (wasOpen) {
    logger.info('[RAGService] Circuit breaker fechado: rag-service voltou a responder');
  }
}

function recordCircuitFailure() {
  if (circuitBreaker.state === 'half-open') {
    circuitBreaker.state = 'open';
    circuitBreaker.openedAt = Date.now();
    circuitBreaker.halfOpenInFlight = false;
    logger.warn('[RAGService] Circuit breaker reaberto: probe do rag-service falhou', {
      resetMs: getCbResetMs(),
    });
    return;
  }
  circuitBreaker.consecutiveFailures += 1;
  if (circuitBreaker.consecutiveFailures >= getCbFailureThreshold()) {
    circuitBreaker.state = 'open';
    circuitBreaker.openedAt = Date.now();
    logger.warn('[RAGService] Circuit breaker aberto após falhas consecutivas no rag-service', {
      consecutiveFailures: circuitBreaker.consecutiveFailures,
      resetMs: getCbResetMs(),
    });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeout = DEFAULT_RAG_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`RAG service timeout após ${timeout}ms ao acessar ${url}`);
    }
    if (safeErrorMessage(error).includes('fetch failed')) {
      throw new Error(`Falha ao conectar com serviço RAG em ${url}. Verifique se o serviço está rodando e acessível.`);
    }
    throw error;
  }
}

/**
 * fetch com circuit breaker em nível de módulo + retry seletivo.
 *
 * - Conta como falha: timeout, erro de rede e HTTP 5xx. 4xx NÃO conta
 *   (o serviço está vivo e respondeu).
 * - Circuito aberto: rejeita imediatamente com Error code 'rag_unavailable',
 *   sem ir à rede. Após RAG_CB_RESET_MS, uma chamada de probe (meio-aberto)
 *   fecha o circuito em caso de sucesso.
 * - Retry com backoff exponencial (máx 2 retries: base, 3*base — default
 *   250ms/750ms) APENAS quando `idempotent: true`. Nunca usar retry em
 *   POST de query/index/embeddings.
 * - Falhas são contabilizadas 1x por chamada lógica (retries esgotados
 *   contam como uma única falha).
 *
 * @param {string} url
 * @param {Object} [options]
 * @param {number} [timeout]
 * @param {{ idempotent?: boolean }} [breakerOptions]
 * @returns {Promise<Response>} Resposta HTTP (inclusive 5xx final, para o
 *   caller tratar via handleRagHttpError como antes).
 */
async function fetchRagWithBreaker(url, options = {}, timeout = DEFAULT_RAG_TIMEOUT, { idempotent = false } = {}) {
  acquireCircuitSlot();

  const maxAttempts = idempotent ? CB_MAX_RETRIES + 1 : 1;
  let lastError = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, timeout);
      if (response && response.status >= 500) {
        lastResponse = response;
      } else {
        // Sucesso para o breaker (inclui 4xx: serviço vivo — não conta falha).
        recordCircuitSuccess();
        return response;
      }
    } catch (error) {
      lastError = error;
      lastResponse = null;
    }
    if (attempt < maxAttempts) {
      await sleep(getCbRetryBaseMs() * (2 * attempt - 1));
    }
  }

  recordCircuitFailure();
  if (lastError) throw lastError;
  return lastResponse;
}

module.exports = {
  DEFAULT_RAG_SERVICE_URL,
  DEFAULT_RAG_TIMEOUT,
  DEFAULT_RAG_QUERY_TIMEOUT,
  fetchRagWithBreaker,
  fetchWithTimeout,
  getRagCircuitBreakerState,
  getRagDomainConfig,
  getRagDomainSources,
  getRagDomains,
  getRagInternalHeaders,
  getRagQueryTimeout,
  getRagServiceUrl,
  getRagTimeout,
  getTenantContextForRag,
  handleRagHttpError,
  invalidateTenantContextCache,
  isRagCircuitOpen,
  isRagDomainEnabled,
  normalizeTenantId,
  resetRagCircuitBreaker,
};