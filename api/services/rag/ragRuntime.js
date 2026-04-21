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

function normalizeTenantId(tenantId) {
  if (tenantId === null || tenantId === undefined) return null;
  const tid = safeTrim(tenantId);
  return tid || null;
}

async function getTenantContextForRag(tenantId) {
  const finalTenantId = normalizeTenantId(tenantId);
  if (!finalTenantId) return null;
  if (!getSequelize()) return null;

  try {
    const TenantContextModel = typeof TenantContextGetter === 'function' ? TenantContextGetter() : TenantContextGetter;
    if (!TenantContextModel) return null;
    const row = await TenantContextModel.findByPk(finalTenantId);
    if (!row) return null;
    const base = row.toJSON ? row.toJSON() : (row.dataValues || row);
    return {
      tenantId: base.tenant_key,
      ramo_atividade: base.ramo_atividade || '',
      objetivo: base.objetivo || '',
      site_oficial: base.site_oficial || '',
      prioridade: base.prioridade || 'HIGH',
      escopo: Array.isArray(base.escopo) ? base.escopo : ['rag', 'chatbot', 'classificacao_intencao'],
    };
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
  fetchWithTimeout,
  getRagDomainConfig,
  getRagDomainSources,
  getRagDomains,
  getRagServiceUrl,
  getRagTimeout,
  getTenantContextForRag,
  handleRagHttpError,
  isRagDomainEnabled,
  normalizeTenantId,
};