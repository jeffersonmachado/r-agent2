import { fetchJson } from './client';

export function listNodeCatalog() {
  return fetchJson('/api/node-marketplace/catalog', { method: 'GET' });
}
