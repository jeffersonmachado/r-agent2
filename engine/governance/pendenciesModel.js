'use strict';

/**
 * Modelo PURO das pendências de missão e governança.
 *
 * Por que em `engine/`: montar a lista de "o que exige ação humana agora" é uma
 * transformação de dados — sem I/O, sem relógio próprio, sem banco. Manter a
 * regra aqui a torna testável nos dois sentidos (item bloqueado É pendência;
 * item concluído NÃO é) e impede que a tela e a API divirjam sobre o critério.
 *
 * Regra de negócio fixada (não é preferência de UI):
 *   - `blocked` e `pending`/`in_progress` da fila exigem AÇÃO HUMANA;
 *   - `done` não exige (já tem prova registrada);
 *   - waiver em PENDING_APPROVAL exige ação humana: nada é isentado até alguém
 *     DIFERENTE do solicitante aprovar (segregação de funções);
 *   - bloqueio de release com decisão diferente de GO exige ação humana.
 *
 * Honestidade: a lista NUNCA inventa pendência para preencher tela. Fonte
 * ausente vira `sourceUnavailable` no resumo, não item fabricado.
 */

const QUEUE_SOURCE = 'hardening-queue';
const WAIVER_SOURCE = 'security-waivers';
const RELEASE_SOURCE = 'release-governance';

const KINDS = Object.freeze({
  QUEUE: 'queue',
  WAIVER_PENDING: 'waiver_pending',
  RELEASE: 'release',
});

const SEVERITY_ORDER = Object.freeze({ high: 0, medium: 1, low: 2 });

/** Status da fila que exigem ação humana. */
const HUMAN_STATUSES = Object.freeze(new Set(['blocked', 'pending', 'in_progress']));

function toText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/**
 * Normaliza um instante RECEBIDO. O engine NÃO cria relógio: `new Date()` dentro
 * do engine é violação de pureza (e afeta determinismo) — o instante vem do
 * chamador, que é quem tem direito de ler o tempo. Sem instante, o campo sai
 * nulo em vez de inventado.
 */
function toIso(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}

/**
 * Classifica um item da fila oficial (`AI_MEMORY/hardening-queue.json`).
 * `blocked_reason` é a explicação registrada por quem bloqueou — ela é
 * transportada VERBATIM para a tela: reescrever a razão seria esconder o motivo.
 */
function classifyQueueItem(item, { now = null } = {}) {
  if (!item || !toText(item.id)) return null;
  const status = toText(item.status) || 'pending';
  const blockedReason = toText(item.blocked_reason);
  const requiresHumanAction = HUMAN_STATUSES.has(status);

  return {
    id: String(item.id),
    kind: KINDS.QUEUE,
    title: toText(item.title) || String(item.id),
    status,
    severity: status === 'blocked' ? 'high' : 'medium',
    requiresHumanAction,
    why: status === 'blocked'
      ? (blockedReason || 'bloqueado sem razão registrada — a fila exige razão escrita')
      : (status === 'done' ? null : 'item aberto na fila de missão'),
    actionLabel: status === 'blocked' ? 'Decidir o que destrava' : 'Acompanhar execução',
    actionHref: null,
    blockedReason,
    commit: toText(item.commit),
    evidence: toText(item.evidence),
    updatedAt: toText(item.updated_at) || toText(item.updatedAt) || null,
    generatedAt: toIso(now),
  };
}

/** Waiver aguardando aprovação: exige ação humana (de OUTRO ator). */
function classifyPendingWaiver(waiver) {
  if (!waiver) return null;
  const key = toText(waiver.waiver_key) || toText(waiver.waiverKey);
  if (!key) return null;
  const state = (toText(waiver.state) || toText(waiver.status) || '').toUpperCase();
  const pending = state === 'PENDING_APPROVAL';
  const findingKey = toText(waiver.finding_key) || toText(waiver.findingKey);
  return {
    id: `waiver:${key}`,
    kind: KINDS.WAIVER_PENDING,
    title: findingKey ? `Isenção aguardando aprovação — ${findingKey}` : `Isenção aguardando aprovação — ${key}`,
    status: state || 'UNKNOWN',
    severity: 'high',
    requiresHumanAction: pending,
    why: pending
      ? 'isenção solicitada e NÃO vigente: exige aprovação de usuário diferente do solicitante'
      : null,
    actionLabel: pending ? 'Aprovar ou revogar' : 'Acompanhar',
    actionHref: '/dev/security-intel',
    blockedReason: null,
    commit: null,
    evidence: toText(waiver.reason),
    waiverKey: key,
    expiresAt: toText(waiver.expires_at) || toText(waiver.expiresAt) || null,
    requestedBy: toText(waiver.requested_by) || toText(waiver.requestedBy) || null,
    approvedBy: toText(waiver.approved_by) || toText(waiver.approvedBy) || null,
  };
}

/** Bloqueio de release (gate/governança) que não está em GO. */
function classifyReleaseBlocker(blocker) {
  if (!blocker) return null;
  const code = toText(blocker.code) || toText(blocker.id);
  if (!code) return null;
  const decided = toText(blocker.decision) || toText(blocker.status);
  // Quem LÊ o relatório decide se ele é bloqueio (o vocabulário de decisão não é
  // uniforme entre os gates). O modelo apenas transporta a decisão; quando ela
  // não vem declarada, NÃO se infere bloqueio a partir do token da decisão —
  // foi assim que `final-consistency` (pass=true, finalDecision=
  // AUTONOMOUS_READY_GO) apareceu como bloqueio falso em 2026-10-11.
  const explicitlyBlocked = blocker.blocked === true;
  const explicitlyOk = blocker.blocked === false;
  const requiresHumanAction = explicitlyOk ? false : explicitlyBlocked;
  return {
    id: `release:${code}`,
    kind: KINDS.RELEASE,
    title: toText(blocker.title) || code,
    status: decided || 'UNKNOWN',
    severity: toText(blocker.severity) || 'high',
    requiresHumanAction,
    why: requiresHumanAction ? (toText(blocker.why) || `bloqueio de release com decisão ${decided || 'desconhecida'}`) : null,
    actionLabel: 'Destravar o release',
    actionHref: '/dev/engineering/release-closure',
    blockedReason: null,
    commit: null,
    evidence: toText(blocker.evidence),
  };
}

function sortItems(items) {
  return items.slice().sort((a, b) => {
    const rankA = SEVERITY_ORDER[a.severity] === undefined ? 3 : SEVERITY_ORDER[a.severity];
    const rankB = SEVERITY_ORDER[b.severity] === undefined ? 3 : SEVERITY_ORDER[b.severity];
    if (rankA !== rankB) return rankA - rankB;
    const humanA = a.requiresHumanAction ? 0 : 1;
    const humanB = b.requiresHumanAction ? 0 : 1;
    if (humanA !== humanB) return humanA - humanB;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Monta a lista de pendências a partir das fontes disponíveis.
 *
 * @param {object} input
 * @param {Array<object>} [input.queueItems]   itens da fila oficial
 * @param {Array<object>} [input.waivers]      waivers (qualquer estado)
 * @param {Array<object>} [input.releaseBlockers] bloqueios de release
 * @param {string[]}      [input.sourceUnavailable] fontes que NÃO puderam ser lidas
 * @param {Date}          [input.now]
 */
function buildPendencies({ queueItems = [], waivers = [], releaseBlockers = [], sourceUnavailable = [], now = null } = {}) {
  const items = [];

  for (const raw of queueItems) {
    const classified = classifyQueueItem(raw, { now });
    if (classified) items.push(classified);
  }
  for (const raw of waivers) {
    const classified = classifyPendingWaiver(raw);
    if (classified) items.push(classified);
  }
  for (const raw of releaseBlockers) {
    const classified = classifyReleaseBlocker(raw);
    if (classified) items.push(classified);
  }

  const sorted = sortItems(items);
  const requiresHumanAction = sorted.filter((item) => item.requiresHumanAction);

  return {
    generatedAt: toIso(now),
    summary: {
      total: sorted.length,
      requiresHumanAction: requiresHumanAction.length,
      blocked: sorted.filter((item) => item.status === 'blocked').length,
      awaitingApproval: sorted.filter((item) => item.kind === KINDS.WAIVER_PENDING && item.status === 'PENDING_APPROVAL').length,
      releaseBlockers: sorted.filter((item) => item.kind === KINDS.RELEASE && item.requiresHumanAction).length,
      done: sorted.filter((item) => item.status === 'done').length,
    },
    sourceUnavailable: sourceUnavailable.slice(),
    sources: [QUEUE_SOURCE, WAIVER_SOURCE, RELEASE_SOURCE],
    items: sorted,
  };
}

/** Filtro da tela: `onlyPending` lista SÓ o que exige ação humana agora. */
function filterPendencies(pendencies, { onlyPending = false } = {}) {
  if (!pendencies || !Array.isArray(pendencies.items)) return pendencies;
  if (!onlyPending) return pendencies;
  const items = pendencies.items.filter((item) => item.requiresHumanAction === true);
  return { ...pendencies, items, filtered: { onlyPending: true, count: items.length } };
}

module.exports = {
  KINDS,
  QUEUE_SOURCE,
  WAIVER_SOURCE,
  RELEASE_SOURCE,
  HUMAN_STATUSES,
  classifyQueueItem,
  classifyPendingWaiver,
  classifyReleaseBlocker,
  buildPendencies,
  filterPendencies,
};
