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

