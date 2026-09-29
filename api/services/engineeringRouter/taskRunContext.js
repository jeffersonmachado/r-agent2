'use strict';

/**
 * api/services/engineeringRouter/taskRunContext.js — POSSE de UMA execução de EngineeringTask.
 *
 * Liga as primitivas que já existiam (TaskLease, fencing, heartbeat, progresso, deadline) ao
 * caminho NORMAL de `runTask` — antes elas só eram usadas pelo recovery e por testes, e o runtime
 * normal decidia posse por `locked_at` + idade. Fluxo de vida:
 *
 *   runTask → acquireTaskLease (fence N) → createTaskRun → heartbeat agenda renovação
 *     → trabalho (cada escrita crítica guardada por token+fence) → progresso em eventos reais
 *     → complete → stop heartbeat → release lease.
 *
 * O que este módulo faz, e por quê:
 *   - `writes`: fachada do engineeringTaskService em que TODA escrita crítica carrega a credencial
 *     do lease. Transições/erro/roteamento passam pelo CAS de fence; linhas-filhas (attempt, test
 *     run, review, telemetria de fase) exigem `assertTaskLeaseHeld` ANTES do efeito. Um worker que
 *     perdeu a posse recebe TASK_STALE_WORKER_WRITE e não sobrescreve o novo dono.
 *   - watchdog no tick do heartbeat: classifica SLOW / STUCK / DEAD pelo estado PERSISTIDO.
 *     STUCK (vivo, sem progresso) ⇒ diagnóstico + cancelamento cooperativo da OPERAÇÃO corrente
 *     (provider/child), nunca takeover. SLOW ⇒ só registra. DEAD não é decidido aqui (quem está
 *     morto não roda watchdog): é o lease expirando que libera o takeover.
 *   - operações: cada chamada longa (provider, comandos) recebe um AbortSignal que junta
 *     "lease perdido" + "cancelamento por NO_PROGRESS".
 */

const engineeringTaskService = require('./engineeringTaskService');
const { startLeaseHeartbeat } = require('./leaseHeartbeat');
const { FAILURE_CODES } = require('../../../engine/engineeringRouter/constants');
const { loadPolicyRegistry } = require('../../../engine/shared/executionDeadline');
const { LIVENESS_STATES } = require('../../../engine/engineeringMission/progressPolicy');
const { resolvePolicy, policyMs, recordLivenessEvent } = require('../../utils/operationDeadline');
const logger = require('../../utils/logger');

/** Escritas que exigem o CAS de fence direto na linha da task. */
const FENCED_TASK_WRITES = Object.freeze(['transitionTask', 'saveLastError', 'saveRoutingDecision']);
/** Escritas em tabelas-filhas: exigem posse vigente comprovada no banco ANTES do efeito. */
const HELD_CHILD_WRITES = Object.freeze([
  'createAttempt', 'updateAttempt', 'createTestRun', 'updateTestRun',
  'createReview', 'createRegressionRun', 'recordTelemetry',
]);

/**
 * Limiar de NO_PROGRESS efetivo. Sem override, vale o limiar POR FASE do registry (REGRESSION usa
 * `REGRESSION_NO_PROGRESS`); com override declarado (`ENGINEERING_NO_PROGRESS_MS`), um limiar único
 * — sempre clampado no [min,max] da política (nunca abaixo do mínimo declarado).
 */
function resolveNoProgressPolicy() {
  const np = resolvePolicy('NO_PROGRESS');
  if (np.source !== 'registry_default') return np.resolved;
  const registry = loadPolicyRegistry();
  return {
    default: np.resolved,
    perPhase: {
      ...(registry?.policies?.NO_PROGRESS?.perPhase || {}),
      REGRESSION: policyMs('REGRESSION_NO_PROGRESS'),
    },
  };
}

function isOwnershipLoss(run, err) {
  if (!run) return false;
  if (run.heartbeat && run.heartbeat.state.lost) return true;
  return Boolean(err && (err.staleWrite
    || err.code === 'TASK_LEASE_LOST'
    || err.code === FAILURE_CODES.TASK_LEASE_LOST
    || err.code === 'TASK_STALE_WORKER_WRITE'
    || err.code === 'TASK_LEASE_EXPIRED'
    || err.code === 'TASK_LEASE_NOT_HELD'));
}

function createTaskRun({ taskId, runnerId, lease, onProgress = null, heartbeatIntervalMs = null }) {
  const guard = { leaseToken: lease.token, fence: lease.fence };
  const noProgressPolicy = resolveNoProgressPolicy();

  const run = {
    taskId,
    runnerId,
    guard,
    lease,
    heartbeat: null,
    currentOperation: null,
    lastCancel: null,
    stuckHandledFor: null,
    livenessLog: [],
    noProgressPolicy,

    async assertHeld() {
      if (run.heartbeat && run.heartbeat.state.lost) {
        const err = new Error('posse da task perdida (heartbeat não renovou)');
        err.code = FAILURE_CODES.TASK_LEASE_LOST;
        throw err;
      }
      return engineeringTaskService.assertTaskLeaseHeld(taskId, guard);
    },

    /** Progresso SIGNIFICATIVO (nunca heartbeat). Guardado por fence; propaga à missão via callback. */
    async progress(signal, detail = null) {
      const recorded = await engineeringTaskService.recordTaskProgress(taskId, { signal, detail }, guard);
      if (recorded.accepted && typeof onProgress === 'function') {
        try {
          await onProgress({ taskId, signal, detail });
        } catch (error) {
          logger.warn('[taskRun] propagação de progresso falhou (não bloqueia a task)', { taskId, signal, message: error.message });
        }
      }
      return recorded;
    },

    /**
     * Abre uma OPERAÇÃO longa. O signal devolvido aborta se o lease for perdido OU se o watchdog
     * cancelar por NO_PROGRESS. `baselineMs` é o limiar a partir do qual a operação é SLOW.
     */
    beginOperation(name, { baselineMs = null } = {}) {
      const controller = new AbortController();
      const signals = [controller.signal];
      if (run.heartbeat) signals.push(run.heartbeat.signal);
      const op = {
        name,
        startedAt: Date.now(),
        baselineMs,
        controller,
        signal: AbortSignal.any(signals),
        slowReported: false,
      };
      run.currentOperation = op;
      return op;
    },

    endOperation(op) {
      if (op && run.currentOperation === op) run.currentOperation = null;
    },

    deadlineMeta(task, phase) {
      return {
        taskId,
        missionId: task?.mission_id || null,
        phase,
        leaseOwner: runnerId,
        fence: guard.fence,
      };
    },

    stop() {
      if (run.heartbeat) run.heartbeat.stop();
    },
  };

  const guardedWrites = {};
  for (const name of FENCED_TASK_WRITES) {
    guardedWrites[name] = (id, a, b) => {
      if (name === 'transitionTask') return engineeringTaskService.transitionTask(id, a, b || {}, guard);
      return engineeringTaskService[name](id, a, guard);
    };
  }
  for (const name of HELD_CHILD_WRITES) {
    guardedWrites[name] = async (...args) => {
      await run.assertHeld();
      return engineeringTaskService[name](...args);
    };
  }
  run.writes = new Proxy(engineeringTaskService, {
    get(target, prop) {
      if (Object.prototype.hasOwnProperty.call(guardedWrites, prop)) return guardedWrites[prop];
      return target[prop];
    },
  });

  run.heartbeat = startLeaseHeartbeat({
    name: `task:${taskId}`,
    renew: () => engineeringTaskService.renewTaskLease(taskId, { leaseToken: guard.leaseToken }),
    onTick: () => watchdogTick(run),
    intervalMs: heartbeatIntervalMs,
    meta: { taskId, runnerId, fence: guard.fence },
  });

  return run;
}

/**
 * Watchdog de progresso — roda no tick do heartbeat (fora do caminho crítico da renovação).
 * Heartbeat saudável + sem progresso ⇒ STUCK: diagnostica e cancela a OPERAÇÃO corrente para que
 * o Router aplique retry/fallback/replan. Não toca no lease (nenhum takeover) e não mata o worker.
 */
async function watchdogTick(run) {
  const op = run.currentOperation;
  const liveness = await engineeringTaskService.evaluateTaskLiveness(run.taskId, {
    policy: run.noProgressPolicy,
    operationStartedAtMs: op ? op.startedAt : null,
    operationBaselineMs: op ? op.baselineMs : null,
  });
  if (!liveness) return;

  if (liveness.state === LIVENESS_STATES.STUCK) {
    const mark = liveness.progress?.lastMeaningfulProgressAt || 'none';
    if (run.stuckHandledFor === mark) return; // esta janela de silêncio já foi tratada
    run.stuckHandledFor = mark;
    const diagnostics = {
      state: liveness.state,
      reason: liveness.reason,
      operation: op ? op.name : null,
      operationElapsedMs: op ? Date.now() - op.startedAt : null,
      lastProgressSignal: liveness.progress?.lastProgressSignal || null,
      lastMeaningfulProgressAt: liveness.progress?.lastMeaningfulProgressAt || null,
      silentForMs: liveness.progress?.silentForMs ?? null,
      thresholdMs: liveness.progress?.thresholdMs ?? null,
      heartbeatAgeMs: liveness.heartbeatAgeMs,
      leaseOwner: run.runnerId,
      fence: run.guard.fence,
      takeoverAllowed: liveness.takeoverAllowed,
      action: op ? 'cancel_operation' : 'wait',
    };
    run.livenessLog.push({ at: new Date().toISOString(), ...diagnostics });
    recordLivenessEvent('NO_PROGRESS', { taskId: run.taskId, ...diagnostics });
    await engineeringTaskService.recordTelemetry({
      task_id: run.taskId,
      role: 'WATCHDOG',
      result: 'NO_PROGRESS',
      event_type: 'NO_PROGRESS',
      detail: diagnostics,
    }).catch(() => {});
    if (op) {
      run.lastCancel = { reason: 'NO_PROGRESS', operation: op.name, at: Date.now(), diagnostics };
      const cancel = new Error(`NO_PROGRESS: operação ${op.name} cancelada (worker vivo, sem progresso significativo)`);
      cancel.code = 'NO_PROGRESS';
      op.controller.abort(cancel);
    }
    return;
  }

  if (liveness.state === LIVENESS_STATES.SLOW && op && !op.slowReported) {
    op.slowReported = true;
    const detail = { state: liveness.state, reason: liveness.reason, operation: op.name, operationElapsedMs: Date.now() - op.startedAt, baselineMs: op.baselineMs };
    run.livenessLog.push({ at: new Date().toISOString(), ...detail });
    recordLivenessEvent('SLOW', { taskId: run.taskId, ...detail });
    await engineeringTaskService.recordTelemetry({
      task_id: run.taskId,
      role: 'WATCHDOG',
      result: 'SLOW',
      event_type: 'SLOW',
      detail,
    }).catch(() => {});
  }
}

module.exports = {
  createTaskRun,
  watchdogTick,
  isOwnershipLoss,
  resolveNoProgressPolicy,
  FENCED_TASK_WRITES,
  HELD_CHILD_WRITES,
};
