/**
 * API client para a inteligência de versões e segurança (RAP Security Intel).
 *
 * Toda a superfície é DEVELOPMENT-only no backend: autenticação (401),
 * classificação DEVELOPMENT (403) e tenant resolvido server-side (400). O
 * frontend NÃO decide elegibilidade — apenas exibe a recusa quando ela vem.
 *
 * Postura de honestidade: nenhuma função aqui interpreta "zero achados" como
 * "sem vulnerabilidades". A idade da base de advisories (`advisoryBase`) e o
 * veredito do índice vetorial são parte do dado, não do texto da tela.
 */

import { fetchJson } from './client';

const BASE_PATH = '/api/security-intel';

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

/** Resumo agregado: inventário, achados, base de advisories, SBOM, worker. */
export async function getSecurityIntelSummary() {
  return fetchJson(`${BASE_PATH}/summary`);
}

/** Inventário de componentes com filtros e paginação. */
export async function getSecurityInventory(filters = {}) {
  return fetchJson(withQuery(`${BASE_PATH}/inventory`, filters));
}

/** Histórico de versões observadas de um componente (bomRef). */
export async function getSecurityComponentVersions(bomRef) {
  return fetchJson(withQuery(`${BASE_PATH}/versions`, { bomRef }));
}

/** Achados (CVEs internos) com filtros. */
export async function listSecurityFindings(filters = {}) {
  return fetchJson(withQuery(`${BASE_PATH}/findings`, filters));
}

/** Linha do tempo append-only de um achado. */
export async function getSecurityFindingTimeline(findingKey) {
  return fetchJson(withQuery(`${BASE_PATH}/findings/timeline`, { findingKey }));
}

/** Candidatos de correção (plano de patch). */
export async function listSecurityPatches(filters = {}) {
  return fetchJson(withQuery(`${BASE_PATH}/patches`, filters));
}

/** Estado do índice vetorial (pgvector). */
export async function getSecurityVectorIndex() {
  return fetchJson(`${BASE_PATH}/vector-index`);
}

/** Sincronizações da base de advisories. */
export async function listSecurityAdvisories() {
  return fetchJson(`${BASE_PATH}/advisories`);
}

/** Correlação offline (idempotente) do inventário persistido. Não baixa dados. */
export async function runSecurityScan(body = {}) {
  return postJson(`${BASE_PATH}/scan`, body);
}

/** Regera o plano de correção a partir dos achados abertos (idempotente). */
export async function generateSecurityPatchPlans(body = {}) {
  return postJson(`${BASE_PATH}/patches/generate`, body);
}

/**
 * Submete a missão de correção ao Roteador Engenheiro.
 *
 * A autorização (Nível C) é DERIVADA da sessão autenticada no backend — a tela
 * não envia `authorizedBy` e não pode declarar quem autoriza. A recusa vem do
 * backend (`patch_candidate_requires_authorization` para o serviço, ou
 * `approval_identity_not_accepted` se algum chamador tentar declarar identidade).
 */
export async function createSecurityPatchMission({ candidateKey }) {
  return postJson(`${BASE_PATH}/patch-mission`, { candidateKey });
}

/** Waivers de risco: isenção formal com expiração (decisão humana). */
export async function listSecurityWaivers(filters = {}) {
  return fetchJson(withQuery(`${BASE_PATH}/waivers`, filters));
}

/**
 * Concede um waiver. Recusas de política (prazo acima do limite, sem expiração,
 * motivo curto, achado que não é risco aberto) vêm do backend com o código do
 * motivo — a tela não tenta decidir elegibilidade.
 *
 * O aprovador NÃO é enviado: ele é derivado do token no backend (permissão
 * `security_intel:waiver_approve`). Enviar `approvedBy` é recusado com 400
 * `approval_identity_not_accepted`.
 */
export async function createSecurityWaiver({
  findingKey,
  reason,
  expiresInDays,
  compensatingControl = null,
}) {
  return postJson(`${BASE_PATH}/waivers`, {
    findingKey,
    reason,
    expiresInDays,
    compensatingControl,
  });
}

/** Revoga sem apagar: o achado volta a contar como risco aberto. */
export async function revokeSecurityWaiver({ waiverKey, reason = null }) {
  return postJson(`${BASE_PATH}/waivers/revoke`, { waiverKey, reason });
}

/**
 * Fila de triagem: pacotes classificados por bucket, com motivo, impacto medido no
 * gate e comando pronto. Mesma fonte do CLI (`security-intel.js triage`).
 */
export async function getSecurityTriage() {
  return fetchJson(`${BASE_PATH}/triage`);
}
