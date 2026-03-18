/**
 * Serviço de gerenciamento de Tenants usando PostgreSQL
 * 
 * Esta é uma versão que usa PostgreSQL quando disponível.
 * Usado como fallback/complemento ao tenantService.js original.
 */

const { isConnected } = require('../db/index');
const { getSequelize } = require('../db/sequelize');
const { Tenant } = require('../db/models');
const logger = require('../utils/logger');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeErrorMessage(err, fallback = '') {
  if (!err) return fallback;
  try {
    const message = safeToString(err.message, '');
    return message || safeToString(err, fallback) || fallback;
  } catch (_) {
    return safeToString(err, fallback);
  }
}

function safeIsoDate(value, fallback = null) {
  if (value == null) return fallback;
  try {
    if (typeof value.toISOString === 'function') {
      return value.toISOString();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  } catch (_) {
    return fallback;
  }
}

function safeToDate(value, fallback = null) {
  if (value == null) return fallback;
  try {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function toTenantPayload(tenant) {
  return {
    id: tenant.tenant_key,
    tenant_key: tenant.tenant_key,
    name: tenant.name,
    site: tenant.site,
    ramo_atividade: tenant.ramo_atividade,
    objetivo: tenant.objetivo,
    active: tenant.status !== 'suspended' && tenant.status !== 'terminated',
    status: tenant.status,
    plan: tenant.plan,
    limits: tenant.limits || {},
    settings: tenant.settings || {},
    branding: tenant.branding || {},
    createdAt: safeIsoDate(tenant.createdAt, new Date().toISOString()),
    updatedAt: safeIsoDate(tenant.updatedAt, new Date().toISOString()),
    suspendedAt: safeIsoDate(tenant.suspendedAt, null),
    trialExpiresAt: safeIsoDate(tenant.trialExpiresAt, null),
  };
}

/**
 * Verifica se PostgreSQL está disponível
 */
function isPostgresAvailable() {
  try {
    return isConnected();
  } catch (err) {
    return false;
  }
}

/**
 * Obtém um tenant por chave usando PostgreSQL
 * 
 * @param {string} tenantKey - Chave do tenant
 * @returns {Promise<Object|null>} Tenant ou null se não encontrado
 */
async function getTenantFromPg(tenantKey) {
  if (!isPostgresAvailable()) {
    return null;
  }

  try {
    const TenantModel = typeof Tenant === 'function' ? Tenant() : Tenant;
    const tenant = await TenantModel.findOne({
      where: { tenant_key: tenantKey },
    });

    if (!tenant) {
      return null;
    }

    // Converte para formato compatível com o tenantService original
    return toTenantPayload(tenant);
  } catch (err) {
    logger.warn('[TenantServicePg] Erro ao buscar tenant do PostgreSQL:', safeErrorMessage(err));
    return null;
  }
}

/**
 * Lista todos os tenants usando PostgreSQL
 * 
 * @returns {Promise<Array>} Lista de tenants
 */
async function listTenantsFromPg() {
  if (!isPostgresAvailable()) {
    return [];
  }

  try {
    const TenantModel = typeof Tenant === 'function' ? Tenant() : Tenant;
    const tenants = await TenantModel.findAll({
      order: [['created_at', 'DESC']],
    });

    return tenants.map((tenant) => toTenantPayload(tenant));
  } catch (err) {
    logger.warn('[TenantServicePg] Erro ao listar tenants do PostgreSQL:', safeErrorMessage(err));
    return [];
  }
}

/**
 * Cria ou atualiza um tenant no PostgreSQL
 * 
 * @param {Object} tenantData - Dados do tenant
 * @returns {Promise<{success: boolean, tenant?: Object, error?: string}>}
 */
async function saveTenantToPg(tenantData) {
  if (!isPostgresAvailable()) {
    return { success: false, error: 'PostgreSQL não disponível' };
  }

  try {
    const safeTenantData = tenantData && typeof tenantData === 'object' ? tenantData : {};
    const TenantModel = typeof Tenant === 'function' ? Tenant() : Tenant;
    const tenantKey = safeToString(safeTenantData.id || safeTenantData.tenant_key, '');

    if (!tenantKey) {
      return { success: false, error: 'tenant_key é obrigatório' };
    }

    const existing = await TenantModel.findOne({
      where: { tenant_key: tenantKey },
    });

    const tenantDataToSave = {
      tenant_key: tenantKey,
      name: safeTenantData.name,
      site: safeTenantData.site,
      ramo_atividade: safeTenantData.ramo_atividade,
      objetivo: safeTenantData.objetivo,
      status: safeTenantData.status || 'trial',
      plan: safeTenantData.plan || 'trial',
      limits: safeTenantData.limits || {},
      settings: safeTenantData.settings || {},
      branding: safeTenantData.branding || {},
      suspendedAt: safeToDate(safeTenantData.suspendedAt, null),
      trialExpiresAt: safeToDate(safeTenantData.trialExpiresAt, null),
    };

    let tenant;
    if (existing) {
      await existing.update(tenantDataToSave);
      tenant = existing;
    } else {
      tenant = await TenantModel.create(tenantDataToSave);
    }

    return {
      success: true,
      tenant: toTenantPayload(tenant),
    };
  } catch (err) {
    logger.error('[TenantServicePg] Erro ao salvar tenant no PostgreSQL:', safeErrorMessage(err));
    return { success: false, error: safeErrorMessage(err) };
  }
}

module.exports = {
  isPostgresAvailable,
  getTenantFromPg,
  listTenantsFromPg,
  saveTenantToPg,
};
