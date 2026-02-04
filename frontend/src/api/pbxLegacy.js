import { fetchJson } from './client';

export function getPbxHealth() {
  return fetchJson('/api/pbx-legacy/health', { method: 'GET' });
}

export function getPbxInventory() {
  return fetchJson('/api/pbx-legacy/inventory', { method: 'GET' });
}

export function listRamais() {
  return fetchJson('/api/pbx-legacy/ramais', { method: 'GET' });
}

export function upsertRamal(payload) {
  return fetchJson('/api/pbx-legacy/ramais', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

