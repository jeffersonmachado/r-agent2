import { fetchJson } from './client';

export async function getQaMeshRegistry() {
  return fetchJson('/qa-mesh/registry');
}

export async function refreshQaMeshRegistry() {
  return fetchJson('/qa-mesh/registry/refresh', { method: 'POST' });
}

export async function getQaMeshLatest() {
  // 404 = "Nenhuma execução disponível" (estado vazio legítimo, ex.: ambiente
  // recém-instalado) — a página trata como empty state; sem expectedStatuses
  // o client logaria console.error e reprovaria a assertiva pageLoads da
  // page-surface wave.
  return fetchJson('/qa-mesh/latest', { expectedStatuses: [404] });
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

export async function setQaMeshScheduler(enabled, frequencyKey) {
  return fetchJson('/qa-mesh/scheduler', {
    method: 'POST',
    body: JSON.stringify({ enabled, frequencyKey }),
  });
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
