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
