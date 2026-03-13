import { fetchJson } from './client';

export function exportTenantBackup() {
  return fetchJson('/api/backup/export', { method: 'GET' });
}

export function importTenantBackup(payload) {
  return fetchJson('/api/backup/import', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}
