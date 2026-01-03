import { fetchJson } from './client';

export async function listDepartments(filters = {}) {
  const params = new URLSearchParams();
  if (filters.activeOnly !== undefined) params.append('activeOnly', filters.activeOnly);
  if (filters.agentId) params.append('agentId', filters.agentId);
  
  const query = params.toString();
  return fetchJson(`/departments${query ? `?${query}` : ''}`);
}

export async function getDepartment(id) {
  return fetchJson(`/departments/${encodeURIComponent(id)}`);
}

export async function createDepartment(data) {
  return fetchJson('/departments', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateDepartment(id, data) {
  return fetchJson(`/departments/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteDepartment(id) {
  return fetchJson(`/departments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function addAgentToDepartment(departmentId, agentId) {
  return fetchJson(`/departments/${encodeURIComponent(departmentId)}/agents`, {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  });
}

export async function removeAgentFromDepartment(departmentId, agentId) {
  return fetchJson(`/departments/${encodeURIComponent(departmentId)}/agents/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
  });
}
