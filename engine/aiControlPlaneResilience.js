'use strict';


const clock = require('./shared/clock');
/**
 * AI Control Plane Resilience — núcleo determinístico de resiliência.
 *
 * Objetivo (ADENDO OBRIGATÓRIO — RESILIÊNCIA / FAIL-SAFE / DEGRADED MODE / DR):
 *
 *   SAFE CONTINUATION WHEN POSSIBLE
 *   + SAFE DEGRADATION WHEN NECESSARY
 *   + FAIL CLOSED WHEN REQUIRED
 *   + AUDITABLE RECOVERY
 *
 * Uma falha do control plane NÃO pode provocar:
 *   ALLOW ALL · USE WHATEVER MODEL RESPONDS · IGNORE POLICY
 *   ASSUME OLD PRICE IS CURRENT · DECLARE GO WITHOUT AUDIT
 *
 * Este módulo é puro e determinístico: não faz I/O, não importa SDKs, DB,
 * cache ou rede. O tempo é injetável (`now`) e todo estado é passado pelo
 * chamador. O estado de runtime (singleton) fica em
 * `api/services/aiControlPlaneStatus.js`.
 */

// ---------------------------------------------------------------------------
// Classificações e estados
// ---------------------------------------------------------------------------

const COMPONENT_CRITICALITY = Object.freeze({
  SAFETY_CRITICAL: 'SAFETY_CRITICAL',
  ROUTING_CRITICAL: 'ROUTING_CRITICAL',
  ECONOMIC_CRITICAL: 'ECONOMIC_CRITICAL',
  OBSERVABILITY_CRITICAL: 'OBSERVABILITY_CRITICAL',
  OPTIONAL: 'OPTIONAL',
});

const COMPONENT_STATUS = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  RECOVERING: 'RECOVERING',
  BLOCKED: 'BLOCKED',
  UNKNOWN: 'UNKNOWN',
});

const CONTROL_PLANE_STATUS = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  SAFE_MODE: 'SAFE_MODE',
  RECOVERING: 'RECOVERING',
  BLOCKED: 'BLOCKED',
  UNKNOWN: 'UNKNOWN',
});

const SNAPSHOT_STALENESS = Object.freeze({
  FRESH: 'FRESH',
  STALE_ACCEPTABLE: 'STALE_ACCEPTABLE',
  STALE_UNSAFE: 'STALE_UNSAFE',
  UNKNOWN: 'UNKNOWN',
});

const BREAKER_STATE = Object.freeze({
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half-open',
});

// Prioridade de eventos do buffer (menor = mais prioritário). Itens 17-19.
const EVENT_PRIORITY = Object.freeze({
  POLICY_VIOLATION: 0,
  MODEL_ACCESS_FAILURE: 1,
  MODEL_ATTRIBUTION: 2,
  ROUTING_DECISION: 3,
  BUDGET_EVENT: 4,
  CRITICAL_AUDIT: 5,
  TELEMETRY: 6,
});

// Categorias de falha de provider (itens 37-38, 46-47).
const PROVIDER_ERROR_CATEGORY = Object.freeze({
  AUTH: 'AUTH', // credencial inválida — NUNCA retry
  POLICY_DENIAL: 'POLICY_DENIAL', // negado por policy — NUNCA retry
  RETIRED_MODEL: 'RETIRED_MODEL', // modelo aposentado — NUNCA retry
  BUDGET_BLOCK: 'BUDGET_BLOCK', // hard budget bloqueado — NUNCA retry
  RATE_LIMIT: 'RATE_LIMIT', // 429 — retry com backoff
  TIMEOUT: 'TIMEOUT', // timeout — retry com backoff
  TRANSIENT: 'TRANSIENT', // 5xx/408/rede — retry com backoff
  UNKNOWN: 'UNKNOWN', // não classificado — conservador: NÃO retry por padrão
});

// ---------------------------------------------------------------------------
// Circuit breaker (itens 38-43)
// ---------------------------------------------------------------------------

/**
 * Cria um circuit breaker com estado CLOSED → OPEN → HALF-OPEN → CLOSED e
 * probation de recuperação (só volta a CLOSED após N probes com sucesso).
 *
 * @param {object} [options]
 * @param {number} [options.failureThreshold=3] falhas consecutivas p/ abrir
 * @param {number} [options.resetMs=30000] janela até permitir probe (half-open)
 * @param {number} [options.recoveryProbeSuccessThreshold=2] probes OK p/ fechar
 * @param {() => number} [options.now] fonte de tempo injetável
 * @returns {object} { isOpen, acquire, recordSuccess, recordFailure, getState }
 */
function createCircuitBreaker(options = {}) {
  const failureThreshold = Number.isFinite(options.failureThreshold) && options.failureThreshold > 0
    ? options.failureThreshold : 3;
  const resetMs = Number.isFinite(options.resetMs) && options.resetMs > 0
    ? options.resetMs : 30000;
  const recoveryProbeSuccessThreshold = Number.isFinite(options.recoveryProbeSuccessThreshold) && options.recoveryProbeSuccessThreshold > 0
    ? options.recoveryProbeSuccessThreshold : 2;
  const now = typeof options.now === 'function' ? options.now : () => clock.nowMs();

  const state = {
    state: BREAKER_STATE.CLOSED,
    consecutiveFailures: 0,
    openedAt: 0,
    halfOpenInFlight: false,
    recoverySuccesses: 0,
    lastTransitionAt: 0,
  };

  function isOpen() {
    if (state.state !== BREAKER_STATE.OPEN) return false;
    return (now() - state.openedAt) < resetMs;
  }

  /**
   * Tenta adquirir o direito de executar uma chamada.
   * Em OPEN dentro da janela de reset retorna false (chamada deve ser
   * bloqueada com erro fail-closed, sem ir à rede).
   * Após o reset, o primeiro acquire move para HALF-OPEN (probe único).
   *
   * @returns {boolean}
   */
  function acquire() {
    if (state.state !== BREAKER_STATE.OPEN) return true;
    const elapsed = now() - state.openedAt;
    if (elapsed >= resetMs && !state.halfOpenInFlight) {
      state.state = BREAKER_STATE.HALF_OPEN;
      state.halfOpenInFlight = true;
      return true;
    }
    return false;
  }

  function recordSuccess() {
    if (state.state === BREAKER_STATE.HALF_OPEN) {
      state.recoverySuccesses += 1;
      if (state.recoverySuccesses >= recoveryProbeSuccessThreshold) {
        state.state = BREAKER_STATE.CLOSED;
        state.consecutiveFailures = 0;
        state.halfOpenInFlight = false;
        state.recoverySuccesses = 0;
        state.lastTransitionAt = now();
      } else {
        // Probation: mantém half-open, liberando uma próxima probe por vez.
        state.halfOpenInFlight = false;
      }
      return;
    }
    state.consecutiveFailures = 0;
    state.recoverySuccesses = 0;
  }

  function recordFailure() {
    if (state.state === BREAKER_STATE.HALF_OPEN) {
      state.state = BREAKER_STATE.OPEN;
      state.openedAt = now();
      state.halfOpenInFlight = false;
      state.recoverySuccesses = 0;
      state.lastTransitionAt = now();
      return;
    }
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= failureThreshold) {
      state.state = BREAKER_STATE.OPEN;
      state.openedAt = now();
      state.lastTransitionAt = now();
    }
  }

  function getState() {
    return {
      state: state.state,
      consecutiveFailures: state.consecutiveFailures,
      openedAt: state.openedAt,
      recoverySuccesses: state.recoverySuccesses,
      lastTransitionAt: state.lastTransitionAt,
    };
  }

  return { isOpen, acquire, recordSuccess, recordFailure, getState };
}

// ---------------------------------------------------------------------------
// Classificação de erro de provider (itens 37, 46-47)
// ---------------------------------------------------------------------------

const _RETRYABLE_MESSAGES = [
  /timed?\s*out/i,
  /timeout/i,
  /econnreset/i,
  /econnrefused/i,
  /enetunreach/i,
  /eai_again/i,
  /enotfound/i,
  /network\s*error/i,
  /tls/i,
  /certificate/i,
  /proxy/i,
  /rate\s*limit/i,
  /too\s*many\s*requests/i,
  /overloaded/i,
  /service\s*unavailable/i,
  /internal\s*server\s*error/i,
  /bad\s*gateway/i,
  /gateway\s*timeout/i,
];

const _NON_RETRYABLE_MESSAGES = [
  /invalid\s*(api\s*)?key/i,
  /incorrect\s*api\s*key/i,
  /authentication\s*failed/i,
  /unauthorized/i,
  /forbidden/i,
  /permission/i,
  /policy\s*den/i,
  /not\s*allowed/i,
  /prohibited/i,
  /retired/i,
  /deprecated/i,
  /deprecated\s*model/i,
  /model\s*is\s*deprecated/i,
  /model\s*not\s*found/i,
  /no\s*such\s*model/i,
  /budget/i,
  /insufficient\s*(quota|funds|balance)/i,
  /quota\s*exceeded/i,
  /billing/i,
];

/**
 * Classifica um erro de provider para decidir se retry é permitido.
 * Retry NUNCA é permitido para: credencial inválida, policy denial,
 * modelo aposentado e hard budget block (itens 37, 45).
 *
 * @param {*} err
 * @returns {{category: string, retryable: boolean}}
 */
function classifyProviderError(err) {
  if (!err) return { category: PROVIDER_ERROR_CATEGORY.UNKNOWN, retryable: false };

  const status = Number(err?.status || err?.statusCode || 0);
  const code = String(err?.code || '').toLowerCase();
  const type = String(err?.type || '').toLowerCase();
  const name = String(err?.name || '').toLowerCase();
  const message = String(err?.message || '');

  // 401/403 → auth/policy — não retry
  if (status === 401) return { category: PROVIDER_ERROR_CATEGORY.AUTH, retryable: false };
  if (status === 403) return { category: PROVIDER_ERROR_CATEGORY.POLICY_DENIAL, retryable: false };
  // 404 de modelo → modelo aposentado/inexistente — não retry
  if (status === 404) return { category: PROVIDER_ERROR_CATEGORY.RETIRED_MODEL, retryable: false };
  // 402/422 de billing → budget — não retry
  if (status === 402) return { category: PROVIDER_ERROR_CATEGORY.BUDGET_BLOCK, retryable: false };
  // 429 → rate limit — retry com backoff
  if (status === 429) return { category: PROVIDER_ERROR_CATEGORY.RATE_LIMIT, retryable: true };
  // 408 → timeout — retry com backoff
  if (status === 408) return { category: PROVIDER_ERROR_CATEGORY.TIMEOUT, retryable: true };
  // 5xx → transitório — retry com backoff
  if (status >= 500 && status < 600) return { category: PROVIDER_ERROR_CATEGORY.TRANSIENT, retryable: true };

  // Codes explícitos
  if (code === 'ai_timeout') return { category: PROVIDER_ERROR_CATEGORY.TIMEOUT, retryable: true };
  if (code === 'ai_provider_not_configured') {
    return { category: PROVIDER_ERROR_CATEGORY.UNKNOWN, retryable: false };
  }
  if (code === 'budget_blocked' || code === 'hard_budget_blocked') {
    return { category: PROVIDER_ERROR_CATEGORY.BUDGET_BLOCK, retryable: false };
  }
  if (code === 'policy_denied' || code === 'model_prohibited') {
    return { category: PROVIDER_ERROR_CATEGORY.POLICY_DENIAL, retryable: false };
  }
  if (code === 'retired_model' || code === 'model_not_found') {
    return { category: PROVIDER_ERROR_CATEGORY.RETIRED_MODEL, retryable: false };
  }

  // Heurística por nome do erro (network/timeout)
  if (name.includes('timeout') || name.includes('abort')) {
    return { category: PROVIDER_ERROR_CATEGORY.TIMEOUT, retryable: true };
  }

  // Heurística por mensagem — não-retry tem precedência sobre retry.
  if (_NON_RETRYABLE_MESSAGES.some((re) => re.test(message))) {
    if (/budget|quota|billing|insufficient/i.test(message)) {
      return { category: PROVIDER_ERROR_CATEGORY.BUDGET_BLOCK, retryable: false };
    }
    if (/retired|deprecated|no\s*such\s*model|model\s*not\s*found/i.test(message)) {
      return { category: PROVIDER_ERROR_CATEGORY.RETIRED_MODEL, retryable: false };
    }
    if (/policy|prohibited|not\s*allowed/i.test(message)) {
      return { category: PROVIDER_ERROR_CATEGORY.POLICY_DENIAL, retryable: false };
    }
    return { category: PROVIDER_ERROR_CATEGORY.AUTH, retryable: false };
  }
  if (_RETRYABLE_MESSAGES.some((re) => re.test(message))) {
    if (type.includes('rate_limit') || /rate\s*limit|too\s*many/i.test(message)) {
      return { category: PROVIDER_ERROR_CATEGORY.RATE_LIMIT, retryable: true };
    }
    if (/timeout|timed\s*out/i.test(message)) {
      return { category: PROVIDER_ERROR_CATEGORY.TIMEOUT, retryable: true };
    }
    return { category: PROVIDER_ERROR_CATEGORY.TRANSIENT, retryable: true };
  }

  return { category: PROVIDER_ERROR_CATEGORY.UNKNOWN, retryable: false };
}

// ---------------------------------------------------------------------------
// Buffer de eventos limitado e priorizado (itens 17-19)
// ---------------------------------------------------------------------------

/**
 * Cria um buffer de eventos limitado (nunca unbounded) com prioridade.
 * Eventos de baixa prioridade são descartados antes de críticos.
 *
 * @param {object} [options]
 * @param {number} [options.maxEntries=1000]
 * @returns {object}
 */
function createBoundedEventBuffer(options = {}) {
  const maxEntries = Number.isFinite(options.maxEntries) && options.maxEntries > 0
    ? options.maxEntries : 1000;

  const state = {
    events: [], // { seq, priority, event }
    seq: 0,
    droppedLowPriority: 0,
    droppedCritical: 0,
  };

  function _insertSorted(entry) {
    // ordena por prioridade (menor primeiro), desempate por sequência.
    let i = state.events.length;
    while (i > 0) {
      const prev = state.events[i - 1];
      if (prev.priority < entry.priority) break;
      if (prev.priority === entry.priority && prev.seq < entry.seq) break;
      i -= 1;
    }
    state.events.splice(i, 0, entry);
  }

  /**
   * Adiciona um evento. Se o buffer estiver cheio, descarta o evento de
   * MENOR prioridade já presente (ou o novo, se ele for o de menor
   * prioridade). Descartar evento crítico incrementa `droppedCritical`.
   *
   * @param {*} event
   * @param {number} [priority]
   * @returns {{accepted: boolean, dropped?: boolean, reason?: string}}
   */
  function push(event, priority = EVENT_PRIORITY.TELEMETRY) {
    const p = Number.isFinite(priority) ? priority : EVENT_PRIORITY.TELEMETRY;
    const entry = { seq: ++state.seq, priority: p, event };

    if (state.events.length < maxEntries) {
      _insertSorted(entry);
      return { accepted: true };
    }

    // Cheio: descarta o de menor prioridade (maior número) do fim.
    const worst = state.events[state.events.length - 1];
    if (worst.priority > p) {
      state.events.pop();
      if (worst.priority <= EVENT_PRIORITY.CRITICAL_AUDIT) {
        state.droppedCritical += 1;
      } else {
        state.droppedLowPriority += 1;
      }
      _insertSorted(entry);
      return { accepted: true, dropped: true, reason: 'buffer_full_evicted_lower_priority' };
    }

    // O novo é de prioridade menor ou igual ao pior: descarta o novo.
    if (p <= EVENT_PRIORITY.CRITICAL_AUDIT) {
      state.droppedCritical += 1;
    } else {
      state.droppedLowPriority += 1;
    }
    return { accepted: false, dropped: true, reason: 'buffer_full_event_rejected' };
  }

  /**
   * Extrai eventos em ordem de prioridade (não destrutivo por padrão).
   *
   * @param {boolean} [clear=true]
   * @returns {Array}
   */
  function drain(clear = true) {
    const out = state.events.map((entry) => entry.event);
    if (clear) state.events = [];
    return out;
  }

  function getState() {
    return {
      size: state.events.length,
      maxEntries,
      droppedLowPriority: state.droppedLowPriority,
      droppedCritical: state.droppedCritical,
    };
  }

  return { push, drain, getState };
}

// ---------------------------------------------------------------------------
// Snapshot integrity + staleness (itens 6-7, 31-33)
// ---------------------------------------------------------------------------

/**
 * Valida a integridade estrutural de um snapshot (model registry, policy,
 * market). Um snapshot sem `version`, `created_at` ou `hash` NÃO é aceito.
 *
 * @param {*} snapshot
 * @param {object} [options]
 * @param {(value: string) => string} [options.hashFn] função de hash p/ revalidar
 * @returns {{valid: boolean, reason?: string}}
 */
function validateSnapshotIntegrity(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { valid: false, reason: 'snapshot_absent' };
  }
  if (!snapshot.version || typeof snapshot.version !== 'string') {
    return { valid: false, reason: 'snapshot_missing_version' };
  }
  if (!snapshot.created_at) {
    return { valid: false, reason: 'snapshot_missing_created_at' };
  }
  if (Number.isNaN(Date.parse(snapshot.created_at))) {
    return { valid: false, reason: 'snapshot_invalid_created_at' };
  }
  if (!snapshot.hash || typeof snapshot.hash !== 'string') {
    return { valid: false, reason: 'snapshot_missing_hash' };
  }
  if (!snapshot.scope || typeof snapshot.scope !== 'string') {
    return { valid: false, reason: 'snapshot_missing_scope' };
  }
  if (!snapshot.source || typeof snapshot.source !== 'string') {
    return { valid: false, reason: 'snapshot_missing_source' };
  }
  if (snapshot.expires_at != null && Number.isNaN(Date.parse(snapshot.expires_at))) {
    return { valid: false, reason: 'snapshot_invalid_expires_at' };
  }

  if (typeof options.hashFn === 'function' && snapshot.payload_hash != null) {
    const computed = String(options.hashFn(snapshot.payload_hash));
    if (computed !== String(snapshot.payload_hash)) {
      return { valid: false, reason: 'snapshot_hash_mismatch' };
    }
  }

  return { valid: true };
}

/**
 * Classifica a staleness de um snapshot em relação a agora.
 *
 * @param {*} snapshot
 * @param {object} [options]
 * @param {number} [options.now=clock.nowMs()]
 * @param {number} [options.freshMaxMs] idade máxima p/ FRESH
 * @param {number} [options.acceptableMaxMs] idade máxima p/ STALE_ACCEPTABLE
 * @returns {string} SNAPSHOT_STALENESS
 */
function classifySnapshotStaleness(snapshot, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : clock.nowMs();
  const freshMaxMs = Number.isFinite(options.freshMaxMs) ? options.freshMaxMs : 5 * 60 * 1000;
  const acceptableMaxMs = Number.isFinite(options.acceptableMaxMs) ? options.acceptableMaxMs : 24 * 60 * 60 * 1000;

  if (!snapshot || !snapshot.created_at) return SNAPSHOT_STALENESS.UNKNOWN;

  const createdAt = Date.parse(snapshot.created_at);
  if (Number.isNaN(createdAt)) return SNAPSHOT_STALENESS.UNKNOWN;

  // Expiração explícita vence sobre janelas de idade.
  if (snapshot.expires_at != null) {
    const expiresAt = Date.parse(snapshot.expires_at);
    if (!Number.isNaN(expiresAt) && now >= expiresAt) return SNAPSHOT_STALENESS.STALE_UNSAFE;
  }

  const age = now - createdAt;
  if (age <= freshMaxMs) return SNAPSHOT_STALENESS.FRESH;
  if (age <= acceptableMaxMs) return SNAPSHOT_STALENESS.STALE_ACCEPTABLE;
  return SNAPSHOT_STALENESS.STALE_UNSAFE;
}

// ---------------------------------------------------------------------------
// Agregação de status do control plane (itens 105-112)
// ---------------------------------------------------------------------------

const _STATUS_PRIORITY = [
  CONTROL_PLANE_STATUS.BLOCKED,
  CONTROL_PLANE_STATUS.SAFE_MODE,
  CONTROL_PLANE_STATUS.DEGRADED,
  CONTROL_PLANE_STATUS.RECOVERING,
  CONTROL_PLANE_STATUS.UNKNOWN,
  CONTROL_PLANE_STATUS.HEALTHY,
];

/**
 * Agrega o status do control plane a partir dos componentes.
 *
 * Regra de prioridade (item 112): BLOCKED safety-critical > SAFE_MODE >
 * DEGRADED > HEALTHY. UNKNOWN é mais grave que HEALTHY (não se declara
 * saudável o que não foi observado), mas mais leve que DEGRADED. Um
 * componente OPTIONAL nunca sozinho derruba além de DEGRADED.
 *
 * @param {Array<{id: string, criticality: string, status: string}>} components
 * @returns {string} CONTROL_PLANE_STATUS
 */
function aggregateControlPlaneStatus(components = []) {
  if (!Array.isArray(components) || components.length === 0) {
    return CONTROL_PLANE_STATUS.UNKNOWN;
  }

  let worst = CONTROL_PLANE_STATUS.HEALTHY;
  for (const c of components) {
    const status = COMPONENT_STATUS[c.status] ? c.status : COMPONENT_STATUS.UNKNOWN;
    const criticality = COMPONENT_CRITICALITY[c.criticality] ? c.criticality : COMPONENT_CRITICALITY.OPTIONAL;

    let effective = status;
    if (status === COMPONENT_STATUS.BLOCKED && criticality === COMPONENT_CRITICALITY.OPTIONAL) {
      effective = COMPONENT_STATUS.DEGRADED;
    }

    const currentIndex = _STATUS_PRIORITY.indexOf(effective);
    const worstIndex = _STATUS_PRIORITY.indexOf(worst);
    if (currentIndex >= 0 && currentIndex < worstIndex) {
      worst = effective;
    }
  }

  return worst;
}

/**
 * Gate de operação crítica (item 124): um componente SAFETY_CRITICAL em
 * BLOCKED ou UNKNOWN impede operação crítica. MARKET_INTELLIGENCE DEGRADED
 * não impede, mas POLICY_ENFORCEMENT UNKNOWN impede.
 *
 * @param {Array<{id: string, criticality: string, status: string}>} components
 * @returns {boolean}
 */
function canRunCriticalOperation(components = []) {
  for (const c of components) {
    const criticality = COMPONENT_CRITICALITY[c.criticality] ? c.criticality : COMPONENT_CRITICALITY.OPTIONAL;
    if (criticality !== COMPONENT_CRITICALITY.SAFETY_CRITICAL) continue;
    const status = COMPONENT_STATUS[c.status] ? c.status : COMPONENT_STATUS.UNKNOWN;
    if (status === COMPONENT_STATUS.BLOCKED || status === COMPONENT_STATUS.UNKNOWN) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Safe mode (itens 53-58)
// ---------------------------------------------------------------------------

const SAFE_MODE_ENTRY_TRIGGERS = Object.freeze([
  'POLICY_ENGINE_INSTABILITY',
  'REGISTRY_CORRUPTION',
  'MAJOR_PROVIDER_OUTAGE',
  'RELEASE_INTEGRITY_FAILURE',
  'DATABASE_INCIDENT',
  'MULTIPLE_CONTROL_PLANE_FAILURES',
]);

/**
 * Decide se o control plane deve entrar em SAFE_MODE a partir de gatilhos.
 *
 * @param {Array<string>} triggers
 * @param {object} [options]
 * @param {boolean} [options.alreadyInSafeMode=false]
 * @returns {boolean}
 */
function evaluateSafeModeEntry(triggers = [], options = {}) {
  if (!Array.isArray(triggers) || triggers.length === 0) return false;
  const known = triggers.filter((t) => SAFE_MODE_ENTRY_TRIGGERS.includes(t));
  if (known.length === 0) return false;
  // "multiple control-plane failures" e "major provider outage" entram direto.
  if (known.includes('MULTIPLE_CONTROL_PLANE_FAILURES')) return true;
  if (known.includes('MAJOR_PROVIDER_OUTAGE')) return true;
  if (known.includes('REGISTRY_CORRUPTION')) return true;
  if (known.includes('RELEASE_INTEGRITY_FAILURE')) return true;
  // Instabilidade isolada de policy/database exige confirmação (>=1 gatilho real).
  return known.length >= 1;
}

/**
 * Decide se o control plane pode SAIR do safe mode. Não basta um componente
 * responder uma vez (item 58): exige health, consistency, policy e release.
 *
 * @param {object} [conditions]
 * @param {boolean} [conditions.healthRestored=false]
 * @param {boolean} [conditions.consistencyCheckPassed=false]
 * @param {boolean} [conditions.policyIntegrity=false]
 * @param {boolean} [conditions.releaseIntegrity=false]
 * @returns {boolean}
 */
function evaluateSafeModeExit(conditions = {}) {
  return !!(conditions
    && conditions.healthRestored
    && conditions.consistencyCheckPassed
    && conditions.policyIntegrity
    && conditions.releaseIntegrity);
}

// ---------------------------------------------------------------------------
// Budget routing (itens 12-14)
// ---------------------------------------------------------------------------

const BUDGET_ROUTING = Object.freeze({
  PROCEED: 'PROCEED',
  BUDGET_COST_UNCERTAIN: 'BUDGET_COST_UNCERTAIN',
  BUDGET_BLOCKED: 'BUDGET_BLOCKED',
});

/**
 * Decide o roteamento de uma ação paga sob hard/soft budget.
 *
 * - Soft budget: continua com `budgetStatus` UNKNOWN/DEGRADED (item 14).
 * - Hard budget + Budget Manager indisponível: FAIL CLOSED (nunca assumir
 *   orçamento infinito — item 13).
 * - Hard budget + custo incerto: não assumir que cabe no budget;
 *   `BUDGET_COST_UNCERTAIN` quando há alternativa conservadora conhecida,
 *   `BUDGET_BLOCKED` caso contrário (item 12).
 *
 * @param {object} [input]
 * @param {boolean} [input.hardBudgetActive]
 * @param {boolean} [input.budgetManagerAvailable]
 * @param {boolean} [input.costCertain]
 * @param {boolean} [input.conservativeAlternativeAvailable]
 * @returns {{decision: string, budgetStatus: string, reason?: string}}
 */
function evaluateBudgetRouting(input = {}) {
  const hard = input.hardBudgetActive === true;
  const managerOk = input.budgetManagerAvailable === true;
  const costCertain = input.costCertain === true;
  const alternative = input.conservativeAlternativeAvailable === true;

  if (!hard) {
    return { decision: BUDGET_ROUTING.PROCEED, budgetStatus: managerOk ? 'HEALTHY' : 'UNKNOWN' };
  }

  if (!managerOk) {
    return {
      decision: BUDGET_ROUTING.BUDGET_BLOCKED,
      budgetStatus: 'DEGRADED',
      reason: 'budget_manager_unavailable_hard_budget',
    };
  }

  if (costCertain) {
    return { decision: BUDGET_ROUTING.PROCEED, budgetStatus: 'HEALTHY' };
  }

  return {
    decision: alternative ? BUDGET_ROUTING.BUDGET_COST_UNCERTAIN : BUDGET_ROUTING.BUDGET_BLOCKED,
    budgetStatus: 'DEGRADED',
    reason: alternative ? 'cost_uncertain_prefer_alternative' : 'cost_uncertain_blocked',
  };
}

// ---------------------------------------------------------------------------
// Active release (itens 22-23)
// ---------------------------------------------------------------------------

const RELEASE_ROUTING = Object.freeze({
  CURRENT_KNOWN_ACTIVE_RELEASE: 'CURRENT_KNOWN_ACTIVE_RELEASE',
  USING_KNOWN_ACTIVE_DEGRADED: 'USING_KNOWN_ACTIVE_DEGRADED',
  UNKNOWN_ACTIVE_RELEASE: 'UNKNOWN_ACTIVE_RELEASE',
});

/**
 * Resolve a release ativa para roteamento. Release Manager indisponível NÃO
 * seleciona automaticamente a LATEST (item 22): usa CURRENT_KNOWN_ACTIVE
 * se validada; sem release ativa determinável → UNKNOWN_ACTIVE_RELEASE
 * (condição crítica que bloqueia missão de risco).
 *
 * @param {object} [input]
 * @param {boolean} [input.releaseManagerAvailable]
 * @param {string|null} [input.knownActiveRelease]
 * @param {string|null} [input.latestRelease]
 * @returns {{releaseId: string|null, status: string}}
 */
function resolveActiveRelease(input = {}) {
  const managerOk = input.releaseManagerAvailable === true;
  const known = typeof input.knownActiveRelease === 'string' && input.knownActiveRelease ? input.knownActiveRelease : null;
  const latest = typeof input.latestRelease === 'string' && input.latestRelease ? input.latestRelease : null;

  if (managerOk && known) {
    return { releaseId: known, status: RELEASE_ROUTING.CURRENT_KNOWN_ACTIVE_RELEASE };
  }
  if (!managerOk && known) {
    return { releaseId: known, status: RELEASE_ROUTING.USING_KNOWN_ACTIVE_DEGRADED };
  }
  return { releaseId: null, status: RELEASE_ROUTING.UNKNOWN_ACTIVE_RELEASE, latestReleaseIgnored: !!latest };
}

// ---------------------------------------------------------------------------
// Policy engine failure (itens 4, 96)
// ---------------------------------------------------------------------------

const POLICY_ROUTING = Object.freeze({
  POLICY_ENFORCED: 'POLICY_ENFORCED',
  CONTINUE_LIMITED: 'CONTINUE_LIMITED', // LAST_KNOWN_GOOD_POLICY_SNAPSHOT seguro
  GOVERNANCE_ROUTING_BLOCKED: 'GOVERNANCE_ROUTING_BLOCKED',
});

/**
 * Decide a continuação quando o Policy Engine está indisponível.
 *
 * NÃO assume ALL ROUTES ALLOWED. Usa LAST_KNOWN_GOOD_POLICY_SNAPSHOT apenas se:
 * - integridade/assinatura do snapshot for válida;
 * - snapshot estiver dentro da freshness permitida;
 * - escopo da tarefa estiver coberto;
 * - política permitir uso offline/degradado.
 * Caso contrário: POLICY_ENGINE_UNAVAILABLE → GOVERNANCE_ROUTING_BLOCKED.
 *
 * @param {object} [input]
 * @param {boolean} [input.policyEngineAvailable]
 * @param {boolean} [input.snapshotValid]
 * @param {boolean} [input.snapshotFresh]
 * @param {boolean} [input.scopeCoversTask]
 * @param {boolean} [input.policyAllowsOffline]
 * @returns {{decision: string, reason?: string}}
 */
function evaluatePolicyContinuation(input = {}) {
  if (input.policyEngineAvailable === true) {
    return { decision: POLICY_ROUTING.POLICY_ENFORCED };
  }

  const safeSnapshot = input.snapshotValid === true
    && input.snapshotFresh === true
    && input.scopeCoversTask === true
    && input.policyAllowsOffline === true;

  if (safeSnapshot) {
    return { decision: POLICY_ROUTING.CONTINUE_LIMITED, reason: 'last_known_good_policy_snapshot' };
  }

  return { decision: POLICY_ROUTING.GOVERNANCE_ROUTING_BLOCKED, reason: 'policy_engine_unavailable_no_valid_snapshot' };
}

// ---------------------------------------------------------------------------
// Recovery idempotente (itens 20-21, 85-86)
// ---------------------------------------------------------------------------

/**
 * Remove duplicatas por chave (proteção contra retry de flush).
 *
 * @param {Array} events
 * @param {(e: any) => string|number} [keyFn]
 * @returns {Array}
 */
function dedupeEventsByKey(events = [], keyFn) {
  const keyOf = typeof keyFn === 'function' ? keyFn : (e) => (e && e.id);
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const key = keyOf(e);
    if (key == null) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * Replay de eventos pendentes de forma idempotente, order-aware e
 * correlacionável: eventos já vistos (por chave) são classificados como
 * duplicatas e não reaplicados — recovery não duplica execução/custo/audit.
 *
 * @param {Array} events
 * @param {object} [options]
 * @param {Set<string|number>} [options.seenKeys]
 * @param {(e: any) => string|number} [options.keyFn]
 * @returns {{toApply: Array, duplicates: Array, seenKeys: Set}}
 */
function replayEventsWithIdempotency(events = [], options = {}) {
  const seen = options.seenKeys instanceof Set ? options.seenKeys : new Set();
  const keyOf = typeof options.keyFn === 'function' ? options.keyFn : (e) => (e && e.id);
  const toApply = [];
  const duplicates = [];
  for (const e of events) {
    const key = keyOf(e);
    if (key == null) {
      // Sem chave não é descartado silenciosamente: aplica (não há como correlacionar).
      toApply.push(e);
      continue;
    }
    if (seen.has(key)) {
      duplicates.push(e);
      continue;
    }
    seen.add(key);
    toApply.push(e);
  }
  return { toApply, duplicates, seenKeys: seen };
}

module.exports = {
  COMPONENT_CRITICALITY,
  COMPONENT_STATUS,
  CONTROL_PLANE_STATUS,
  SNAPSHOT_STALENESS,
  BREAKER_STATE,
  EVENT_PRIORITY,
  PROVIDER_ERROR_CATEGORY,
  SAFE_MODE_ENTRY_TRIGGERS,
  BUDGET_ROUTING,
  RELEASE_ROUTING,
  POLICY_ROUTING,

  createCircuitBreaker,
  classifyProviderError,
  createBoundedEventBuffer,
  validateSnapshotIntegrity,
  classifySnapshotStaleness,
  aggregateControlPlaneStatus,
  canRunCriticalOperation,
  evaluateSafeModeEntry,
  evaluateSafeModeExit,
  evaluateBudgetRouting,
  resolveActiveRelease,
  evaluatePolicyContinuation,
  dedupeEventsByKey,
  replayEventsWithIdempotency,
};
