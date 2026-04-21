import { fetchJson } from './client';

export async function getQaMeshRegistry() {
  return fetchJson('/qa-mesh/registry');
}

export async function refreshQaMeshRegistry() {
  return fetchJson('/qa-mesh/registry/refresh', { method: 'POST' });
}

export async function getQaMeshLatest() {
  return fetchJson('/qa-mesh/latest');
}

export async function getQaMeshHistory(options = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.domain) params.set('domain', String(options.domain));
  if (options.officialOnly) params.set('officialOnly', '1');
  const query = params.toString();
  return fetchJson(`/qa-mesh/history${query ? `?${query}` : ''}`);
}

export async function getQaMeshOfficialReference() {
  return fetchJson('/qa-mesh/official-reference');
}

export async function getQaMeshScheduler() {
  return fetchJson('/qa-mesh/scheduler');
}

export async function runQaMesh(options = {}) {
  return fetchJson('/qa-mesh/run', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export async function replayQaMeshScenario(scenarioId) {
  return fetchJson(`/qa-mesh/replay/${encodeURIComponent(scenarioId)}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function getQaMeshExecutionStatus(executionId) {
  return fetchJson(`/qa-mesh/execution/${encodeURIComponent(executionId)}/status`);
}
