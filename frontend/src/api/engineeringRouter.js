import { fetchJson } from './client';

export function getEngineeringOverview() {
  return fetchJson('/engineering/overview');
}

export function listEngineeringTasks(params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ).toString();
  return fetchJson(`/engineering/tasks${query ? `?${query}` : ''}`);
}

export function createEngineeringTask(payload) {
  return fetchJson('/engineering/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getEngineeringTask(taskId) {
  return fetchJson(`/engineering/tasks/${encodeURIComponent(taskId)}`);
}

export function runEngineeringTask(taskId) {
  return fetchJson(`/engineering/tasks/${encodeURIComponent(taskId)}/run`, { method: 'POST' });
}

export function cancelEngineeringTask(taskId) {
  return fetchJson(`/engineering/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
}

export function listEngineeringAttempts(taskId) {
  return fetchJson(`/engineering/tasks/${encodeURIComponent(taskId)}/attempts`);
}

export function listEngineeringTests(taskId) {
  return fetchJson(`/engineering/tasks/${encodeURIComponent(taskId)}/tests`);
}

export function listEngineeringReviews(taskId) {
  return fetchJson(`/engineering/tasks/${encodeURIComponent(taskId)}/reviews`);
}

export function listEngineeringTelemetry(taskId) {
  return fetchJson(`/engineering/tasks/${encodeURIComponent(taskId)}/telemetry`);
}

export function listEngineeringModels() {
  return fetchJson('/engineering/models');
}

export function getEngineeringRoutingDecision(taskId) {
  return fetchJson(`/engineering/router/decision/${encodeURIComponent(taskId)}`);
}

export function getEngineeringReleaseClosure() {
  return fetchJson('/engineering/release-closure');
}
