import { fetchJson } from './client';

const SUPPORTED_VERTICALS = new Set(['fitness', 'beauty', 'bakery']);

function normalizeVertical(value) {
  const normalized = String(value || 'fitness').toLowerCase();
  return SUPPORTED_VERTICALS.has(normalized) ? normalized : 'fitness';
}

export async function getDemoState({ vertical = 'fitness' } = {}) {
  const normalized = normalizeVertical(vertical);
  return fetchJson(`/api/demo/state?vertical=${encodeURIComponent(normalized)}`, {
    method: 'GET',
  });
}

export async function runDemoFlow({ vertical = 'fitness' } = {}) {
  const normalized = normalizeVertical(vertical);
  return fetchJson('/api/demo/run', {
    method: 'POST',
    body: JSON.stringify({ vertical: normalized }),
  });
}
