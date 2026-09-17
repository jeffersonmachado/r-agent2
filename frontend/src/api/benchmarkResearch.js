/**
 * API client para a governança de pesquisa de benchmark.
 *
 * Todas as rotas são DEVELOPMENT-only no backend. A pesquisa nunca aplica
 * mudanças de amostra diretamente: toda proposta exige avaliação documentada
 * e aprovação humana (revisão → aprovação com ressalvas → aplicação).
 */

import { fetchJson } from './client';

const BASE_PATH = '/api/benchmark-research';

function proposalPath(id, suffix = '') {
  return `${BASE_PATH}/proposals/${encodeURIComponent(id)}${suffix}`;
}

/**
 * Lista propostas de mudança de amostra, com filtros opcionais.
 *
 * @param {Object} [filters]
 * @param {string} [filters.vertical]
 * @param {string} [filters.status]
 * @returns {Promise<{ proposals: Array }>}
 */
export async function listProposals(filters = {}) {
  const params = new URLSearchParams();
  if (filters.vertical) params.append('vertical', filters.vertical);
  if (filters.status) params.append('status', filters.status);

  const query = params.toString();
  return fetchJson(`${BASE_PATH}/proposals${query ? `?${query}` : ''}`);
}

/**
 * Obtém o detalhe completo de uma proposta (inclui a avaliação documentada).
 *
 * @param {string} id
 * @returns {Promise<{ proposal: Object }>}
 */
export async function getProposal(id) {
  return fetchJson(proposalPath(id));
}

/**
 * Cria uma nova proposta de mudança de amostra para uma vertical.
 *
 * @param {string} vertical
 * @param {string} [runId] - Run de pesquisa de origem, quando conhecido
 * @returns {Promise<{ proposal: Object }>}
 */
export async function createProposal(vertical, runId) {
  return fetchJson(`${BASE_PATH}/runs/${encodeURIComponent(vertical)}/proposals`, {
    method: 'POST',
    body: JSON.stringify(runId ? { runId } : {}),
  });
}

/**
 * Inicia a revisão humana de uma proposta e obtém o token de revisão.
 *
 * @param {string} id
 * @returns {Promise<{ reviewToken: string, expiresAt: string }>}
 */
export async function startReview(id) {
  return fetchJson(proposalPath(id, '/review'), {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * Aprova uma proposta com ressalvas documentadas.
 *
 * @param {string} id
 * @param {Object} payload
 * @param {string} payload.reviewToken - Token obtido em startReview
 * @param {string[]} payload.caveats - Ressalvas registradas na aprovação
 * @param {string} [payload.reason] - Justificativa opcional
 * @returns {Promise<{ proposal: Object }>}
 */
export async function approveProposal(id, { reviewToken, caveats, reason } = {}) {
  const body = { reviewToken, caveats: Array.isArray(caveats) ? caveats : [] };
  if (reason) body.reason = reason;

  return fetchJson(proposalPath(id, '/approve'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Rejeita uma proposta com motivo obrigatório.
 *
 * @param {string} id
 * @param {string} reason
 * @returns {Promise<{ proposal: Object }>}
 */
export async function rejectProposal(id, reason) {
  return fetchJson(proposalPath(id, '/reject'), {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * Aplica uma proposta previamente aprovada.
 *
 * @param {string} id
 * @returns {Promise<{ proposal: Object, applyResult: Object }>}
 */
export async function applyProposal(id) {
  return fetchJson(proposalPath(id, '/apply'), {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
