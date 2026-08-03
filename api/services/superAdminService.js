/**
 * Serviço de Super Admin.
 * 
 * Funcionalidades administrativas globais:
 * - Listar todos os tenants
 * - Visualizar métricas por tenant
 * - Impersonar usuário
 * - Bloquear/desbloquear tenant
 * - Ajustar plano manualmente
 * 
 * IMPORTANTE: Apenas usuários com role 'super_admin' ou 'owner' do tenant 'system' podem usar este serviço.
 */

const { listTenants, getTenant, suspendTenant, reactivateTenant, changePlan, getTenantUsage, getTenantsUsageBatch } = require('./tenantService');
const { listAgents, getAgent, updateAgent } = require('./authService');
const { queryLogs } = require('./auditService');
const logger = require('../utils/logger');

/**
 * Verifica se um agente é Super Admin.
 * 
 * @param {Object} agent - Agente
 * @returns {boolean}
 */
function isSuperAdmin(agent) {
  if (!agent) return false;
  
  // Super Admin pode ser:
  // 1. Role 'super_admin'
  // 2. Owner do tenant 'system'
  if (agent.role === 'super_admin') {
    return true;
  }
  
  if (agent.role === 'owner' && agent.tenantId === 'system') {
    return true;
  }
  
  return false;
}

/**
 * Lista todos os tenants com métricas.
 * 
 * @param {Object} filters - Filtros (status, plan, search)
 * @returns {Promise<Array>} Lista de tenants com métricas
 */
async function listAllTenants(filters = {}) {
  const tenants = await listTenants();
  
  let filtered = tenants;
  
  // Filtra por status
  if (filters.status) {
    filtered = filtered.filter(t => t.status === filters.status);
  }
  
  // Filtra por plano
  if (filters.plan) {
    filtered = filtered.filter(t => t.plan === filters.plan);
  }
  
  // Filtra por busca (nome ou site)
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filtered = filtered.filter(t => 
      t.name.toLowerCase().includes(searchLower) ||
      t.site.toLowerCase().includes(searchLower)
    );
  }
  
  // Adiciona métricas básicas — agregadas em lote (1 query por métrica para
  // todos os tenants) em vez de getTenantUsage por tenant (N+1).
  const usageByTenant = await getTenantsUsageBatch(filtered.map((t) => t.id)).catch(() => new Map());
  return filtered.map((tenant) => ({
    ...tenant,
    metrics: usageByTenant.get(tenant.id) || {
      usuarios: 0,
      agentes_ia: 0,
      execucoes_rpa: 0,
      tokens_ia: 0,
      documentos_rag: 0,
      storage_mb: 0,
    },
  }));
}

/**
 * Obtém métricas detalhadas de um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {Object} Métricas detalhadas
 */
function getTenantMetrics(tenantId) {
  const tenant = getTenant(tenantId);
  if (!tenant) {
    return null;
  }
  
  const usage = getTenantUsage(tenantId);
  const agents = listAgents(tenantId);
  
  // Obtém logs recentes
  const recentLogs = queryLogs({ 
    tenantId,
    limit: 100,
  });
  
  // Calcula estatísticas dos logs
  const logStats = {
    total: recentLogs.length,
    byAction: {},
    byResource: {},
    lastActivity: recentLogs[0]?.timestamp || null,
  };
  
  recentLogs.forEach(log => {
    logStats.byAction[log.action] = (logStats.byAction[log.action] || 0) + 1;
    logStats.byResource[log.resource] = (logStats.byResource[log.resource] || 0) + 1;
  });
  
  return {
    tenant,
    usage: usage || {
      usuarios: 0,
      agentes_ia: 0,
      execucoes_rpa: 0,
      tokens_ia: 0,
      documentos_rag: 0,
      storage_mb: 0,
    },
    agents: {
      total: agents.length,
      byRole: agents.reduce((acc, agent) => {
        acc[agent.role] = (acc[agent.role] || 0) + 1;
        return acc;
      }, {}),
    },
    logs: logStats,
  };
}

/**
 * Impersona um usuário (cria token temporário como se fosse o usuário).
 * 
 * @param {string} agentId - ID do agente a impersonar
 * @param {string} superAdminId - ID do super admin que está impersonando
 * @returns {{success: boolean, token?: string, agent?: Object, error?: string}}
 */
function impersonateUser(agentId, superAdminId) {
  const agent = getAgent(agentId);
  if (!agent) {
    return { success: false, error: 'Agente não encontrado' };
  }
  
  // Verifica se super admin existe
  const superAdmin = getAgent(superAdminId);
  if (!superAdmin || !isSuperAdmin(superAdmin)) {
    return { success: false, error: 'Acesso negado: apenas Super Admin pode impersonar' };
  }
  
  // Cria sessão temporária para o agente impersonado
  const { login } = require('./authService');
  const { generateToken } = require('./authService')._internal;
  
  // Gera token especial para impersonação
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hora
  
  // Adiciona flag de impersonação
  const sessions = require('./authService')._internal.loadSessionsFromFile || (() => new Map());
  const session = {
    token,
    agentId: agent.id,
    username: agent.username,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastActivityAt: now.toISOString(),
    ipAddress: 'super-admin',
    userAgent: `SuperAdmin/${superAdmin.username}`,
    impersonatedBy: superAdminId,
    isImpersonation: true,
  };
  
  // Salva sessão (precisa acessar internamente)
  logger.info('[SuperAdmin] Impersonação iniciada', {
    superAdminId,
    impersonatedAgentId: agentId,
    tenantId: agent.tenantId,
  });
  
  // Por enquanto, retorna token e agente
  // Em produção, isso deve criar uma sessão real
  const { passwordHash, salt, ...agentSafe } = agent;
  
  return {
    success: true,
    token,
    agent: agentSafe,
    impersonated: true,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Bloqueia um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} reason - Motivo do bloqueio
 * @param {string} superAdminId - ID do super admin
 * @returns {{success: boolean, tenant?: Object, error?: string}}
 */
function blockTenant(tenantId, reason, superAdminId) {
  const tenant = getTenant(tenantId);
  if (!tenant) {
    return { success: false, error: 'Tenant não encontrado' };
  }
  
  const result = suspendTenant(tenantId);
  if (!result.success) {
    return result;
  }
  
  // Registra ação de auditoria
  const { logAction } = require('./auditService');
  logAction({
    agentId: superAdminId,
    username: 'super-admin',
    tenantId: 'system',
    action: 'tenant_block',
    resource: 'tenant',
    resourceId: tenantId,
    details: { reason },
    ipAddress: 'system',
    userAgent: 'super-admin',
  });
  
  logger.warn('[SuperAdmin] Tenant bloqueado', {
    tenantId,
    reason,
    superAdminId,
  });
  
  return result;
}

/**
 * Desbloqueia um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} superAdminId - ID do super admin
 * @returns {{success: boolean, tenant?: Object, error?: string}}
 */
function unblockTenant(tenantId, superAdminId) {
  const tenant = getTenant(tenantId);
  if (!tenant) {
    return { success: false, error: 'Tenant não encontrado' };
  }
  
  const result = reactivateTenant(tenantId);
  if (!result.success) {
    return result;
  }
  
  // Registra ação de auditoria
  const { logAction } = require('./auditService');
  logAction({
    agentId: superAdminId,
    username: 'super-admin',
    tenantId: 'system',
    action: 'tenant_unblock',
    resource: 'tenant',
    resourceId: tenantId,
    ipAddress: 'system',
    userAgent: 'super-admin',
  });
  
  logger.info('[SuperAdmin] Tenant desbloqueado', {
    tenantId,
    superAdminId,
  });
  
  return result;
}

/**
 * Ajusta plano de um tenant manualmente.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} newPlan - Novo plano
 * @param {Object} customLimits - Limites customizados (opcional)
 * @param {string} superAdminId - ID do super admin
 * @returns {{success: boolean, tenant?: Object, error?: string}}
 */
function adjustTenantPlan(tenantId, newPlan, customLimits = null, superAdminId) {
  const tenant = getTenant(tenantId);
  if (!tenant) {
    return { success: false, error: 'Tenant não encontrado' };
  }
  
  const updates = { plan: newPlan };
  if (customLimits) {
    updates.limits = customLimits;
  }
  
  const { updateTenant } = require('./tenantService');
  const result = updateTenant(tenantId, updates);
  
  if (!result.success) {
    return result;
  }
  
  // Registra ação de auditoria
  const { logAction } = require('./auditService');
  logAction({
    agentId: superAdminId,
    username: 'super-admin',
    tenantId: 'system',
    action: 'tenant_plan_adjust',
    resource: 'tenant',
    resourceId: tenantId,
    details: { newPlan, customLimits },
    ipAddress: 'system',
    userAgent: 'super-admin',
  });
  
  logger.info('[SuperAdmin] Plano ajustado', {
    tenantId,
    oldPlan: tenant.plan,
    newPlan,
    superAdminId,
  });
  
  return result;
}

module.exports = {
  isSuperAdmin,
  listAllTenants,
  getTenantMetrics,
  impersonateUser,
  blockTenant,
  unblockTenant,
  adjustTenantPlan,
};
