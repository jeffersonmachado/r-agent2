import { fetchJson } from './client';

/**
 * Lista todos os tenants (apenas admin)
 */
export async function listTenants() {
  return fetchJson('/tenants', {
    method: 'GET',
  });
}

/**
 * Obtém um tenant específico
 */
export async function getTenant(tenantId) {
  return fetchJson(`/tenants/${encodeURIComponent(tenantId)}`, {
    method: 'GET',
  });
}

/**
 * Cria um novo tenant (apenas admin)
 */
export async function createTenant(tenantData) {
  return fetchJson('/tenants', {
    method: 'POST',
    body: JSON.stringify(tenantData),
  });
}

/**
 * Atualiza um tenant (apenas admin)
 */
export async function updateTenant(tenantId, updates) {
  return fetchJson(`/tenants/${encodeURIComponent(tenantId)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

/**
 * Remove um tenant (apenas admin)
 */
export async function deleteTenant(tenantId) {
  return fetchJson(`/tenants/${encodeURIComponent(tenantId)}`, {
    method: 'DELETE',
  });
}

/**
 * Obtém o contexto cognitivo de um tenant
 */
export async function getTenantContext(tenantId) {
  return fetchJson(`/tenants/${encodeURIComponent(tenantId)}/context`, {
    method: 'GET',
  });
}

/**
 * Atualiza o contexto cognitivo de um tenant (apenas admin)
 */
export async function updateTenantContext(tenantId, contextData) {
  return fetchJson(`/tenants/${encodeURIComponent(tenantId)}/context`, {
    method: 'PUT',
    body: JSON.stringify(contextData),
  });
}

/**
 * Suspende um tenant
 */
export async function suspendTenant(tenantId) {
  return fetchJson(`/tenants/${encodeURIComponent(tenantId)}/suspend`, {
    method: 'POST',
  });
}

/**
 * Reativa um tenant
 */
export async function reactivateTenant(tenantId) {
  return fetchJson(`/tenants/${encodeURIComponent(tenantId)}/reactivate`, {
    method: 'POST',
  });
}

/**
 * Muda plano de um tenant
 */
export async function changeTenantPlan(tenantId, plan) {
  return fetchJson(`/tenants/${encodeURIComponent(tenantId)}/change-plan`, {
    method: 'POST',
    body: JSON.stringify({ plan }),
  });
}

/**
 * Obtém métricas de uso de um tenant
 */
export async function getTenantUsage(tenantId) {
  return fetchJson(`/tenants/${encodeURIComponent(tenantId)}/usage`, {
    method: 'GET',
  });
}

/**
 * Obtém plano + limites efetivos + uso do tenant atual
 */
export async function getCurrentTenantPlanUsage() {
  return fetchJson('/tenants/current/plan-usage', {
    method: 'GET',
  });
}

/**
 * Gera dados de tenant por IA baseado em uma descrição
 */
export async function generateTenantByAI(description, options = {}) {
  const create = options?.create === true;
  const executionId = (options?.executionId && String(options.executionId).trim())
    ? String(options.executionId).trim()
    : null;
  if (!executionId) {
    throw new Error('executionId é obrigatório para /tenants/generate-by-ai');
  }
  return fetchJson('/tenants/generate-by-ai', {
    method: 'POST',
    body: JSON.stringify({ description, create, executionId }),
  });
}

