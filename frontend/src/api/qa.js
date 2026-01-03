/**
 * API client para QA.
 */

import { fetchJson } from './client';

/**
 * Obtém o último resultado de QA.
 */
export async function getLatestQaResult() {
  return fetchJson('/qa/latest');
}

/**
 * Obtém histórico de resultados de QA.
 */
export async function getQaHistory(options = {}) {
  const { limit = 50, source } = options;
  const params = new URLSearchParams();
  if (limit) params.append('limit', limit.toString());
  if (source) params.append('source', source);
  
  const query = params.toString();
  return fetchJson(`/qa/history${query ? `?${query}` : ''}`);
}

/**
 * Obtém resultado de QA por ID (commit ou timestamp).
 */
export async function getQaResultById(id) {
  return fetchJson(`/qa/${id}`);
}

/**
 * Obtém estatísticas de QA.
 */
export async function getQaStats() {
  return fetchJson('/qa/stats');
}

/**
 * Executa QA manualmente.
 */
export async function runQaManual(options = {}) {
  return fetchJson('/qa/run', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

