import { fetchJson } from './client';

export function listSlaPolicies() {
  return fetchJson('/sla/policies', { method: 'GET' });
}

export function upsertSlaPolicy(payload) {
  return fetchJson('/sla/policies', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listSlaBreaches() {
  return fetchJson('/sla/breaches', { method: 'GET' });
}
