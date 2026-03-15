import { fetchJson } from './client';

export function searchTenantIntelligence({ question, period = 'month', filters = {} } = {}) {
  return fetchJson('/api/intelligence/search', {
    method: 'POST',
    body: JSON.stringify({ question, period, filters: filters || {} }),
  });
}

export function getTenantOperationalState({
  period = 'month',
  mode = 'read',
  refreshMetrics = false,
  includeEvidence = false,
  filters = null,
} = {}) {
  const params = new URLSearchParams();
  if (period) params.set('period', String(period));
  if (mode) params.set('mode', String(mode));
  params.set('refreshMetrics', String(!!refreshMetrics));
  params.set('includeEvidence', String(!!includeEvidence));
  if (filters && typeof filters === 'object') {
    params.set('filters', JSON.stringify(filters));
  }
  const query = params.toString();
  return fetchJson(`/api/intelligence/operational-state${query ? `?${query}` : ''}`, { method: 'GET' });
}

export function refreshTenantOperationalState({ period = 'month', includeEvidence = false, filters = null } = {}) {
  return getTenantOperationalState({
    period,
    mode: 'refresh',
    refreshMetrics: true,
    includeEvidence,
    filters,
  });
}

export function listTenantGoals({ status = null, limit = 100 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', String(status));
  if (limit != null) params.set('limit', String(limit));
  const query = params.toString();
  return fetchJson(`/api/intelligence/goals${query ? `?${query}` : ''}`, { method: 'GET' });
}

export function createTenantGoal(payload = {}) {
  return fetchJson('/api/intelligence/goals', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function updateTenantGoal(goalId, updates = {}) {
  return fetchJson(`/api/intelligence/goals/${encodeURIComponent(String(goalId))}`, {
    method: 'PUT',
    body: JSON.stringify(updates || {}),
  });
}

export function collectTenantMetricSnapshots({ period = 'month', filters = {} } = {}) {
  return fetchJson('/api/intelligence/metrics/snapshots', {
    method: 'POST',
    body: JSON.stringify({ period, filters: filters || {} }),
  });
}

export function listTenantInsights({ status = 'open', limit = 100 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', String(status));
  if (limit != null) params.set('limit', String(limit));
  const query = params.toString();
  return fetchJson(`/api/intelligence/insights${query ? `?${query}` : ''}`, { method: 'GET' });
}

export function listTenantRecommendations({ status = 'open', limit = 100 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', String(status));
  if (limit != null) params.set('limit', String(limit));
  const query = params.toString();
  return fetchJson(`/api/intelligence/recommendations${query ? `?${query}` : ''}`, { method: 'GET' });
}

export function listInsightEvidence(insightId) {
  return fetchJson(`/api/intelligence/insights/${encodeURIComponent(String(insightId))}/evidence`, { method: 'GET' });
}
