'use strict';

/**
 * api/utils/operationDeadline.js — BORDA DE RUNTIME do Execution Deadline Manager.
 *
 * `engine/shared/executionDeadline.js` é o núcleo PURO (política, orçamento do pai, classificação,
 * plano de terminação) e documenta que "o AbortSignal é criado pela borda (api/)". Até aqui essa
 * borda não existia: o núcleo só era exercitado por testes e cada serviço tinha o seu magic number
 * (`timeout: 60000`, `DEFAULT_TIMEOUT_MS = 120000`, `setTimeout(() => controller.abort(), ...)`).
 * Este módulo é a única ponte entre o registry (`config/timeout-policy.json`) e os timers reais:
 *
 *   - `resolvePolicy(name)`       → valor efetivo (registry + env declarado, clampado em [min,max]);
 *   - `runWithDeadline(name, fn)` → AbortSignal real + deadline respeitando o orçamento do pai;
 *                                    expiração vira erro CLASSIFICADO (nunca "TIMEOUT" genérico)
 *                                    e é LOCAL à operação — quem chama decide retry/fallback;
 *   - `runChildWithDeadline()`    → subprocesso com terminação graciosa
 *                                    (cancelamento cooperativo → SIGTERM → grace → SIGKILL);
 *   - `withDbDeadline()`          → transação com `statement_timeout` da política DATABASE_QUERY:
 *                                    expirar faz ROLLBACK (estado conhecido) e vira DB_TIMEOUT;
 *   - métricas/telemetria de timeout, NO_PROGRESS, lease e escrita recusada por fence.
 *
 * Não é "outro deadline manager": não decide política nem categoria — delega tudo ao núcleo.
 */

const { spawn } = require('child_process');
const deadlineCore = require('../../engine/shared/executionDeadline');
const logger = require('./logger');

// ── Métricas (§60) ────────────────────────────────────────────────────────────────────────────

const METRIC_NAMES = Object.freeze([
  'timeout.total',
  'timeout.recovered',
  'timeout.fallback',
  'timeout.taskFailure',
  'timeout.missionFailure',
  'lease.expired',
  'lease.takeover',
  'lease.lost',
  'staleWriteRejected',
  'noProgress.total',
  'slow.total',
  'provider.exhausted',
]);

function emptyMetrics() {
  const counters = {};
  for (const name of METRIC_NAMES) counters[name] = 0;
  return { counters, byType: {}, byPhase: {}, byProvider: {} };
}

let metrics = emptyMetrics();
const listeners = new Set();

function incrementMetric(name, amount = 1) {
  metrics.counters[name] = (metrics.counters[name] || 0) + amount;
}

function bump(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function getTimeoutMetrics() {
  return {
    ...metrics.counters,
    'timeout.byType': { ...metrics.byType },
    'timeout.byPhase': { ...metrics.byPhase },
    'timeout.byProvider': { ...metrics.byProvider },
  };
}

function resetTimeoutMetrics() {
  metrics = emptyMetrics();
}

/** Assina eventos de deadline/liveness (usado pela persistência de telemetria e por E2E). */
function onDeadlineEvent(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      logger.warn('[operationDeadline] listener de evento falhou', { message: error.message });
    }
  }
}

/**
 * Registra um evento de TIMEOUT com o registro completo (§59). `record` vem de
 * `buildExpiryRecord` do núcleo, acrescido de `fallback`/`outcome` pelo chamador quando sabidos.
 */
function recordTimeoutEvent(record) {
  incrementMetric('timeout.total');
  bump(metrics.byType, record.category);
  bump(metrics.byPhase, record.phase);
  bump(metrics.byProvider, record.provider);
  emit({ type: 'TIMEOUT', record });
  logger.warn('[deadline] operação expirou', {
    category: record.category,
    operation: record.operation,
    phase: record.phase,
    taskId: record.taskId,
    missionId: record.missionId,
    provider: record.provider,
    elapsedMs: record.elapsedMs,
  });
}

/** Evento de liveness/fencing: NO_PROGRESS, SLOW, LEASE_LOST, LEASE_TAKEOVER, STALE_WRITE_REJECTED. */
function recordLivenessEvent(type, detail = {}) {
  const metricByType = {
    NO_PROGRESS: 'noProgress.total',
    SLOW: 'slow.total',
    LEASE_LOST: 'lease.lost',
    LEASE_EXPIRED: 'lease.expired',
    LEASE_TAKEOVER: 'lease.takeover',
    STALE_WRITE_REJECTED: 'staleWriteRejected',
    PROVIDER_EXHAUSTED: 'provider.exhausted',
    TIMEOUT_RECOVERED: 'timeout.recovered',
    TIMEOUT_FALLBACK: 'timeout.fallback',
    TIMEOUT_TASK_FAILURE: 'timeout.taskFailure',
  };
  if (metricByType[type]) incrementMetric(metricByType[type]);
  emit({ type, detail });
}

// ── Política ──────────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a política pelo NOME do registry. O override de ambiente é o declarado no próprio
 * registry (`envOverride`) — nenhum serviço inventa a sua env var. Política desconhecida é erro
 * explícito: um timer sem política é exatamente o magic number que esta borda substitui.
 */
function resolvePolicy(name, { override = null } = {}) {
  const registry = deadlineCore.loadPolicyRegistry();
  const entry = registry?.policies?.[name];
  const envName = entry?.envOverride || null;
  const rawEnv = envName ? process.env[envName] : undefined;
  const envValue = rawEnv !== undefined && rawEnv !== '' && Number.isFinite(Number(rawEnv)) ? Number(rawEnv) : null;
  const policy = deadlineCore.resolveTimeoutPolicy(name, {
    registry,
    envValue,
    override: Number.isFinite(override) ? override : null,
  });
  if (policy.resolved === null) {
    const error = new Error(`política de timeout desconhecida: ${name}`);
    error.code = 'TIMEOUT_POLICY_UNRESOLVED';
    throw error;
  }
  return policy;
}

function policyMs(name, options) {
  return resolvePolicy(name, options).resolved;
}

// ── Erros classificados ───────────────────────────────────────────────────────────────────────

function buildDeadlineError(policy, record, { cancelled = false } = {}) {
  const category = cancelled ? 'OPERATION_CANCELLED' : record.category;
  const error = new Error(cancelled
    ? `operação ${record.operation || policy.name} cancelada cooperativamente`
    : `${category}: operação ${record.operation || policy.name} excedeu ${policy.resolved}ms (política ${policy.name})`);
  error.code = category;
  error.deadlineCategory = category;
  error.timeoutPolicy = policy.name;
  error.expiry = record;
  error.retryable = !cancelled && policy.retryable === true;
  error.onExpiry = policy.onExpiry;
  error.killsWorker = false;
  return error;
}

function isDeadlineError(error) {
  return Boolean(error && error.deadlineCategory);
}

/**
 * Executa `fn(signal, ctx)` sob o deadline da política `name`.
 *
 *   - o deadline efetivo nunca excede o orçamento restante do pai (`parentDeadlineAtMs`);
 *   - `parentSignal` propaga cancelamento cooperativo (ex.: NO_PROGRESS da task, lease perdido);
 *   - na expiração, o signal é abortado (o transporte cancela a requisição de verdade) e a promise
 *     rejeita com erro de categoria conhecida, mesmo que `fn` ignore o signal;
 *   - NADA aqui mata worker ou missão: o erro sobe para quem decide retry/fallback/replan.
 */
async function runWithDeadline(name, fn, {
  operation = null,
  override = null,
  parentDeadlineAtMs = null,
  parentSignal = null,
  meta = {},
} = {}) {
  const policy = resolvePolicy(name, { override });
  const startedAtMs = Date.now();
  const effective = deadlineCore.computeEffectiveDeadline({ nowMs: startedAtMs, policyMs: policy.resolved, parentDeadlineAtMs });
  const recordBase = {
    ...meta,
    operation: operation || name,
    startedAtMs,
    deadlineAtMs: effective.deadlineAtMs,
    category: policy.category,
  };
  if (!effective.usable) {
    const record = deadlineCore.buildExpiryRecord({ ...recordBase, nowMs: startedAtMs, category: deadlineCore.EXPIRY_CATEGORIES.MISSION_BUDGET_EXCEEDED });
    const error = buildDeadlineError({ ...policy, retryable: false }, { ...record, reason: effective.reason });
    error.code = 'PARENT_BUDGET_EXHAUSTED';
    throw error;
  }

  const controller = new AbortController();
  let expired = false;
  let parentAborted = false;
  const onParentAbort = () => {
    parentAborted = true;
    controller.abort(parentSignal.reason);
  };
  if (parentSignal) {
    if (parentSignal.aborted) onParentAbort();
    else parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  let rejectOnAbort;
  const abortRace = new Promise((_, reject) => { rejectOnAbort = reject; });
  // A promise de corrida nunca fica "unhandled": quem vence o race consome o resultado.
  abortRace.catch(() => {});

  const timer = setTimeout(() => {
    expired = true;
    const record = deadlineCore.buildExpiryRecord({ ...recordBase, nowMs: Date.now() });
    const error = buildDeadlineError(policy, record);
    recordTimeoutEvent(record);
    controller.abort(error);
    rejectOnAbort(error);
  }, effective.budgetMs);
  if (typeof timer.unref === 'function') timer.unref();

  controller.signal.addEventListener('abort', () => {
    if (expired) return;
    const record = deadlineCore.buildExpiryRecord({ ...recordBase, nowMs: Date.now() });
    rejectOnAbort(buildDeadlineError(policy, record, { cancelled: true }));
  }, { once: true });

  try {
    return await Promise.race([
      Promise.resolve().then(() => fn(controller.signal, {
        deadlineAtMs: effective.deadlineAtMs,
        budgetMs: effective.budgetMs,
        policy,
      })),
      abortRace,
    ]);
  } catch (error) {
    if (expired && !isDeadlineError(error)) {
      // O transporte rejeitou com AbortError por causa do NOSSO deadline: a causa real é o timeout.
      const record = deadlineCore.buildExpiryRecord({ ...recordBase, nowMs: Date.now() });
      throw buildDeadlineError(policy, record);
    }
    if (parentAborted && !isDeadlineError(error)) {
      const record = deadlineCore.buildExpiryRecord({ ...recordBase, nowMs: Date.now() });
      throw buildDeadlineError(policy, record, { cancelled: true });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
  }
}

// ── Subprocesso com terminação graciosa (§23, §24, §55) ───────────────────────────────────────

function killGroup(child, signal) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return false;
  try {
    // Grupo de processos: `npm test`/`jest` criam netos; sinalizar só o filho direto deixa órfãos.
    process.kill(-child.pid, signal);
    return true;
  } catch (_) {
    try {
      child.kill(signal);
      return true;
    } catch (__) {
      return false;
    }
  }
}

/**
 * Executa um CHILD sob deadline. Na expiração segue o plano do núcleo
 * (`buildChildTerminationPlan`): cancelamento cooperativo (signal) → SIGTERM → grace → SIGKILL
 * somente se o child não saiu. O processo PAI (Engineer Worker) nunca é sinalizado.
 *
 * @returns {Promise<{exitCode:number|null, signal:string|null, stdout:string, stderr:string,
 *   timedOut:boolean, cancelled:boolean, terminatedBy:('SIGTERM'|'SIGKILL'|null),
 *   terminationSteps:object[], durationMs:number, expiry:object|null}>}
 */
function runChildWithDeadline({
  command,
  args = [],
  cwd,
  env = process.env,
  policy: policyName = 'SHELL_COMMAND',
  gracePolicy = 'REGRESSION_CHILD_TERMINATION_GRACE',
  override = null,
  graceOverride = null,
  parentSignal = null,
  maxBuffer = 5 * 1024 * 1024,
  meta = {},
  onOutput = null,
} = {}) {
  const policy = resolvePolicy(policyName, { override });
  const graceMs = policyMs(gracePolicy, { override: graceOverride });

  // ── BUG CLOSURE FIRST (2026-10-17) ────────────────────────────────────────
  // Choke point de TODO comando filho deste utilitário (regressão, governança,
  // workers). Sem isto, o Router/Mission teria um caminho alternativo para rodar
  // operação extensiva sem passar pela elegibilidade.
  //
  // A recusa é uma PROMISE REJEITADA (e não throw síncrono): o contrato desta
  // função é sempre devolver Promise, e quem usa `.catch()` também precisa ver
  // o bloqueio.
  {
    const { avaliarComando, erroDeBloqueio } = require('../../governance/bug-closure/command-policy');
    const avaliacao = avaliarComando({
      command,
      args,
      actor: (meta && meta.operation) || 'operationDeadline',
    });
    if (!avaliacao.permitido) return Promise.reject(erroDeBloqueio(avaliacao));
  }

  const plan = deadlineCore.buildChildTerminationPlan({ gracePeriodMs: graceMs });
  const startedAtMs = Date.now();

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let terminatedBy = null;
    let graceTimer = null;
    const steps = [];

    const child = spawn(command, args, { cwd, env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });

    const append = (current, chunk) => (current.length >= maxBuffer ? current : current + chunk.toString('utf8'));
    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk);
      if (typeof onOutput === 'function') onOutput('stdout', chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk);
      if (typeof onOutput === 'function') onOutput('stderr', chunk);
    });

    const terminate = (reason) => {
      steps.push({ ...plan[0], at: Date.now() - startedAtMs, reason });
      if (killGroup(child, 'SIGTERM')) {
        terminatedBy = 'SIGTERM';
        steps.push({ ...plan[1], at: Date.now() - startedAtMs });
      }
      steps.push({ ...plan[2], at: Date.now() - startedAtMs });
      graceTimer = setTimeout(() => {
        if (killGroup(child, 'SIGKILL')) {
          terminatedBy = 'SIGKILL';
          steps.push({ ...plan[3], at: Date.now() - startedAtMs });
        }
      }, graceMs);
      if (typeof graceTimer.unref === 'function') graceTimer.unref();
    };

    const deadlineTimer = setTimeout(() => {
      timedOut = true;
      terminate('deadline');
    }, policy.resolved);
    if (typeof deadlineTimer.unref === 'function') deadlineTimer.unref();

    const onParentAbort = () => {
      if (timedOut || cancelled) return;
      cancelled = true;
      terminate('cancelled');
    };
    if (parentSignal) {
      if (parentSignal.aborted) onParentAbort();
      else parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    const finish = (exitCode, signal, extraStderr = '') => {
      clearTimeout(deadlineTimer);
      if (graceTimer) clearTimeout(graceTimer);
      if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
      let expiry = null;
      if (timedOut) {
        expiry = deadlineCore.buildExpiryRecord({
          ...meta,
          operation: meta.operation || command,
          startedAtMs,
          deadlineAtMs: startedAtMs + policy.resolved,
          nowMs: Date.now(),
          category: deadlineCore.EXPIRY_CATEGORIES.COMMAND_TIMEOUT,
          diagnostics: { terminatedBy, graceMs, stdoutTail: stdout.slice(-500), stderrTail: stderr.slice(-500) },
        });
        recordTimeoutEvent(expiry);
      }
      resolve({
        exitCode: timedOut || cancelled ? null : exitCode,
        signal: signal || null,
        stdout,
        stderr: extraStderr ? `${stderr}\n${extraStderr}` : stderr,
        timedOut,
        cancelled,
        terminatedBy,
        terminationSteps: steps,
        durationMs: Date.now() - startedAtMs,
        deadlineMs: policy.resolved,
        graceMs,
        expiry,
      });
    };

    child.on('close', (exitCode, signal) => finish(exitCode, signal));
    child.on('error', (error) => finish(null, null, error.message));
  });
}

// ── Banco (§57) ───────────────────────────────────────────────────────────────────────────────

/**
 * Executa `fn(transaction)` numa transação com `statement_timeout` da política DATABASE_QUERY.
 * Expirar produz ROLLBACK (nenhuma escrita parcial) e erro DB_TIMEOUT classificado — o worker
 * continua vivo e decide retry/BLOCKED_INFRA.
 */
async function withDbDeadline(sequelize, fn, { policy: policyName = 'DATABASE_QUERY', override = null, operation = 'db', meta = {} } = {}) {
  const policy = resolvePolicy(policyName, { override });
  const startedAtMs = Date.now();
  try {
    return await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.round(policy.resolved))}`, { transaction });
      return fn(transaction);
    });
  } catch (error) {
    const classified = deadlineCore.classifyOperationError(error, { operation });
    const isStatementTimeout = /canceling statement due to statement timeout/i.test(String(error?.message || error?.parent?.message || ''))
      || error?.parent?.code === '57014' || error?.original?.code === '57014';
    if (isStatementTimeout || classified.category === deadlineCore.EXPIRY_CATEGORIES.DB_TIMEOUT) {
      const record = deadlineCore.buildExpiryRecord({
        ...meta,
        operation,
        startedAtMs,
        deadlineAtMs: startedAtMs + policy.resolved,
        nowMs: Date.now(),
        category: deadlineCore.EXPIRY_CATEGORIES.DB_TIMEOUT,
      });
      recordTimeoutEvent(record);
      const wrapped = buildDeadlineError({ ...policy, retryable: true }, record);
      wrapped.code = 'DB_TIMEOUT';
      wrapped.outcome = 'INFRA_ERROR';
      wrapped.cause = error;
      throw wrapped;
    }
    throw error;
  }
}

module.exports = {
  METRIC_NAMES,
  resolvePolicy,
  policyMs,
  runWithDeadline,
  runChildWithDeadline,
  withDbDeadline,
  isDeadlineError,
  recordTimeoutEvent,
  recordLivenessEvent,
  incrementMetric,
  getTimeoutMetrics,
  resetTimeoutMetrics,
  onDeadlineEvent,
};
