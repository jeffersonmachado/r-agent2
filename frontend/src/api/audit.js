import { fetchJson } from './client';

export async function queryAuditLogs(filters = {}) {
  const params = new URLSearchParams();
  if (filters.agentId) params.append('agentId', String(filters.agentId));
  if (filters.username) params.append('username', String(filters.username));
  if (filters.action) params.append('action', String(filters.action));
  if (filters.resource) params.append('resource', String(filters.resource));
  if (filters.resourceId) params.append('resourceId', String(filters.resourceId));
  if (filters.startDate) params.append('startDate', String(filters.startDate));
  if (filters.endDate) params.append('endDate', String(filters.endDate));
  if (filters.limit !== undefined) params.append('limit', String(filters.limit));
  if (filters.offset !== undefined) params.append('offset', String(filters.offset));

  const query = params.toString();
  return fetchJson(`/audit/logs${query ? `?${query}` : ''}`);
}

export async function getAuditStats() {
  return fetchJson('/audit/stats');
}

