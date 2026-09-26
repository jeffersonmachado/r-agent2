'use strict';

/**
 * engine/engineeringMission/progressPolicy.js — POLÍTICA DE PROGRESSO (núcleo puro).
 *
 * PRINCÍPIO: SLOW != STUCK != DEAD.
 *
 *   - DEAD  = liveness perdida (heartbeat parou → lease expira). Quem decide isso
 *             é `leasePolicy` + fencing, nunca tempo decorrido.
 *   - STUCK = worker VIVO (heartbeat fresco) e SEM progresso significativo.
 *             Precisa de DIAGNÓSTICO — não de kill, não de takeover.
 *   - SLOW  = worker vivo E progredindo, apenas demorando. É estado LEGÍTIMO.
 *
 * Esta camada existe porque o repositório NÃO tinha detector de progresso:
 * a liveness era medida (lease/heartbeat), mas não havia como distinguir
 * "trabalhando em algo longo" de "travado" — e a resposta errada nesse caso
 * (matar a task por tempo) é o defeito que esta missão elimina.
 *
 * Invariantes:
 *   1. HEARTBEAT PROVA LIVENESS; PROGRESSO PROVA AVANÇO. São separados:
 *      `heartbeat`/`lease_renewal`/`poll_tick` NUNCA contam como progresso.
 *   2. Não existe limite único para todas as fases: REGRESSION pode ficar muito
 *      tempo sem transição de fase e continuar progredindo (eventos de teste).
 *   3. Detectar NO_PROGRESS NÃO decide morte: devolve o que INSPECIONAR e quais
 *      ações são elegíveis. Quem decide é a política de operação/replan.
 *   4. O núcleo é PURO: não lê relógio, não faz I/O. Quem chama passa `nowMs`.
 */

/** Sinais que CONTAM como progresso significativo (avanço verificável). */
const PROGRESS_SIGNALS = Object.freeze([
  'phase_change',
  'provider_response',
  'test_result',
  'command_output_relevant',
  'patch_produced',
  'commit',
  'checkpoint',
  'evidence_produced',
  'reviewer_result',
  'gate_completed',
  'state_transition',
]);

/** Sinais que provam apenas LIVENESS — jamais progresso funcional. */
const NON_PROGRESS_SIGNALS = Object.freeze([
  'heartbeat',
  'lease_renewal',
  'poll_tick',
  'keepalive',
]);

/** Limiar por FASE. Regressão/teste podem legitimamente ser longos. */
const DEFAULT_PHASE_THRESHOLDS_MS = Object.freeze({
  ANALYZING: 10 * 60 * 1000,
  IMPLEMENTING: 20 * 60 * 1000,
  TESTING: 30 * 60 * 1000,
  REVIEWING: 15 * 60 * 1000,
  REGRESSION: 45 * 60 * 1000,
  DEFAULT: 15 * 60 * 1000,
});

/** Ações elegíveis quando NO_PROGRESS é detectado (em ordem de preferência). */
const NO_PROGRESS_ACTIONS = Object.freeze([
  'wait',
  'cancel_operation',
  'retry_operation',
  'switch_provider',
  'restart_child_process',
  'replan_task',
  'escalate',
]);

const PROGRESS_STATES = Object.freeze({
  PROGRESSING: 'PROGRESSING',
  NO_PROGRESS: 'NO_PROGRESS',
  UNKNOWN: 'UNKNOWN',
});

function isMeaningfulSignal(signal) {
  const s = String(signal || '').trim().toLowerCase();
  if (!s) return false;
  if (NON_PROGRESS_SIGNALS.includes(s)) return false;
  return PROGRESS_SIGNALS.includes(s);
}

function toMs(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Registra progresso. Sinal de liveness é IGNORADO de propósito: aceitar
 * `heartbeat` aqui apagaria a distinção entre vivo e avançando — o coração da
 * missão.
 *
 * @returns {{record:object, accepted:boolean, reason:string}}
 */
function recordProgress(record, { signal, atMs, detail = null } = {}) {
  const base = record && typeof record === 'object' ? record : {};
  if (!isMeaningfulSignal(signal)) {
    return {
      record: base,
      accepted: false,
      reason: NON_PROGRESS_SIGNALS.includes(String(signal || '').toLowerCase())
        ? `sinal "${signal}" prova liveness, não progresso`
        : `sinal "${signal}" não é progresso significativo`,
    };
  }
  const at = Number.isFinite(atMs) ? atMs : Date.now();
  const previous = toMs(base.lastMeaningfulProgressAt);
  // Progresso só AVANÇA: um sinal atrasado/fora de ordem não retrocede o marco
  // (senão um evento antigo reenviado faria a task parecer travada).
  if (previous !== null && previous > at) {
    return { record: base, accepted: false, reason: 'sinal fora de ordem (marco não retrocede)' };
  }
  return {
    record: {
      ...base,
      lastMeaningfulProgressAt: new Date(at).toISOString(),
      lastProgressSignal: String(signal).toLowerCase(),
      progressCount: Number(base.progressCount || 0) + 1,
      ...(detail ? { lastProgressDetail: String(detail).slice(0, 300) } : {}),
    },
    accepted: true,
    reason: 'progresso registrado',
  };
}

function resolveNoProgressThresholdMs({ phase = null, policy = null } = {}) {
  if (policy && Number.isFinite(policy)) return policy;
  if (policy && typeof policy === 'object') {
    if (phase && Number.isFinite(policy.perPhase?.[phase])) return policy.perPhase[phase];
    if (Number.isFinite(policy.default)) return policy.default;
  }
  const key = String(phase || '').toUpperCase();
  return DEFAULT_PHASE_THRESHOLDS_MS[key] ?? DEFAULT_PHASE_THRESHOLDS_MS.DEFAULT;
}

/**
 * Avalia o progresso. NÃO decide morte: devolve estado + o que investigar.
 *
 * @param {object} record linha com `lastMeaningfulProgressAt` e (opcional)
 *   `leaseHeartbeatAt`/`heartbeatAt`
 * @param {{ nowMs:number, phase?:string, policy?:object|number, heartbeatAgeMs?:number|null }} ctx
 */
function evaluateProgress(record, { nowMs, phase = null, policy = null, heartbeatAgeMs = null } = {}) {
  const last = toMs(record?.lastMeaningfulProgressAt);
  const thresholdMs = resolveNoProgressThresholdMs({ phase, policy });

  // Sem marco de progresso NÃO existe veredito: "sem dado registrado não existe
  // veredito" (convenção do projeto) — devolve UNKNOWN, nunca NO_PROGRESS falso.
  if (last === null) {
    return {
      state: PROGRESS_STATES.UNKNOWN,
      reason: 'sem marco de progresso registrado (não há veredito)',
      lastMeaningfulProgressAt: null,
      lastProgressSignal: record?.lastProgressSignal || null,
      silentForMs: null,
      thresholdMs,
      phase,
      livenessFresh: heartbeatAgeMs === null ? null : heartbeatAgeMs >= 0,
      actions: [],
    };
  }

  const silentForMs = Math.max(0, nowMs - last);
  const alive = heartbeatAgeMs === null ? null : Number.isFinite(heartbeatAgeMs);
  const state = silentForMs >= thresholdMs ? PROGRESS_STATES.NO_PROGRESS : PROGRESS_STATES.PROGRESSING;

  return {
    state,
    reason: state === PROGRESS_STATES.NO_PROGRESS
      ? `sem progresso significativo há ${silentForMs}ms (limiar da fase ${phase || 'DEFAULT'}: ${thresholdMs}ms)`
      : `progresso há ${silentForMs}ms (limiar ${thresholdMs}ms)`,
    lastMeaningfulProgressAt: record.lastMeaningfulProgressAt,
    lastProgressSignal: record.lastProgressSignal || null,
    silentForMs,
    thresholdMs,
    phase,
    livenessFresh: alive,
    // Worker VIVO e sem progresso ⇒ DIAGNÓSTICO. Nunca takeover (a posse está
    // saudável) nem kill (a liveness está comprovada).
    actions: state === PROGRESS_STATES.NO_PROGRESS ? [...NO_PROGRESS_ACTIONS] : [],
    diagnosis: state === PROGRESS_STATES.NO_PROGRESS
      ? { inspect: 'operation_in_progress', captureDiagnostics: true, classifyBeforeActing: true }
      : null,
  };
}

module.exports = {
  PROGRESS_SIGNALS,
  NON_PROGRESS_SIGNALS,
  DEFAULT_PHASE_THRESHOLDS_MS,
  NO_PROGRESS_ACTIONS,
  PROGRESS_STATES,
  isMeaningfulSignal,
  recordProgress,
  resolveNoProgressThresholdMs,
  evaluateProgress,
};
