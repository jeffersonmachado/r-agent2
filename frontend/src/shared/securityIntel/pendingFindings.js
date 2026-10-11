/**
 * O que conta como "pendência" na tela de inteligência de segurança.
 *
 * Regra de negócio que este módulo protege: o operador liga "Apenas pendências"
 * para ver SÓ o que exige decisão humana. O primeiro critério escrito nesta tela
 * era "sem correção publicada OU severidade bloqueante" — mas a lista já vem
 * `riskOnly`, então 86 de 146 achados sobreviviam ao filtro e a impressão era de
 * que o filtro não fazia nada (medido com o operador em 2026-10-11). Severidade
 * alta COM correção disponível não é pendência de decisão: é missão de correção.
 *
 * Critério correto — pendência é o que depende de uma DECISÃO:
 *   a) achado sem versão corrigida publicada (`NO_FIX_AVAILABLE`): só sai do
 *      risco por isenção com prazo ou controle compensatório; ou
 *   b) achado com isenção solicitada e ainda não aprovada (`PENDING_APPROVAL`):
 *      enquanto ninguém aprovar, o achado continua contando como risco aberto.
 *
 * A contagem é sempre sobre os achados CARREGADOS: a lista da API é paginada e o
 * módulo não inventa cobertura — quem exibe declara o total usado.
 *
 * Módulo puro: sem React, sem I/O, sem relógio.
 */

/** Estado de isenção que ainda NÃO vigora (solicitada, aguardando outra pessoa). */
export const PENDING_WAIVER_STATE = 'PENDING_APPROVAL';

/** Estado de isenção vigente (aprovada e dentro do prazo). */
export const ACTIVE_WAIVER_STATE = 'ACTIVE';

function stateOf(row) {
  return String((row && (row.state || row.status)) || '').toUpperCase();
}

function findingKeyOf(row) {
  if (!row) return null;
  return row.finding_key || row.findingKey || null;
}

/** Achado sem versão corrigida publicada — só sai do risco por decisão humana. */
export function semCorrecaoPublicada(row) {
  return stateOf(row) === 'NO_FIX_AVAILABLE';
}

/**
 * Achado que vive só na cadeia de build/teste (devDependency).
 *
 * O gate de release trata estes como AVISO (`DEV_ONLY_VULNERABILITY`), nunca como
 * bloqueio — carrega o flag do `SecurityComponent` exatamente para isso. A tela
 * precisa da mesma distinção: em 2026-10-11 `braces` e `sprintf-js` (dev-only)
 * apareciam como pendência idêntica a um bloqueante de runtime.
 */
export function somenteDev(row) {
  return row != null && row.dev_only === true;
}

/**
 * Índice de isenções por achado, separando o que aguarda aprovação do que vigora.
 *
 * Uma isenção vigente substitui a pendente na leitura do operador: se já existe
 * isenção aprovada, a ação é revogar — não voltar a solicitar.
 *
 * @param {{items?: Array}} waivers lista de waivers (state=ALL)
 * @returns {Map<string, {pending: object|null, active: object|null}>}
 */
export function indexWaiversByFinding(waivers) {
  const map = new Map();
  const items = Array.isArray(waivers && waivers.items) ? waivers.items : [];
  items.forEach((waiver) => {
    const key = findingKeyOf(waiver);
    if (!key) return;
    const state = stateOf(waiver);
    const entry = map.get(key) || { pending: null, active: null };
    if (state === PENDING_WAIVER_STATE && !entry.pending) entry.pending = waiver;
    if (state === ACTIVE_WAIVER_STATE && !entry.active) entry.active = waiver;
    map.set(key, entry);
  });
  return map;
}

/** Chaves de achado cuja isenção está aguardando aprovação. */
export function pendingWaiverFindingKeys(waivers) {
  const keys = new Set();
  const items = Array.isArray(waivers && waivers.items) ? waivers.items : [];
  items.forEach((waiver) => {
    if (stateOf(waiver) !== PENDING_WAIVER_STATE) return;
    const key = findingKeyOf(waiver);
    if (key) keys.add(key);
  });
  return keys;
}

/**
 * Achados que exigem decisão humana agora.
 *
 * @param {{findings?: {items?: Array}, waivers?: {items?: Array}}} input
 * @returns {Array} os achados carregados que são pendência
 */
export function selectPendingFindings({ findings, waivers } = {}) {
  const pendentes = pendingWaiverFindingKeys(waivers);
  const items = Array.isArray(findings && findings.items) ? findings.items : [];
  return items.filter((row) => semCorrecaoPublicada(row) || pendentes.has(findingKeyOf(row)));
}

/**
 * Resumo do filtro para exibição: sem isto o filtro é silencioso e o operador não
 * sabe se ele agiu (o defeito relatado foi justamente "nada mudou").
 *
 * @param {{loaded?: Array, pending?: Array}} input
 */
export function summarizePendingFindings({ loaded, pending } = {}) {
  const carregados = Array.isArray(loaded) ? loaded : [];
  const pendentes = Array.isArray(pending) ? pending : [];
  const semCorrecao = pendentes.filter(semCorrecaoPublicada).length;
  const devOnly = pendentes.filter(somenteDev).length;
  return {
    loadedTotal: carregados.length,
    pendingTotal: pendentes.length,
    semCorrecao,
    aguardandoAprovacao: pendentes.length - semCorrecao,
    // Dos pendentes, quantos o gate NÃO bloqueia (cadeia de build/teste).
    devOnly,
    bloqueantes: pendentes.length - devOnly,
  };
}

export default { selectPendingFindings, summarizePendingFindings, indexWaiversByFinding };
