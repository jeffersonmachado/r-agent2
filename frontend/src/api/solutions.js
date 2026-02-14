import { fetchJson } from './client';

export function listSolutionPacks() {
  return fetchJson('/api/solutions/packs', { method: 'GET' });
}

export function installSolutionPack(segment) {
  return fetchJson('/api/solutions/packs/install', {
    method: 'POST',
    body: JSON.stringify({ segment }),
  });
}
