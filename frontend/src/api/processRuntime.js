import { fetchJson } from './client';

export function listProcessInstances(params = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', String(params.status));
  if (params.processId) query.set('processId', String(params.processId));
  if (params.limit != null) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson(`/api/process-instances${suffix}`, { method: 'GET' });
}

export function getProcessInstance(executionId) {
  return fetchJson(`/api/process-instances/${encodeURIComponent(executionId)}`, { method: 'GET' });
}

export function getProcessInstanceHistory(executionId, params = {}) {
  const query = new URLSearchParams();
  if (params.eventType) query.set('eventType', String(params.eventType));
  if (params.nodeId) query.set('nodeId', String(params.nodeId));
  if (params.limit != null) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson(`/api/process-instances/${encodeURIComponent(executionId)}/history${suffix}`, { method: 'GET' });
}

export function cancelProcessInstance(executionId, reason) {
  return fetchJson(`/api/process-instances/${encodeURIComponent(executionId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function resumeProcessInstance(executionId, payload = {}) {
  return fetchJson(`/api/process-instances/${encodeURIComponent(executionId)}/resume`, {
    method: 'POST',
    body: JSON.stringify({ payload }),
  });
}

export function getProcessRuntimeAnalytics(params = {}) {
  const query = new URLSearchParams();
  if (params.processId) query.set('processId', String(params.processId));
  if (params.limit != null) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson(`/api/process-runtime/analytics${suffix}`, { method: 'GET' });
}

export function simulateProcessDefinition(payload = {}) {
  return fetchJson('/api/process-runtime/simulate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getProcessIntelligence(payload = {}) {
  return fetchJson('/api/process-runtime/intelligence', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
