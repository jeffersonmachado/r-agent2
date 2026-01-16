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
      createdAt: tenant.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: tenant.updatedAt?.toISOString() || new Date().toISOString(),
      suspendedAt: tenant.suspendedAt?.toISOString() || null,
      trialExpiresAt: tenant.trialExpiresAt?.toISOString() || null,
    };
  } catch (err) {
    logger.warn('[TenantServicePg] Erro ao buscar tenant do PostgreSQL:', err.message);
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

    return tenants.map(tenant => ({
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
      createdAt: tenant.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: tenant.updatedAt?.toISOString() || new Date().toISOString(),
      suspendedAt: tenant.suspendedAt?.toISOString() || null,
      trialExpiresAt: tenant.trialExpiresAt?.toISOString() || null,
    }));
  } catch (err) {
    logger.warn('[TenantServicePg] Erro ao listar tenants do PostgreSQL:', err.message);
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
    const TenantModel = typeof Tenant === 'function' ? Tenant() : Tenant;
    const tenantKey = tenantData.id || tenantData.tenant_key;

    if (!tenantKey) {
      return { success: false, error: 'tenant_key é obrigatório' };
    }

    const existing = await TenantModel.findOne({
      where: { tenant_key: tenantKey },
    });

    const tenantDataToSave = {
      tenant_key: tenantKey,
      name: tenantData.name,
      site: tenantData.site,
      ramo_atividade: tenantData.ramo_atividade,
      objetivo: tenantData.objetivo,
      status: tenantData.status || 'trial',
      plan: tenantData.plan || 'trial',
      limits: tenantData.limits || {},
      settings: tenantData.settings || {},
      branding: tenantData.branding || {},
      suspendedAt: tenantData.suspendedAt ? new Date(tenantData.suspendedAt) : null,
      trialExpiresAt: tenantData.trialExpiresAt ? new Date(tenantData.trialExpiresAt) : null,
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
      tenant: {
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
        createdAt: tenant.createdAt?.toISOString() || new Date().toISOString(),
        updatedAt: tenant.updatedAt?.toISOString() || new Date().toISOString(),
        suspendedAt: tenant.suspendedAt?.toISOString() || null,
        trialExpiresAt: tenant.trialExpiresAt?.toISOString() || null,
      },
    };
  } catch (err) {
    logger.error('[TenantServicePg] Erro ao salvar tenant no PostgreSQL:', err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  isPostgresAvailable,
  getTenantFromPg,
  listTenantsFromPg,
  saveTenantToPg,
};
