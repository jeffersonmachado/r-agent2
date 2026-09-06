import { fetchJson } from './client';

/**
 * Capacidades operacionais do tenant (inbox, case management etc.).
 * Fonte de verdade: servidor (`GET /api/tenant/capabilities`).
 */

export const DEFAULT_TENANT_CAPABILITIES = {
  inbox: true,
  caseManagement: true,
  caseCreationPolicy: 'manual',
  autonomyLevel: 'suggest',
};

export function getTenantCapabilities() {
  return fetchJson('/api/tenant/capabilities', { method: 'GET' });
}

export function updateTenantCapabilities(partialCapabilities = {}) {
  return fetchJson('/api/tenant/capabilities', {
    method: 'PUT',
    body: JSON.stringify(partialCapabilities),
  });
}
