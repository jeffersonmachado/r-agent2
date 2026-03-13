import { fetchJson } from './client';

export function getTenantSetting(key) {
  return fetchJson(`/api/tenant-settings/${encodeURIComponent(String(key))}`, { method: 'GET' });
}

export function upsertTenantSetting(key, value) {
  return fetchJson(`/api/tenant-settings/${encodeURIComponent(String(key))}`, {
    method: 'POST',
    body: JSON.stringify({ value }),
  });
}
