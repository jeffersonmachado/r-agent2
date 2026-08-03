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

module.exports = {
  DEFAULT_RAG_SERVICE_URL,
  DEFAULT_RAG_TIMEOUT,
  DEFAULT_RAG_QUERY_TIMEOUT,
  fetchWithTimeout,
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
  isRagDomainEnabled,
  normalizeTenantId,
};