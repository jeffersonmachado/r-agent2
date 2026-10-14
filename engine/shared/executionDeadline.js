'use strict';

/**
 * engine/shared/executionDeadline.js — EXECUTION DEADLINE MANAGER (núcleo puro).
 *
 * Centraliza POLÍTICA e SEMÂNTICA de deadline — não a implementação de cada
 * timer. É o ponto único que responde:
 *
 *   1. qual é a política desta operação? (registry `config/timeout-policy.json`)
 *   2. qual o deadline efetivo, respeitando o ORÇAMENTO RESTANTE do pai?
 *   3. o que fazer quando expira? (cancelar a OPERAÇÃO, nunca matar a missão)
 *   4. qual a classe do erro e ele é retentável?
 *
 * Por que existe (missão de hardening 2026-09-26): timeouts estavam espalhados
 * como magic numbers, e uma operação podia expirar derrubando níveis superiores
 * (`PROVIDER_REQUEST_TIMEOUT` ⇒ kill mission). Aqui a expiração é sempre LOCAL à
 * operação: o chamador recebe `{ expired, category, retryable, onExpiry }` e
 * decide retry/fallback/replan — a missão continua.
 *
 * PURO: não lê relógio (recebe `nowMs`), não faz I/O, não cria timer. O
 * AbortSignal é criado pela borda (api/), que passa `signal` para o transporte.
 */

const path = require('path');
// Portas injetáveis (mesma política do clock): a leitura do registry de política e
// o jitter aleatório entram pela borda, então esta unidade não faz I/O direto nem
// depende do ambiente — o comentário de PUREZA acima passa a valer de fato.
const fsPort = require('./fileSystem');
const rng = require('./random');

/**
 * Categorias de expiração/falha. `TIMEOUT` genérico é PROIBIDO: a missão exige
 * categoria conhecida sempre que ela puder ser determinada.
 */
const EXPIRY_CATEGORIES = Object.freeze({
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  DB_TIMEOUT: 'DB_TIMEOUT',
  DB_CONNECTION: 'DB_CONNECTION',
  DB_DEADLOCK: 'DB_DEADLOCK',
  COMMAND_TIMEOUT: 'COMMAND_TIMEOUT',
  HTTP_TIMEOUT: 'HTTP_TIMEOUT',
  LEASE_EXPIRED: 'LEASE_EXPIRED',
  NO_PROGRESS: 'NO_PROGRESS',
  USER_DEADLINE_EXCEEDED: 'USER_DEADLINE_EXCEEDED',
  MISSION_BUDGET_EXCEEDED: 'MISSION_BUDGET_EXCEEDED',
  PROVIDER_EXHAUSTED: 'PROVIDER_EXHAUSTED',
  BLOCKED_EXTERNAL_DEPENDENCY: 'BLOCKED_EXTERNAL_DEPENDENCY',
  UNKNOWN: 'UNKNOWN',
});

/** Ação no disparo: sempre LOCAL à operação, nunca "matar missão". */
const EXPIRY_ON_ACTION = Object.freeze({
  PROVIDER_TIMEOUT: 'RETRY_THEN_FALLBACK',
  DB_TIMEOUT: 'CANCEL_OPERATION_THEN_BLOCKED_INFRA',
  DB_CONNECTION: 'BLOCKED_INFRA',
  DB_DEADLOCK: 'RETRY_OPERATION',
  COMMAND_TIMEOUT: 'TERMINATE_CHILD_THEN_REPLAN',
  HTTP_TIMEOUT: 'CANCEL_REQUEST',
  LEASE_EXPIRED: 'RECOVER',
  NO_PROGRESS: 'DIAGNOSE',
  USER_DEADLINE_EXCEEDED: 'STOP_MISSION',
  MISSION_BUDGET_EXCEEDED: 'STOP_MISSION',
  PROVIDER_EXHAUSTED: 'REPLAN_OR_BLOCKED',
  BLOCKED_EXTERNAL_DEPENDENCY: 'ESCALATE',
  UNKNOWN: 'INSPECT',
});

/** Classes NÃO retentáveis: retry cego nelas é errado (auth/input/política). */
const NON_RETRYABLE_RE = /AUTH|INVALID_INPUT|POLICY_VIOLATION|CONTEXT_LENGTH|FORBIDDEN|NOT_FOUND/i;

/** Instância do registry carregado do disco (uma vez). */
let registryCache = null;

function loadPolicyRegistry(policyPath) {
  if (registryCache && !policyPath) return registryCache;
  const target = policyPath || path.join(__dirname, '..', '..', 'config', 'timeout-policy.json');
  try {
    const parsed = JSON.parse(fsPort.readFileSync(target, 'utf8'));
    if (!policyPath) registryCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Resolve a política de uma operação. `envValue` (já lido pela borda) e
 * `override` têm precedência, sempre CLAMPADOS em [min,max] — configuração
 * absurda (ex.: deadline de task menor que o orçamento de retry do provider) é
 * incoerência que o validador de hierarquia aponta.
 */
function resolveTimeoutPolicy(name, { registry = null, envValue = null, override = null } = {}) {
  const reg = registry || loadPolicyRegistry();
  const entry = reg?.policies?.[name];
  if (!entry) {
    return {
      name,
      resolved: null,
      category: EXPIRY_CATEGORIES.UNKNOWN,
      source: 'unresolved',
      onExpiry: EXPIRY_ON_ACTION.UNKNOWN,
      retryable: false,
      retry: null,
      fallback: null,
      clamp: null,
    };
  }
  const min = Number.isFinite(entry.min) ? entry.min : null;
  const max = Number.isFinite(entry.max) ? entry.max : null;
  const requested = Number.isFinite(override) ? override : (Number.isFinite(envValue) ? envValue : entry.default);
  let resolved = requested;
  let clamp = null;
  if (min !== null && resolved < min) { clamp = { requested, applied: min, reason: 'below_min' }; resolved = min; }
  if (max !== null && resolved > max) { clamp = { requested, applied: max, reason: 'above_max' }; resolved = max; }

  return {
    name,
    resolved,
    default: entry.default,
    min,
    max,
    unit: entry.unit || 'ms',
    category: entry.category === 'PROVIDER_TIMEOUT' ? EXPIRY_CATEGORIES.PROVIDER_TIMEOUT
      : entry.category === 'COMMAND_DEADLINE' ? EXPIRY_CATEGORIES.COMMAND_TIMEOUT
        : entry.category === 'DATABASE_TIMEOUT' ? EXPIRY_CATEGORIES.DB_TIMEOUT
          : entry.category === 'REQUEST_TIMEOUT' ? EXPIRY_CATEGORIES.HTTP_TIMEOUT
            : entry.category,
    source: Number.isFinite(override) ? 'override' : (Number.isFinite(envValue) ? 'env' : 'registry_default'),
    onExpiry: entry.onExpiry || EXPIRY_ON_ACTION[entry.category] || 'INSPECT',
    onExpiryDetail: entry.onExpiryDetail || null,
    retryable: entry.retryable === true,
    retry: entry.retry || null,
    fallback: entry.fallback || null,
    scope: entry.scope || null,
    clamp,
  };
}

/**
 * Deadline efetivo respeitando o orçamento do PAI (propagação de `remainingBudget`).
 * Uma operação filha NUNCA pode ter deadline maior que o orçamento restante do
 * pai — senão o filho sobreviveria ao pai e o resultado seria descartado.
 */
function computeEffectiveDeadline({ nowMs, policyMs, parentDeadlineAtMs = null, minUsefulMs = 1000 } = {}) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(policyMs)) {
    return { deadlineAtMs: null, budgetMs: null, clampedByParent: false, usable: false, reason: 'invalid_input' };
  }
  const byPolicy = nowMs + policyMs;
  if (parentDeadlineAtMs === null || !Number.isFinite(parentDeadlineAtMs)) {
    return { deadlineAtMs: byPolicy, budgetMs: policyMs, clampedByParent: false, usable: true, reason: 'policy_only' };
  }
  const remaining = parentDeadlineAtMs - nowMs;
  if (remaining <= 0) {
    return { deadlineAtMs: parentDeadlineAtMs, budgetMs: 0, clampedByParent: true, usable: false, reason: 'parent_budget_exhausted' };
  }
  if (remaining < minUsefulMs) {
    return { deadlineAtMs: parentDeadlineAtMs, budgetMs: remaining, clampedByParent: true, usable: false, reason: 'parent_budget_below_min_useful' };
  }
  const clamped = Math.min(byPolicy, parentDeadlineAtMs);
  return {
    deadlineAtMs: clamped,
    budgetMs: clamped - nowMs,
    clampedByParent: clamped < byPolicy,
    usable: true,
    reason: clamped < byPolicy ? 'clamped_by_parent_budget' : 'policy_only',
  };
}

/**
 * Registro de expiração com TODOS os campos exigidos pela missão — evita
 * `error = TIMEOUT` sem contexto.
 */
function buildExpiryRecord({
  missionId = null, taskId = null, phase = null, operation = null,
  provider = null, model = null, startedAtMs, deadlineAtMs, nowMs,
  lastHeartbeatAtMs = null, lastProgressAtMs = null, retryCount = 0,
  previousErrors = [], leaseOwner = null, fence = null, diagnostics = null,
  category = EXPIRY_CATEGORIES.UNKNOWN,
} = {}) {
  return {
    missionId,
    taskId,
    phase,
    operation,
    provider,
    model,
    category,
    startedAt: startedAtMs !== undefined && startedAtMs !== null ? new Date(startedAtMs).toISOString() : null,
    deadlineAt: deadlineAtMs !== undefined && deadlineAtMs !== null ? new Date(deadlineAtMs).toISOString() : null,
    elapsedMs: Number.isFinite(startedAtMs) && Number.isFinite(nowMs) ? nowMs - startedAtMs : null,
    lastHeartbeatAt: lastHeartbeatAtMs !== null ? new Date(lastHeartbeatAtMs).toISOString() : null,
    lastProgressAt: lastProgressAtMs !== null ? new Date(lastProgressAtMs).toISOString() : null,
    retryCount,
    previousErrors: previousErrors.slice(0, 5),
    leaseOwner,
    fence,
    diagnostics,
    onExpiry: EXPIRY_ON_ACTION[category] || 'INSPECT',
    // A expiração é SEMPRE local à operação: nenhuma categoria de operação
    // autoriza matar a missão. Só deadline de USUÁRIO/budget encerra a missão —
    // e ainda assim de forma controlada, não por timeout de transporte.
    killsMission: category === EXPIRY_CATEGORIES.USER_DEADLINE_EXCEEDED
      || category === EXPIRY_CATEGORIES.MISSION_BUDGET_EXCEEDED,
    killsWorker: false,
  };
}

/**
 * Classifica um erro de operação por categoria CONHECIDA sempre que possível.
 * Nunca devolve genérico quando a categoria é determinável.
 */
function classifyOperationError(err, { operation = null } = {}) {
  const code = String(err?.code || err?.name || '');
  const message = String(err?.message || '');
  const hay = `${code} ${message}`;

  // --- banco ---------------------------------------------------------------
  if (/SequelizeConnectionAcquireTimeout|DB_POOL_ACQUIRE|connection acquire/i.test(hay)) {
    return { category: EXPIRY_CATEGORIES.DB_CONNECTION, retryable: true, operation };
  }
  if (/SequelizeConnection|ECONNREFUSED|ENOTFOUND|db_unavailable|connection terminated/i.test(hay)) {
    return { category: EXPIRY_CATEGORIES.DB_CONNECTION, retryable: true, operation };
  }
  if (/SequelizeTimeoutError|statement timeout|query timeout|DB_QUERY_TIMEOUT/i.test(hay)) {
    return { category: EXPIRY_CATEGORIES.DB_TIMEOUT, retryable: true, operation };
  }
  if (/deadlock detected|SequelizeDeadlockError|40P01/i.test(hay)) {
    return { category: EXPIRY_CATEGORIES.DB_DEADLOCK, retryable: true, operation };
  }
  // --- provider ------------------------------------------------------------
  if (/ai_timeout|provider.*timeout|ETIMEDOUT.*provider|PROVIDER_TIMEOUT/i.test(hay)) {
    return { category: EXPIRY_CATEGORIES.PROVIDER_TIMEOUT, retryable: true, operation };
  }
  if (/AI_PROVIDER_NOT_CONFIGURED|PROVIDER_EXHAUSTED/i.test(hay)) {
    return { category: EXPIRY_CATEGORIES.PROVIDER_EXHAUSTED, retryable: false, operation };
  }
  // --- comando / child -----------------------------------------------------
  if (/COMMAND_TIMEOUT|command.*deadline|child.*timeout/i.test(hay)) {
    return { category: EXPIRY_CATEGORIES.COMMAND_TIMEOUT, retryable: false, operation };
  }
  // --- transporte ----------------------------------------------------------
  if (err?.name === 'AbortError' || /AbortError|aborted/i.test(hay)) {
    return { category: EXPIRY_CATEGORIES.HTTP_TIMEOUT, retryable: true, operation };
  }
  if (/UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|fetch failed/i.test(hay)) {
    return { category: EXPIRY_CATEGORIES.HTTP_TIMEOUT, retryable: true, operation };
  }
  // --- liveness / progresso -----------------------------------------------
  if (/MISSION_LEASE_EXPIRED|LEASE_EXPIRED|TASK_LEASE_EXPIRED/i.test(hay)) {
    return { category: EXPIRY_CATEGORIES.LEASE_EXPIRED, retryable: false, operation };
  }
  if (/NO_PROGRESS/i.test(hay)) {
    return { category: EXPIRY_CATEGORIES.NO_PROGRESS, retryable: false, operation };
  }
  // --- não retentável por natureza -----------------------------------------
  if (NON_RETRYABLE_RE.test(hay)) {
    return { category: EXPIRY_CATEGORIES.UNKNOWN, retryable: false, operation, nonRetryableReason: 'classificação determinou não-retentável' };
  }
  return { category: EXPIRY_CATEGORIES.UNKNOWN, retryable: false, operation };
}

/** Backoff exponencial com jitter e teto (anti retry-storm). */
function computeBackoffMs({ attempt = 1, baseMs = 1000, multiplier = 2, maxMs = 60000, jitterRatio = 0.2, random = null } = {}) {
  const exp = Math.min(baseMs * (multiplier ** Math.max(0, attempt - 1)), maxMs);
  const rnd = typeof random === 'function' ? random() : rng.random();
  const jitter = exp * jitterRatio * (rnd * 2 - 1);
  return Math.max(0, Math.round(exp + jitter));
}

/**
 * Sequência de encerramento de um CHILD — nunca SIGKILL direto.
 * `requestCancel → SIGTERM → grace period → SIGKILL`.
 */
function buildChildTerminationPlan({ gracePeriodMs = 10000 } = {}) {
  return [
    { step: 1, action: 'request_cancel', signal: null, detail: 'cancelamento cooperativo (AbortSignal/IPC)' },
    { step: 2, action: 'sigterm', signal: 'SIGTERM', detail: 'pedido de encerramento gracioso' },
    { step: 3, action: 'wait_grace', signal: null, waitMs: gracePeriodMs, detail: 'janela para o child sair sozinho' },
    { step: 4, action: 'sigkill', signal: 'SIGKILL', detail: 'somente se o child não respondeu' },
  ];
}

/**
 * Coerência da HIERARQUIA de orçamentos (Mission → Task → Phase → Operation).
 *
 * Configuração impossível é NO_GO de configuração, não algo a descobrir em runtime: se o orçamento
 * da task é 60s e a cadeia de retry do provider pode consumir 5min, a task SEMPRE estoura antes de o
 * fallback terminar — o timeout de operação passaria a decidir a morte da task, que é o defeito que
 * esta arquitetura existe para impedir.
 *
 * `budgets` (todos opcionais, em ms): { missionBudgetMs, taskBudgetMs, phaseBudgetMs }.
 * Sem orçamento declarado em um nível, aquele nível não impõe teto (missão sem wall-clock é o
 * default correto). Retorna `{ ok, violations[] }` — nunca lança.
 */
function validatePolicyHierarchy(registry = null, { missionBudgetMs = null, taskBudgetMs = null, phaseBudgetMs = null } = {}) {
  const reg = registry || loadPolicyRegistry();
  const violations = [];
  const p = (name) => reg?.policies?.[name] || null;
  const lease = p('LEASE');
  const heartbeat = p('HEARTBEAT');
  const provider = p('PROVIDER_REQUEST');
  const fallback = p('PROVIDER_FALLBACK');
  const noProgress = p('NO_PROGRESS');

  if (!reg || !reg.policies) {
    return { ok: false, violations: [{ code: 'TIMEOUT_REGISTRY_UNAVAILABLE', detail: 'config/timeout-policy.json ausente ou ilegível' }] };
  }
  if (lease && heartbeat && !(heartbeat.default < lease.default / 2)) {
    violations.push({ code: 'HEARTBEAT_NOT_BELOW_HALF_LEASE', detail: `heartbeat ${heartbeat.default}ms deve ser < lease/2 (${lease.default / 2}ms)` });
  }
  const providerChainMs = provider
    ? provider.default * Math.max(1, Number(provider.retry?.maxAttempts || 1))
    : null;
  const providerBudgetMs = fallback?.guards?.maxProviderElapsedMs ?? fallback?.default ?? providerChainMs;
  const check = (levelName, budget) => {
    if (!Number.isFinite(budget)) return;
    if (Number.isFinite(providerBudgetMs) && providerBudgetMs > budget) {
      violations.push({ code: 'PROVIDER_BUDGET_EXCEEDS_PARENT', level: levelName, detail: `orçamento de provider/fallback ${providerBudgetMs}ms > orçamento de ${levelName} ${budget}ms` });
    }
    if (provider && provider.default > budget) {
      violations.push({ code: 'OPERATION_DEADLINE_EXCEEDS_PARENT', level: levelName, detail: `PROVIDER_REQUEST ${provider.default}ms > orçamento de ${levelName} ${budget}ms` });
    }
  };
  check('MISSION', missionBudgetMs);
  check('TASK', taskBudgetMs);
  check('PHASE', phaseBudgetMs);
  if (Number.isFinite(missionBudgetMs) && Number.isFinite(taskBudgetMs) && taskBudgetMs > missionBudgetMs) {
    violations.push({ code: 'TASK_BUDGET_EXCEEDS_MISSION', detail: `task ${taskBudgetMs}ms > missão ${missionBudgetMs}ms` });
  }
  if (Number.isFinite(taskBudgetMs) && Number.isFinite(phaseBudgetMs) && phaseBudgetMs > taskBudgetMs) {
    violations.push({ code: 'PHASE_BUDGET_EXCEEDS_TASK', detail: `fase ${phaseBudgetMs}ms > task ${taskBudgetMs}ms` });
  }
  // Toda política de comando/teste que roda no Engineering Runner precisa caber no teto do runner:
  // senão o contrato é recusado lá e a expiração aparece como INFRA_ERROR falso.
  const runnerMax = p('RUNNER_MAX_COMMAND');
  if (runnerMax) {
    for (const name of ['INTEGRATION_TEST', 'REGRESSION_COMMAND', 'UNIT_TEST']) {
      const pol = p(name);
      if (pol && pol.default > runnerMax.default) {
        violations.push({ code: 'COMMAND_DEADLINE_EXCEEDS_RUNNER_MAX', policy: name, detail: `${name} ${pol.default}ms > RUNNER_MAX_COMMAND ${runnerMax.default}ms` });
      }
    }
  }
  // NO_PROGRESS de uma fase precisa comportar a maior operação daquela fase — senão uma única
  // chamada legítima (provider lento, comando longo) seria diagnosticada como travamento.
  if (noProgress?.perPhase && provider) {
    for (const [phase, ms] of Object.entries(noProgress.perPhase)) {
      if (ms < provider.default) {
        violations.push({ code: 'NO_PROGRESS_BELOW_OPERATION_DEADLINE', phase, detail: `NO_PROGRESS[${phase}] ${ms}ms < PROVIDER_REQUEST ${provider.default}ms` });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

module.exports = {
  EXPIRY_CATEGORIES,
  EXPIRY_ON_ACTION,
  loadPolicyRegistry,
  resolveTimeoutPolicy,
  validatePolicyHierarchy,
  computeEffectiveDeadline,
  buildExpiryRecord,
  classifyOperationError,
  computeBackoffMs,
  buildChildTerminationPlan,
};
