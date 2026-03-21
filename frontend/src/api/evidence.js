import { fetchJson } from './client';

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.append(key, value.join(','));
      continue;
    }
    search.append(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function getEvidenceEntityHistory(params = {}) {
  return fetchJson(`/api/evidence/entity/history${buildQuery(params)}`, {
    method: 'GET',
  });
}

export function searchEvidence(payload = {}) {
  return fetchJson('/api/evidence/search', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
