import { fetchJson } from './client';

export function getRbacRoles() {
  return fetchJson('/rbac/roles', { method: 'GET' });
}

export function getRbacPermissions() {
  return fetchJson('/rbac/permissions', { method: 'GET' });
}

export function createRbacRole({ role, permissions }) {
  if (!role) {
    return Promise.reject(new Error('createRbacRole: role é obrigatório'));
  }
  return fetchJson('/rbac/roles', {
    method: 'POST',
    body: JSON.stringify({ role, permissions: Array.isArray(permissions) ? permissions : [] }),
  });
}

export function assignRbacRole({ agentId, role }) {
  if (!agentId || !role) {
    return Promise.reject(new Error('assignRbacRole: agentId e role são obrigatórios'));
  }
  return fetchJson('/rbac/assign', {
    method: 'POST',
    body: JSON.stringify({ agentId, role }),
  });
}
