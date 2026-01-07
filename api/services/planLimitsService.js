/**
 * Serviço de Planos e Limites.
 * 
 * Gerencia limites por plano e validação de uso.
 * 
 * Planos:
 * - free: Plano gratuito com limites básicos
 * - trial: Trial de 14 dias com limites intermediários
 * - pro: Plano profissional com limites amplos
 * - enterprise: Plano enterprise com limites ilimitados ou customizados
 */

const { getTenant, getTenantUsage } = require('./tenantService');
const logger = require('../utils/logger');

/**
 * Limites padrão por plano.
 */
const PLAN_LIMITS = {
  free: {
    usuarios: 1,
    agentes_ia: 1,
    execucoes_rpa: 10,
    tokens_ia: 10000,
    documentos_rag: 10,
    storage_mb: 100,
  },
  trial: {
    usuarios: 3,
    agentes_ia: 2,
    execucoes_rpa: 50,
    tokens_ia: 50000,
    documentos_rag: 50,
    storage_mb: 500,
  },
  pro: {
    usuarios: 10,
    agentes_ia: 5,
    execucoes_rpa: 500,
    tokens_ia: 500000,
    documentos_rag: 500,
    storage_mb: 5000,
  },
  enterprise: {
    usuarios: -1, // Ilimitado
    agentes_ia: -1,
    execucoes_rpa: -1,
    tokens_ia: -1,
    documentos_rag: -1,
    storage_mb: -1,
  },
};

/**
 * Obtém limites de um plano.
 * 
 * @param {string} plan - Plano (free, trial, pro, enterprise)
 * @returns {Object} Limites do plano
 */
function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.trial;
}

/**
 * Verifica se um tenant pode realizar uma ação baseado nos limites do plano.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} resource - Recurso (usuarios, agentes_ia, execucoes_rpa, tokens_ia, documentos_rag, storage_mb)
 * @param {number} amount - Quantidade a verificar (padrão: 1)
 * @returns {{allowed: boolean, error?: string, limit?: number, current?: number}}
 */
function checkLimit(tenantId, resource, amount = 1) {
  const tenant = getTenant(tenantId);
  if (!tenant) {
    return { allowed: false, error: 'Tenant não encontrado' };
  }

  // Enterprise não tem limites (ou limites customizados)
  if (tenant.plan === 'enterprise') {
    return { allowed: true, limit: -1, current: 0 };
  }

  const limits = tenant.limits || getPlanLimits(tenant.plan);
  const limit = limits[resource];

  // Se limite é -1, é ilimitado
  if (limit === -1) {
    return { allowed: true, limit: -1, current: 0 };
  }

  // TODO: Obter uso atual do tenant (implementar getTenantUsage)
  const usage = getTenantUsage(tenantId);
  const current = usage ? (usage[resource] || 0) : 0;

  if (current + amount > limit) {
    return {
      allowed: false,
      error: `Limite de ${resource} excedido. Limite: ${limit}, Atual: ${current}, Tentativa: ${amount}`,
      limit,
      current,
    };
  }

  return { allowed: true, limit, current };
}

/**
 * Middleware que valida limites antes de executar uma ação.
 * 
 * @param {string} resource - Recurso a verificar
 * @param {number} amount - Quantidade (padrão: 1)
 * @returns {Function} Middleware
 */
function requireLimit(resource, amount = 1) {
  return (req, res, sendJson) => {
    if (!req.tenantId) {
      sendJson(res, 403, { error: 'tenant_id não resolvido' });
      return false;
    }

    const check = checkLimit(req.tenantId, resource, amount);
    if (!check.allowed) {
      sendJson(res, 403, {
        error: 'limit_exceeded',
        message: check.error,
        limit: check.limit,
        current: check.current,
      });
      return false;
    }

    return true;
  };
}

/**
 * Incrementa contador de uso de um recurso.
 * TODO: Implementar persistência de métricas de uso
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} resource - Recurso
 * @param {number} amount - Quantidade a incrementar
 */
function incrementUsage(tenantId, resource, amount = 1) {
  // TODO: Implementar contador de uso persistente
  logger.debug('[PlanLimits] Uso incrementado', { tenantId, resource, amount });
}

/**
 * Obtém métricas de uso de um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {Object} Métricas de uso
 */
function getUsageMetrics(tenantId) {
  return getTenantUsage(tenantId);
}

module.exports = {
  getPlanLimits,
  checkLimit,
  requireLimit,
  incrementUsage,
  getUsageMetrics,
  PLAN_LIMITS,
};
