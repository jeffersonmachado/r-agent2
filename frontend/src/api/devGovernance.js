/**
 * API client da governança de engenharia (pendências, estado de release e ações).
 *
 * Toda a superfície é DEVELOPMENT-only no backend: autenticação (401),
 * classificação DEVELOPMENT (403), autorização POR AÇÃO via RBAC (403) e tenant
 * resolvido server-side (400). O frontend NÃO decide elegibilidade — apenas exibe
 * a recusa quando ela vem.
 *
 * Postura de honestidade: a tela mostra `sourceUnavailable` e `evidenceUnavailable`
 * vindos da API. Lista vazia por FALHA de leitura é diferente de lista vazia por
 * ausência de pendência, e o operador precisa poder distinguir as duas.
 */

import { fetchJson } from './client';

const BASE_PATH = '/api/dev-governance';

function withQuery(path, filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.append(key, String(value));
  });
  const query = params.toString();
  return `${path}${query ? `?${query}` : ''}`;
}

function postJson(path, body = {}) {
  return fetchJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Pendências de missão + governança. `onlyPending` restringe ao que exige ação humana. */
export async function getPendencies({ onlyPending = false } = {}) {
  return fetchJson(withQuery(`${BASE_PATH}/pendencies`, { onlyPending: onlyPending ? '1' : '' }));
}

/** Estado do release: artefatos, divergência em relação ao código atual e ações. */
export async function getReleaseState() {
  return fetchJson(`${BASE_PATH}/release`);
}

/** Histórico das ações de release executadas (allowlist governada). */
export async function listReleaseActions() {
  return fetchJson(`${BASE_PATH}/release/actions`);
}

/** Detalhe de uma ação de release (inclui o fim do log). */
export async function getReleaseAction(jobId) {
  return fetchJson(`${BASE_PATH}/release/actions/${encodeURIComponent(jobId)}`);
}

/**
 * Executa uma ação de release. As rotas são fixas (uma por ação) porque a AÇÃO
 * AUTORIZADA vem do caminho, não do corpo — é o que permite o RBAC por ação.
 * `confirm` é obrigatório para as ações que alteram o repositório.
 */
export async function runReleaseAction(actionId, { confirm = false } = {}) {
  const allowed = ['verify', 'seal', 'publish-tag'];
  if (!allowed.includes(actionId)) {
    throw new Error(`ação de release desconhecida: ${actionId}`);
  }
  return postJson(`${BASE_PATH}/release/${actionId}`, { confirm: confirm === true });
}
