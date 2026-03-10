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

export async function getOccTenantsHealth() {
  return fetchJson('/api/admin/tenants/health', {
    method: 'GET',
  });
}

export async function getOccTenantMetrics(tenantId) {
  return fetchJson(`/api/admin/tenant/${encodeURIComponent(tenantId)}/metrics`, {
    method: 'GET',
  });
}

export async function getOccTenantAlerts(tenantId, filters = {}) {
  const params = new URLSearchParams();
  if (filters.includeResolved) params.set('includeResolved', 'true');
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  return fetchJson(`/api/admin/tenant/${encodeURIComponent(tenantId)}/alerts${query ? `?${query}` : ''}`, {
    method: 'GET',
  });
}

export async function getOccTenantUraAudit(tenantId, filters = {}) {
  const params = new URLSearchParams();
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  return fetchJson(`/api/admin/tenant/${encodeURIComponent(tenantId)}/ura/audit${query ? `?${query}` : ''}`, {
    method: 'GET',
  });
}

export async function getOccTenantFeatureFlags(tenantId) {
  return fetchJson(`/api/admin/tenant/${encodeURIComponent(tenantId)}/feature-flags`, {
    method: 'GET',
  });
}

export async function getOccTenantCrmOperationalSummary(tenantId, { recentWindowHours = 72 } = {}) {
  return fetchJson(`/api/admin/tenant/${encodeURIComponent(tenantId)}/crm/operational-summary?recentWindowHours=${Math.max(1, Number(recentWindowHours) || 72)}`, {
    method: 'GET',
  });
}

export async function updateOccTenantFeatureFlag(tenantId, featureKey, payload) {
  return fetchJson(`/api/admin/tenant/${encodeURIComponent(tenantId)}/feature-flags/${encodeURIComponent(featureKey)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function getOccTenantOperationalSignals(tenantId, { activeOnly = true, limit = 200 } = {}) {
  const params = new URLSearchParams();
  if (activeOnly) params.set('activeOnly', 'true');
  params.set('limit', String(Math.max(1, Number(limit) || 200)));
  return fetchJson(`/api/admin/tenant/${encodeURIComponent(tenantId)}/operational-signals?${params.toString()}`, {
    method: 'GET',
  });
}

export async function generateOccTenantOperationalSignals(tenantId, { contactId = null } = {}) {
  return fetchJson(`/api/admin/tenant/${encodeURIComponent(tenantId)}/operational-signals/generate`, {
    method: 'POST',
    body: JSON.stringify(contactId ? { contactId: String(contactId) } : {}),
  });
}

export async function updateOccTenantOperationalSignalStatus(tenantId, signalId, status) {
  return fetchJson(`/api/admin/tenant/${encodeURIComponent(tenantId)}/operational-signals/${encodeURIComponent(signalId)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export async function getOccTenantOperationalRecommendations(tenantId, { limit = 200 } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(Math.max(1, Number(limit) || 200)));
  return fetchJson(`/api/admin/tenant/${encodeURIComponent(tenantId)}/operational-recommendations?${params.toString()}`, {
    method: 'GET',
  });
}

export async function getOccTenantOperationalOutcomes(tenantId, filters = {}) {
  const params = new URLSearchParams();
  if (filters.limit) params.set('limit', String(Math.max(1, Number(filters.limit) || 100)));
  if (filters.status) params.set('status', String(filters.status));
  if (filters.sourceType) params.set('sourceType', String(filters.sourceType));
  if (filters.outcomeType) params.set('outcomeType', String(filters.outcomeType));
  if (filters.signalId) params.set('signalId', String(filters.signalId));
  if (filters.recommendationId) params.set('recommendationId', String(filters.recommendationId));
  if (filters.playbookExecutionId) params.set('playbookExecutionId', String(filters.playbookExecutionId));
  if (filters.from) params.set('from', String(filters.from));
  if (filters.to) params.set('to', String(filters.to));
  return fetchJson(`/api/admin/tenant/${encodeURIComponent(tenantId)}/operational-outcomes?${params.toString()}`, {
    method: 'GET',
  });
}

export async function generateOccTenantOperationalRecommendations(tenantId, { contactId = null } = {}) {
  return fetchJson(`/api/admin/tenant/${encodeURIComponent(tenantId)}/operational-recommendations/generate`, {
    method: 'POST',
    body: JSON.stringify(contactId ? { contactId: String(contactId) } : {}),
  });
}

export async function updateOccTenantOperationalRecommendationStatus(tenantId, recommendationId, status) {
  return fetchJson(`/api/admin/tenant/${encodeURIComponent(tenantId)}/operational-recommendations/${encodeURIComponent(recommendationId)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export async function listOperationalPlaybooksAdmin({ tenantId = '', contactId = '', signalType = '', limit = 12 } = {}) {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', String(tenantId));
  if (contactId) params.set('contactId', String(contactId));
  if (signalType) params.set('signalType', String(signalType));
  params.set('limit', String(Math.max(1, Number(limit) || 12)));
  return fetchJson(`/api/admin/playbooks?${params.toString()}`, {
    method: 'GET',
  });
}

export async function getOperationalPlaybookAdmin(playbookId) {
  return fetchJson(`/api/admin/playbooks/${encodeURIComponent(playbookId)}`, {
    method: 'GET',
  });
}

export async function executeOperationalPlaybookAdmin(playbookId, payload) {
  return fetchJson(`/api/admin/playbooks/${encodeURIComponent(playbookId)}/execute`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export async function stepOperationalPlaybookAdmin(playbookId, payload) {
  return fetchJson(`/api/admin/playbooks/${encodeURIComponent(playbookId)}/step`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

/**
 * List quick actions available for a signal
 */
export async function listQuickActionsForSignal({ tenantId, signalId }) {
  return fetchJson(`/api/admin/tenant/${encodeURIComponent(tenantId)}/operational-signals/${encodeURIComponent(signalId)}/quick-actions`, {
    method: 'GET',
  });
}

/**
 * Execute a quick action for a signal
 */
export async function executeQuickActionForSignal({
  tenantId,
  signalId,
  actionId,
  input = {},
}) {
  return fetchJson(
    `/api/admin/tenant/${encodeURIComponent(tenantId)}/operational-signals/${encodeURIComponent(signalId)}/quick-actions/${encodeURIComponent(actionId)}`,
    {
      method: 'POST',
      body: JSON.stringify({ input }),
    }
  );
}

/**
 * List quick actions available for a recommendation
 */
export async function listQuickActionsForRecommendation({ tenantId, recommendationId }) {
  return fetchJson(
    `/api/admin/tenant/${encodeURIComponent(tenantId)}/operational-recommendations/${encodeURIComponent(recommendationId)}/quick-actions`,
    {
      method: 'GET',
    }
  );
}

/**
 * Execute a quick action for a recommendation
 */
export async function executeQuickActionForRecommendation({
  tenantId,
  recommendationId,
  actionId,
  input = {},
}) {
  return fetchJson(
    `/api/admin/tenant/${encodeURIComponent(tenantId)}/operational-recommendations/${encodeURIComponent(recommendationId)}/quick-actions/${encodeURIComponent(actionId)}`,
    {
      method: 'POST',
      body: JSON.stringify({ input }),
    }
  );
}
