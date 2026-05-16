import { fetchJson } from './client';

export async function getDemoState({ vertical = 'fitness' } = {}) {
  const normalized = String(vertical || 'fitness').toLowerCase() === 'beauty' ? 'beauty' : 'fitness';
  return fetchJson(`/api/demo/state?vertical=${encodeURIComponent(normalized)}`, {
    method: 'GET',
  });
}

export async function runDemoFlow({ vertical = 'fitness' } = {}) {
  const normalized = String(vertical || 'fitness').toLowerCase() === 'beauty' ? 'beauty' : 'fitness';
  return fetchJson('/api/demo/run', {
    method: 'POST',
    body: JSON.stringify({ vertical: normalized }),
  });
}
