import { fetchJson } from './client';

export async function getGeneralMetrics(options = {}) {
  const params = new URLSearchParams();
  if (options.startDate) params.append('startDate', options.startDate);
  if (options.endDate) params.append('endDate', options.endDate);
  
  const query = params.toString();
  return fetchJson(`/analytics/general${query ? `?${query}` : ''}`);
}

export async function getAgentMetrics(options = {}) {
  const params = new URLSearchParams();
  if (options.startDate) params.append('startDate', options.startDate);
  if (options.endDate) params.append('endDate', options.endDate);
  
  const query = params.toString();
  return fetchJson(`/analytics/agents${query ? `?${query}` : ''}`);
}

export async function getDepartmentMetrics(options = {}) {
  const params = new URLSearchParams();
  if (options.startDate) params.append('startDate', options.startDate);
  if (options.endDate) params.append('endDate', options.endDate);
  
  const query = params.toString();
  return fetchJson(`/analytics/departments${query ? `?${query}` : ''}`);
}

export async function getQueueMetrics(options = {}) {
  const params = new URLSearchParams();
  if (options.startDate) params.append('startDate', options.startDate);
  if (options.endDate) params.append('endDate', options.endDate);
  
  const query = params.toString();
  return fetchJson(`/analytics/queues${query ? `?${query}` : ''}`);
}

export async function getTrendMetrics(options = {}) {
  const params = new URLSearchParams();
  if (options.startDate) params.append('startDate', options.startDate);
  if (options.endDate) params.append('endDate', options.endDate);
  if (options.groupBy) params.append('groupBy', options.groupBy);
  
  const query = params.toString();
  return fetchJson(`/analytics/trends${query ? `?${query}` : ''}`);
}

export async function getAllMetrics(options = {}) {
  const params = new URLSearchParams();
  if (options.startDate) params.append('startDate', options.startDate);
  if (options.endDate) params.append('endDate', options.endDate);
  
  const query = params.toString();
  return fetchJson(`/analytics/metrics${query ? `?${query}` : ''}`);
}

export async function getRoiMetrics(options = {}) {
  const params = new URLSearchParams();
  if (options.windowDays) params.append('windowDays', options.windowDays);
  const query = params.toString();
  return fetchJson(`/analytics/roi${query ? `?${query}` : ''}`);
}

export async function getFunnelMetrics(options = {}) {
  const params = new URLSearchParams();
  if (options.windowDays) params.append('windowDays', options.windowDays);
  const query = params.toString();
  return fetchJson(`/analytics/funnel${query ? `?${query}` : ''}`);
}

export async function getOrderMetrics(options = {}) {
  const params = new URLSearchParams();
  if (options.locationId) params.append('locationId', options.locationId);
  const query = params.toString();
  return fetchJson(`/api/orders/metrics${query ? `?${query}` : ''}`);
}

export async function getPhysicalMetrics(options = {}) {
  const params = new URLSearchParams();
  if (options.locationId) params.append('locationId', options.locationId);
  const query = params.toString();
  return fetchJson(`/api/physical/metrics${query ? `?${query}` : ''}`);
}

export async function getPublicTokenStats() {
  return fetchJson('/public-tokens/stats');
}

export async function getVoiceMetrics(options = {}) {
  const params = new URLSearchParams();
  if (options.windowDays) params.append('windowDays', options.windowDays);
  const query = params.toString();
  return fetchJson(`/api/voice/metrics${query ? `?${query}` : ''}`);
}
