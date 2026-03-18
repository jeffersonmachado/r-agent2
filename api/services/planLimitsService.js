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
const { getSetting, upsertSetting } = require('./tenantSettingsService');
const logger = require('../utils/logger');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeErrorMessage(err, fallback = '') {
  if (err == null) return fallback;
  try { return String(err.message); } catch (_) { return safeToString(err, fallback); }
}

/**
 * Limites padrão por plano.
 */
const PLAN_LIMITS = {
  // "basic" (SaaS) - mais próximo de um trial, mas pago
  basic: {
    usuarios: 3,
    max_agentes: 3,
    max_canais: 3,
    max_conversas_mes: 2000,
    agentes_ia: 2,
    execucoes_rpa: 50,
    tokens_ia: 50000,
    documentos_rag: 50,
    storage_mb: 500,
  },
  free: {
    usuarios: 1,
    max_agentes: 1,
    max_canais: 1,
    max_conversas_mes: 500,
    agentes_ia: 1,
    execucoes_rpa: 10,
    tokens_ia: 10000,
    documentos_rag: 10,
    storage_mb: 100,
  },
  trial: {
    usuarios: 3,
    max_agentes: 3,
    max_canais: 3,
    max_conversas_mes: 2000,
    agentes_ia: 2,
    execucoes_rpa: 50,
    tokens_ia: 50000,
    documentos_rag: 50,
    storage_mb: 500,
  },
  pro: {
    usuarios: 10,
    max_agentes: 10,
    max_canais: 10,
    max_conversas_mes: 20000,
    agentes_ia: 5,
    execucoes_rpa: 500,
    tokens_ia: 500000,
    documentos_rag: 500,
    storage_mb: 5000,
  },
  enterprise: {
    usuarios: -1, // Ilimitado
    max_agentes: -1,
    max_canais: -1,
    max_conversas_mes: -1,
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

function normalizeResource(resource) {
  if (resource === 'max_mensagens_mes') return 'max_conversas_mes';
  return resource;
}

function getMonthStartIso(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0));
  return d.toISOString();
}

/**
 * Verifica se um tenant pode realizar uma ação baseado nos limites do plano.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} resource - Recurso (usuarios, agentes_ia, execucoes_rpa, tokens_ia, documentos_rag, storage_mb)
 * @param {number} amount - Quantidade a verificar (padrão: 1)
 * @returns {{allowed: boolean, error?: string, limit?: number, current?: number}}
 */
async function checkLimit(tenantId, resource, amount = 1) {
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    return { allowed: false, error: 'Tenant não encontrado' };
  }

  // Compatibilidade: alguns lugares chamam "max_mensagens_mes" (mensagens/mês),
  // mas internamente usamos "max_conversas_mes" como quota mensal principal.
  const normalizedResource = normalizeResource(resource);

  const limits = tenant.limits || getPlanLimits(tenant.plan);
  const limit = limits[normalizedResource];

  // Se limite é -1, é ilimitado
  if (limit === -1) {
    return { allowed: true, limit: -1, current: 0 };
  }

  const usage = await getTenantUsage(tenantId);
  const current = usage ? (usage[normalizedResource] || 0) : 0;

  if (current + amount > limit) {
    return {
      allowed: false,
      error: `Limite de ${normalizedResource} excedido. Limite: ${limit}, Atual: ${current}, Tentativa: ${amount}`,
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
  return async (req, res, sendJson) => {
    if (!req.tenantId) {
      sendJson(res, 403, { error: 'tenant_id não resolvido' });
      return false;
    }

    const check = await checkLimit(req.tenantId, resource, amount);
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
  const normalizedResource = normalizeResource(resource);
  const safeAmount = Number.isFinite(amount) ? amount : 1;

  if (!tenantId || !normalizedResource) {
    logger.debug('[PlanLimits] Uso incrementado (ignorado: tenantId/resource inválidos)', {
      tenantId,
      resource,
      amount: safeAmount,
    });
    return;
  }

  const monthStart = getMonthStartIso();

  setImmediate(async () => {
    try {
      const current = await getSetting({ tenantId, key: 'usage_metrics' });
      const existing = current && current.ok ? (current.value || {}) : {};
      const existingMonth = existing.monthStart || null;
      const counters = existingMonth === monthStart && existing.counters && typeof existing.counters === 'object'
        ? { ...existing.counters }
        : {};

      const currentValue = Number.isFinite(counters[normalizedResource])
        ? Number(counters[normalizedResource])
        : 0;
      counters[normalizedResource] = currentValue + safeAmount;

      await upsertSetting({
        tenantId,
        key: 'usage_metrics',
        value: {
          monthStart,
          counters,
          updatedAt: new Date().toISOString(),
        },
      });

      logger.debug('[PlanLimits] Uso incrementado (persistido)', {
        tenantId,
        resource: normalizedResource,
        amount: safeAmount,
        total: counters[normalizedResource],
        monthStart,
      });
    } catch (err) {
      logger.debug('[PlanLimits] Falha ao persistir uso (ignorado)', {
        tenantId,
        resource: normalizedResource,
        error: safeErrorMessage(err),
      });
    }
  });
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
