import { fetchJson } from './client';

export function listAutomations() {
  return fetchJson('/automations', { method: 'GET' });
}

export function upsertAutomation(payload) {
  return fetchJson('/automations', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function publishAutomation(id) {
  return fetchJson(`/automations/${encodeURIComponent(id)}/publish`, { method: 'POST' });
}

export function runAutomation(id) {
  return fetchJson(`/automations/${encodeURIComponent(id)}/run`, { method: 'POST' });
}
