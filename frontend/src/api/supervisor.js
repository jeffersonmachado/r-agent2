import { fetchJson } from './client';

export function getSupervisorMetrics(options = {}) {
  const params = new URLSearchParams();
  if (options.groupBy) params.append('groupBy', options.groupBy);
  if (options.period) params.append('period', options.period);
  if (options.from) params.append('from', options.from);
  if (options.to) params.append('to', options.to);
  const query = params.toString();
  return fetchJson(`/supervisor/metrics${query ? `?${query}` : ''}`, {
    method: 'GET',
  });
}

export function getSupervisorAgentsStatus() {
  return fetchJson('/supervisor/agents/status', { method: 'GET' });
}

export function getSupervisorQueuesStatus() {
  return fetchJson('/supervisor/queues/status', { method: 'GET' });
}
