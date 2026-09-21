'use strict';

/**
 * api/services/engineeringRouter/modelAvailabilityStore.js
 *
 * ERV1-CLOSE-008: provider saudável (circuit breaker fechado) NÃO implica que um `modelId`
 * específico seja válido. Achado real do pilot V1: `openai:gpt-5.5-pro` e `openai:gpt-5-codex`
 * retornaram 404 real da API ("modelo não existe"/"descontinuado") enquanto o provider
 * `openai` em si estava perfeitamente saudável — o breaker do AI Control Plane nunca abre por
 * isso (é um erro de modelo, não de provider), então nada impedia o Router de continuar
 * escolhendo o mesmo modelo quebrado.
 *
 * Estado em memória (mesmo padrão já usado por `aiControlPlaneStatus.js` para o circuit
 * breaker — não é um registry externo de modelos válidos porque nenhum provider builtin expõe
 * isso de forma consultável antes do primeiro uso real). TTL evita que uma falha transitória
 * (rate limit, timeout de rede) exclua um modelo para sempre.
 */

const DEFAULT_TTL_MS = Number(process.env.ENGINEERING_ROUTER_MODEL_AVAILABILITY_TTL_MS || 60 * 60 * 1000);

const AVAILABILITY_STATES = Object.freeze([
  'AVAILABLE',
  'UNAVAILABLE',
  'UNKNOWN',
  'RETIRED',
  'AUTH_DENIED',
  'RATE_LIMITED',
  'TEMPORARILY_UNAVAILABLE',
]);

// Estados que excluem o modelo da seleção enquanto a entrada não expirar. Só AVAILABLE/UNKNOWN
// (nunca falhou, ou falhou e o TTL já passou) contam como usáveis — inclusive falhas
// transitórias (RATE_LIMITED/TEMPORARILY_UNAVAILABLE) ficam de fora até expirar, com TTL bem
// mais curto que falhas permanentes (RETIRED/AUTH_DENIED/UNAVAILABLE).
const UNUSABLE_STATES = new Set(['UNAVAILABLE', 'RETIRED', 'AUTH_DENIED', 'RATE_LIMITED', 'TEMPORARILY_UNAVAILABLE']);

/** @type {Map<string, {availability:string, reason:string|null, checkedAt:number, expiresAt:number, source:string}>} */
const store = new Map();

function key(providerId, modelId) {
  return `${providerId}:${modelId}`;
}

/**
 * Registra uma falha real específica de modelo (não de provider). Chamado pelo
 * `engineeringAiInvoker`/orquestrador quando uma chamada real falha de um jeito que indica o
 * modelo em si (não o provider) — ex.: 404 "modelo não existe", 401 "modelo não autorizado
 * nesta conta".
 */
function markUnavailable(providerId, modelId, { reason = null, state = 'UNAVAILABLE', ttlMs = DEFAULT_TTL_MS, source = 'runtime_failure' } = {}) {
  if (!providerId || !modelId) return;
  if (!AVAILABILITY_STATES.includes(state)) state = 'UNAVAILABLE';
  const now = Date.now();
  store.set(key(providerId, modelId), { availability: state, reason, checkedAt: now, expiresAt: now + ttlMs, source });
}

/** Sucesso real de uma chamada limpa qualquer marca anterior — o modelo provou que funciona. */
function markAvailable(providerId, modelId) {
  if (!providerId || !modelId) return;
  store.delete(key(providerId, modelId));
}

/** @returns {{availability:string, reason?:string|null, checkedAt?:number, source?:string}} */
function getAvailability(providerId, modelId) {
  const entry = store.get(key(providerId, modelId));
  if (!entry) return { availability: 'UNKNOWN' };
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    store.delete(key(providerId, modelId));
    return { availability: 'UNKNOWN' };
  }
  return entry;
}

/** Booleano de conveniência usado por `engineeringModelAvailabilityService.buildAvailableModels`. */
function isUsable(providerId, modelId) {
  const { availability } = getAvailability(providerId, modelId);
  return !UNUSABLE_STATES.has(availability);
}

/**
 * Classifica um erro real de invocação de modelo em um estado de disponibilidade. Best-effort
 * por mensagem/código — providers builtin não expõem um código estruturado uniforme para
 * "modelo não existe" vs. "sem saldo" vs. "rate limit", então a classificação é textual.
 */
function classifyModelFailure(err) {
  const message = String(err?.message || '').toLowerCase();
  const status = err?.httpStatus || err?.status || null;

  if (status === 404 || /not a chat model|does not exist|model_not_found|deprecated|descontinuad/i.test(message)) {
    return { state: 'RETIRED', reason: err?.message || 'modelo não existe/descontinuado' };
  }
  if (status === 401 || /invalid api key|unauthorized/i.test(message)) {
    return { state: 'AUTH_DENIED', reason: err?.message || 'não autorizado' };
  }
  if (status === 429 || /rate limit/i.test(message)) {
    return { state: 'RATE_LIMITED', reason: err?.message || 'rate limit', ttlMs: 5 * 60 * 1000 };
  }
  return { state: 'TEMPORARILY_UNAVAILABLE', reason: err?.message || 'falha ao invocar', ttlMs: 10 * 60 * 1000 };
}

function _clearAllForTests() {
  store.clear();
}

module.exports = {
  AVAILABILITY_STATES,
  UNUSABLE_STATES,
  markUnavailable,
  markAvailable,
  getAvailability,
  isUsable,
  classifyModelFailure,
  _clearAllForTests,
};
