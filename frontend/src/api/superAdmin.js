import { fetchJson } from './client';
import { getToken } from './auth';

/**
 * Lista todos os tenants (Super Admin)
 * Para super-admin, não envia X-Tenant-Id no header
 */
export async function listAllTenants(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.append('status', filters.status);
  if (filters.plan) params.append('plan', filters.plan);
  if (filters.search) params.append('search', filters.search);
  
  const query = params.toString();
  const token = getToken();
  
  // Para super-admin, não envia X-Tenant-Id
  return fetchJson(`/super-admin/tenants${query ? `?${query}` : ''}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      // Não envia X-Tenant-Id para super-admin
    },
  });
}

/**
 * Obtém métricas detalhadas de um tenant (Super Admin)
 */
export async function getTenantMetrics(tenantId) {
  return fetchJson(`/super-admin/tenants/${encodeURIComponent(tenantId)}/metrics`, {
    method: 'GET',
  });
}

/**
 * Impersona um usuário (Super Admin)
 */
export async function impersonateUser(agentId) {
  return fetchJson('/super-admin/impersonate', {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  });
}

/**
 * Lista agentes de um tenant específico (Super Admin).
 * Usa X-Tenant-Id para escopo do tenant.
 */
export async function listTenantAgents(tenantId) {
  return fetchJson('/auth/agents', {
    method: 'GET',
    headers: {
      'X-Tenant-Id': tenantId,
    },
  });
}

/**
 * Bloqueia um tenant (Super Admin)
 */
export async function blockTenant(tenantId, reason) {
  return fetchJson(`/super-admin/tenants/${encodeURIComponent(tenantId)}/block`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * Desbloqueia um tenant (Super Admin)
 */
export async function unblockTenant(tenantId) {
  return fetchJson(`/super-admin/tenants/${encodeURIComponent(tenantId)}/unblock`, {
    method: 'POST',
  });
}

/**
 * Ajusta plano de um tenant (Super Admin)
 */
export async function adjustTenantPlan(tenantId, plan, customLimits = null) {
  return fetchJson(`/super-admin/tenants/${encodeURIComponent(tenantId)}/adjust-plan`, {
    method: 'POST',
    body: JSON.stringify({ plan, customLimits }),
  });
}
