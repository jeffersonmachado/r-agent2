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
  // Achado real do PILOT REAL (provider de IA real, não fake): DeepSeek sem saldo retorna HTTP
  // 402 com `error.code: "invalid_request_error"` — um código genérico, não específico de
  // saldo. Sem um estado dedicado, isso caía no fallback TEMPORARILY_UNAVAILABLE (TTL de só 10
  // min), mas falta de saldo não se resolve sozinha em minutos — precisa de um TTL bem mais
  // longo para não martelar o mesmo provider sem crédito repetidamente.
  'NO_CREDIT',
]);

// Estados que excluem o modelo da seleção enquanto a entrada não expirar. Só AVAILABLE/UNKNOWN
// (nunca falhou, ou falhou e o TTL já passou) contam como usáveis — inclusive falhas
// transitórias (RATE_LIMITED/TEMPORARILY_UNAVAILABLE) ficam de fora até expirar, com TTL bem
// mais curto que falhas permanentes (RETIRED/AUTH_DENIED/UNAVAILABLE).
const UNUSABLE_STATES = new Set(['UNAVAILABLE', 'RETIRED', 'AUTH_DENIED', 'RATE_LIMITED', 'TEMPORARILY_UNAVAILABLE', 'NO_CREDIT']);

/**
 * Estados IMUTÁVEIS: não se resolvem com o tempo.
 *
 * DEFEITO MEDIDO (auditoria 2026-10-08). RETIRED significava apenas uma entrada com TTL
 * (`DEFAULT_TTL_MS` = 1h). Passada a hora, `getAvailability` APAGAVA o registro, o estado voltava a
 * `UNKNOWN` e `isUsable(UNKNOWN) === true` — ou seja, o Router voltava a escolher um modelo que o
 * provider havia dito que NÃO EXISTE (404 "model not found"/"deprecated"), queimando uma tentativa
 * por hora indefinidamente. "Modelo não existe nesta conta" é um FATO do provider, não uma
 * condição transitória: nenhum tempo decorrido o torna verdadeiro.
 *
 * Por isso estes estados NÃO têm expiração automática (`expiresAt: null`). Só saem do store por
 * prova POSITIVA de que voltaram a funcionar: uma chamada real bem-sucedida (`markAvailable`, que o
 * invoker chama em sucesso) ou uma re-descoberta explícita do catálogo do provider. A ausência de
 * tempo limite é a decisão CORRETA e conservadora: errar para "não usar" custa um candidato a menos
 * na cadeia; errar para "usar" custa uma tentativa inteira, toda vez.
 */
const HARD_STATES = new Set(['RETIRED']);

function isHardState(state) {
  return HARD_STATES.has(state);
}

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
  // `ttlMs: null` significa SEM expiração automática (estado IMUTÁVEL — ver HARD_STATES). Precisa
  // ser tratado explicitamente: `now + null` resultaria em `now`, isto é, expiração IMEDIATA, o
  // oposto exato do pretendido.
  const expiresAt = (ttlMs === null || isHardState(state)) ? null : now + ttlMs;
  store.set(key(providerId, modelId), { availability: state, reason, checkedAt: now, expiresAt, source });
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
  // `httpStatus` é o campo que engineeringAiInvoker.js preserva do erro ORIGINAL do provider —
  // `err.status` sozinho não é confiável aqui porque o erro pode já estar embrulhado (o `.code`
  // do wrapper é sempre PROVIDER_UNAVAILABLE no nosso domínio; o status HTTP real do provider
  // vem só de `httpStatus`).
  const status = err?.httpStatus ?? err?.cause?.status ?? err?.status ?? null;

  if (status === 404 || /not a chat model|does not exist|model_not_found|deprecated|descontinuad/i.test(message)) {
    // `ttlMs: null` = imutável por tempo: 404/"não existe" é um fato do provider, não uma
    // condição transitória. Ver HARD_STATES para o defeito medido que motivou isto.
    return { state: 'RETIRED', reason: err?.message || 'modelo não existe/descontinuado', ttlMs: null };
  }
  if (status === 401 || /invalid api key|unauthorized/i.test(message)) {
    return { state: 'AUTH_DENIED', reason: err?.message || 'não autorizado' };
  }
  if (status === 402 || /insufficient balance|insufficient.?credit|insufficient_quota|sem saldo/i.test(message)) {
    // Achado real (PILOT REAL, provider de verdade): sem saldo é praticamente permanente até
    // alguém recarregar a conta — TTL igual ao de RETIRED/AUTH_DENIED (DEFAULT_TTL_MS), nunca o
    // TTL curto de uma falha transitória de rede.
    return { state: 'NO_CREDIT', reason: err?.message || 'sem saldo/crédito', ttlMs: DEFAULT_TTL_MS };
  }
  // HUMAN_EXTERNAL_BOOTSTRAP (2026-10-07): falta de crédito reportada como 429.
  // Medido em runtime: a OpenAI devolve 429 com "You have no credits remaining" — texto que NÃO
  // casava com `insufficient_credit`, então caía em RATE_LIMITED (TTL de 5 min) e o modelo voltava
  // a ser escolhido minutos depois, gastando outra tentativa da mesma cadeia. Sem crédito é uma
  // condição praticamente permanente (como 402): TTL longo, igual a NO_CREDIT.
  if (/no credits? remaining|credit_balance_exhausted|out of credits|quota exceeded/i.test(message)) {
    return { state: 'NO_CREDIT', reason: err?.message || 'sem crédito', ttlMs: DEFAULT_TTL_MS };
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
  HARD_STATES,
  isHardState,
  markUnavailable,
  markAvailable,
  getAvailability,
  isUsable,
  classifyModelFailure,
  _clearAllForTests,
};
