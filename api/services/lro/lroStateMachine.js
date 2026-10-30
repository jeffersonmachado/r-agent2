'use strict';

/**
 * Núcleo PURO da máquina de estados de Long-Running Operations (LRO).
 *
 * Sem I/O, sem banco, sem relógio: só decide se uma transição é legal e qual patch ela produz.
 * A persistência (PostgreSQL) e a entrega (SSE/WS) ficam nos adaptadores — ver
 * `docs/architecture/lro-qa-waves.md`.
 *
 * Invariantes do mandato (§4, §5, §10) que este arquivo encarna:
 *  1. só as transições declaradas são legais;
 *  2. estado terminal é IMUTÁVEL; mudança só por reconciliação explícita com motivo e fence;
 *  3. `COMPLETED` não significa GO — o desfecho fica em campo próprio e obrigatório;
 *  4. progresso sem total conhecido é INDETERMINADO (nunca 100% presumido);
 *  5. `WAITING_FEEDBACK` exige solicitação de decisão identificada;
 *  6. visibilidade é uma das três classes; qualquer outra é recusada.
 */

const STATES = Object.freeze({
  CREATED: 'CREATED',
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  WAITING_FEEDBACK: 'WAITING_FEEDBACK',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  TIMED_OUT: 'TIMED_OUT',
});

const TERMINAL_STATES = Object.freeze([
  STATES.COMPLETED,
  STATES.FAILED,
  STATES.CANCELLED,
  STATES.TIMED_OUT,
]);

const TRANSITIONS = Object.freeze({
  [STATES.CREATED]: [STATES.QUEUED, STATES.CANCELLED],
  [STATES.QUEUED]: [STATES.RUNNING, STATES.PAUSED, STATES.CANCELLED, STATES.TIMED_OUT],
  [STATES.RUNNING]: [
    STATES.WAITING_FEEDBACK,
    STATES.PAUSED,
    STATES.COMPLETED,
    STATES.FAILED,
    STATES.CANCELLED,
    STATES.TIMED_OUT,
  ],
  [STATES.WAITING_FEEDBACK]: [STATES.RUNNING, STATES.PAUSED, STATES.FAILED, STATES.CANCELLED, STATES.TIMED_OUT],
  [STATES.PAUSED]: [STATES.QUEUED, STATES.RUNNING, STATES.CANCELLED, STATES.TIMED_OUT],
  [STATES.COMPLETED]: [],
  [STATES.FAILED]: [],
  [STATES.CANCELLED]: [],
  [STATES.TIMED_OUT]: [],
});

const VALID_VISIBILITY_CLASSES = Object.freeze(['PRODUCTION', 'SUPPORT', 'DEVELOPMENT']);

/** Desfechos possíveis de uma operação concluída. `COMPLETED` é status; isto é resultado. */
const OUTCOMES = Object.freeze(['GO', 'NO_GO', 'INCONCLUSIVE']);

const CODES = Object.freeze({
  ESTADO_DESCONHECIDO: 'ESTADO_DESCONHECIDO',
  TRANSICAO_INVALIDA: 'TRANSICAO_INVALIDA',
  TERMINAL_IMUTAVEL: 'TERMINAL_IMUTAVEL',
  RECONCILIACAO_SEM_MOTIVO: 'RECONCILIACAO_SEM_MOTIVO',
  RECONCILIACAO_FENCE_INVALIDO: 'RECONCILIACAO_FENCE_INVALIDO',
  DESFECHO_AUSENTE: 'DESFECHO_AUSENTE',
  DESFECHO_INVALIDO: 'DESFECHO_INVALIDO',
  FEEDBACK_SEM_SOLICITACAO: 'FEEDBACK_SEM_SOLICITACAO',
  VISIBILIDADE_INVALIDA: 'VISIBILIDADE_INVALIDA',
  /** Aviso (não erro): conclusão sem GO. Quem lê status precisa ler o desfecho também. */
  COMPLETED_NAO_E_GO: 'COMPLETED_NAO_E_GO',
});

const ehEstado = (valor) => typeof valor === 'string' && Object.prototype.hasOwnProperty.call(TRANSITIONS, valor);

function canTransition(from, to) {
  if (!ehEstado(from) || !ehEstado(to)) return false;
  return (TRANSITIONS[from] || []).includes(to);
}

/**
 * Normaliza progresso. Total desconhecido/zero ⇒ INDETERMINADO (`percent: null`), nunca 100%.
 * Corrente acima do total é limitada a 100 para não gerar barra incoerente — mas o valor bruto
 * continua no registro, então a inconsistência é auditável.
 */
function normalizeProgress({ current = null, total = null, unit = null } = {}) {
  const atual = Number.isFinite(Number(current)) ? Number(current) : null;
  const totalNum = Number.isFinite(Number(total)) ? Number(total) : null;
  const totalConhecido = totalNum !== null && totalNum > 0;
  const unitNorm = unit === null || unit === undefined || unit === '' ? null : String(unit);

  if (!totalConhecido) {
    return { current: atual, total: totalConhecido ? totalNum : null, unit: unitNorm, percent: null, indeterminate: true };
  }
  const percent = Math.max(0, Math.min(100, Math.round(((atual || 0) / totalNum) * 100)));
  return { current: atual, total: totalNum, unit: unitNorm, percent, indeterminate: false };
}

/**
 * Avalia uma transição e devolve o patch a persistir.
 *
 * @param {object} entrada
 * @param {string} entrada.from estado atual
 * @param {string} entrada.to estado desejado
 * @param {object} [entrada.operation] registro persistido (status/outcome/fence atuais)
 * @param {object} [entrada.context] dados da transição (outcome, feedbackRequestId, visibilityClass, reconciliation)
 * @param {number} [entrada.currentFence] fence atual da operação
 * @param {string|Date} [entrada.now] instante (injetado: o núcleo não lê o relógio)
 */
function evaluateTransition({ from, to, operation = {}, context = {}, currentFence = 0, now = null } = {}) {
  const warnings = [];
  const recusar = (code, detail) => ({ ok: false, code, detail: detail || null, warnings });

  if (!ehEstado(from)) return recusar(CODES.ESTADO_DESCONHECIDO, `from=${from}`);
  if (!ehEstado(to)) return recusar(CODES.ESTADO_DESCONHECIDO, `to=${to}`);

  const visibility = context.visibilityClass;
  if (visibility !== undefined && !VALID_VISIBILITY_CLASSES.includes(visibility)) {
    return recusar(CODES.VISIBILIDADE_INVALIDA, String(visibility));
  }

  const statusPersistido = operation && operation.status ? operation.status : from;
  const partindoDeTerminal = TERMINAL_STATES.includes(statusPersistido);
  let reconciliation = false;

  if (partindoDeTerminal) {
    const rec = context.reconciliation;
    if (!rec || typeof rec !== 'object') {
      return recusar(CODES.TERMINAL_IMUTAVEL, `${statusPersistido} -> ${to}`);
    }
    if (typeof rec.reason !== 'string' || rec.reason.trim() === '') {
      return recusar(CODES.RECONCILIACAO_SEM_MOTIVO);
    }
    const fencePedido = Number(rec.fence);
    if (!Number.isFinite(fencePedido) || fencePedido < Number(currentFence || 0)) {
      return recusar(CODES.RECONCILIACAO_FENCE_INVALIDO, `fence=${rec.fence} atual=${currentFence}`);
    }
    reconciliation = true;
  } else if (!canTransition(from, to)) {
    return recusar(CODES.TRANSICAO_INVALIDA, `${from} -> ${to}`);
  }

  const patch = {
    status: to,
    updated_at: now || null,
  };

  if (to === STATES.COMPLETED) {
    const outcome = context.outcome;
    if (outcome === undefined || outcome === null || outcome === '') {
      return recusar(CODES.DESFECHO_AUSENTE, 'COMPLETED exige outcome GO|NO_GO|INCONCLUSIVE');
    }
    if (!OUTCOMES.includes(outcome)) {
      return recusar(CODES.DESFECHO_INVALIDO, String(outcome));
    }
    patch.outcome = outcome;
    patch.completed_at = now || null;
    if (outcome !== 'GO') warnings.push(CODES.COMPLETED_NAO_E_GO);
  }

  if (to === STATES.FAILED || to === STATES.CANCELLED || to === STATES.TIMED_OUT) {
    patch.completed_at = now || null;
    if (context.errorCode) patch.error_code = String(context.errorCode);
    if (context.reason) patch.result_ref = context.reason;
  }

  if (to === STATES.WAITING_FEEDBACK) {
    const pedido = context.feedbackRequestId;
    if (typeof pedido !== 'string' || pedido.trim() === '') {
      return recusar(CODES.FEEDBACK_SEM_SOLICITACAO);
    }
    patch.feedback_request_id = pedido;
  }

  if (to === STATES.RUNNING && from !== STATES.RUNNING) {
    patch.started_at = operation && operation.started_at ? operation.started_at : (now || null);
  }

  if (reconciliation) patch.fence = Number(currentFence || 0) + 1;

  return { ok: true, code: null, patch, warnings, reconciliation };
}

module.exports = {
  STATES,
  TERMINAL_STATES,
  TRANSITIONS,
  VALID_VISIBILITY_CLASSES,
  OUTCOMES,
  CODES,
  canTransition,
  evaluateTransition,
  normalizeProgress,
};
