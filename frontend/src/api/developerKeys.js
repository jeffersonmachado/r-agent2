import { fetchJson } from './client';

export function listDeveloperKeys({ includeToken = false, active = null } = {}) {
  const params = new URLSearchParams();
  if (includeToken) params.set('includeToken', 'true');
  if (active === true) params.set('active', 'true');
  if (active === false) params.set('active', 'false');
  const qs = params.toString();
  return fetchJson(`/developer/keys${qs ? `?${qs}` : ''}`, { method: 'GET' });
}

export function createDeveloperKey(payload) {
  return fetchJson('/developer/keys', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function getDeveloperUsage() {
  return fetchJson('/developer/usage', { method: 'GET' });
}
