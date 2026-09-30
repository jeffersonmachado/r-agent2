'use strict';

/**
 * api/services/engineeringMission/bugLoopWorker.js
 *
 * WORKER AUTOMÁTICO DO LAÇO DE BUGS.
 *
 * GAP QUE ESTE ARQUIVO FECHA (confirmado no código em 2026-09-30): `hookMissionFailure` cria o
 * finding automaticamente, mas o processamento posterior só acontecia por chamada MANUAL
 * (`POST /engineering/findings/sweep`). Sem um worker, o caminho normal parava em SUSPECTED e
 * exigia intervenção humana — exatamente o que a missão proíbe.
 *
 * Durabilidade: o ESTADO vive no banco (finding + linhagem da missão), não neste processo. Cada
 * ciclo reivindica o trabalho pendente e a posse por finding é um LEASE com fence monotônico
 * (`bugFindingService.acquireFindingLease`): se o processo morre em SUSPECTED/REPRODUCING/CONFIRMED/
 * FIXING/REGRESSION, o lease expira e o próximo ciclo (ou outro processo) assume — sem duplicar
 * finding e sem depender de identificação por PID.
 *
 * Ciclo é IDEMPOTENTE: nunca duplica task, nunca reabre ciclo fechado, nunca repete uma retomada já
 * registrada na linhagem.
 *
 * Não é um scheduler paralelo: segue o mesmo contrato dos demais workers do RAP
 * (`startX({ intervalMs })` + `stopX()` + flag `ENABLE_*`), registrado em `api/runtime/startWorkers`.
 */

const os = require('os');
const coordinator = require('./bugLoopCoordinatorService');
const logger = require('../../utils/logger');

const WORKER_TYPE = 'BUG_LOOP';

let timer = null;
let cycleRunning = false;
let instanceSeq = 0;

const stats = {
  cycles: 0,
  lastRunAt: null,
  lastDurationMs: null,
  lastSummary: null,
  errors: 0,
  consecutiveErrors: 0,
};

/** Identidade da instância do worker (lease/fence). Única por processo+processamento. */
function buildWorkerInstanceId() {
  instanceSeq += 1;
  return `${WORKER_TYPE}:${os.hostname()}:${process.pid}:${instanceSeq}`;
}

/**
 * Um ciclo: processa reprodução → confirmação → triagem → correção → regressão → RETOMADA da missão.
 * Reentrância é bloqueada no MESMO processo (`cycleRunning`); entre processos, a exclusão é o lease
 * por finding + o lease da missão/task usado pelo Router.
 */
async function runBugLoopCycle({
  limit = Number(process.env.ENGINEERING_BUG_LOOP_BATCH || 10),
  autoFix = true,
  actor = 'SYSTEM:BUG_LOOP_WORKER',
  workerInstanceId = null,
} = {}) {
  if (cycleRunning) return { skipped: true, reason: 'cycle_in_progress' };
  cycleRunning = true;
  const startedAt = Date.now();
  const instance = workerInstanceId || buildWorkerInstanceId();
  try {
    const summary = await coordinator.runBugLoopSweep({ limit, actor, autoFix, workerInstanceId: instance });
    stats.cycles += 1;
    stats.lastRunAt = new Date().toISOString();
    stats.lastDurationMs = Date.now() - startedAt;
    stats.lastSummary = summary;
    stats.consecutiveErrors = 0;
    if (summary.items.length > 0) {
      logger.info('[bugLoopWorker] ciclo executado', {
        instance,
        scanned: summary.scanned,
        confirmed: summary.confirmed,
        triaged: summary.triaged,
        fixed: summary.fixed,
        resumed: summary.resumed,
        blockedRecursive: summary.blockedRecursive,
        leaseSkipped: summary.leaseSkipped,
        durationMs: stats.lastDurationMs,
      });
    }
    return summary;
  } catch (err) {
    stats.errors += 1;
    stats.consecutiveErrors += 1;
    stats.lastRunAt = new Date().toISOString();
    stats.lastDurationMs = Date.now() - startedAt;
    // Falha de um ciclo NUNCA derruba o processo: o trabalho continua pendente no banco e o próximo
    // ciclo (ou outro worker) retoma. O erro fica registrado para diagnóstico.
    logger.warn('[bugLoopWorker] ciclo falhou', { instance, code: err.code || null, message: err.message, consecutiveErrors: stats.consecutiveErrors });
    return { error: { code: err.code || null, message: err.message } };
  } finally {
    cycleRunning = false;
  }
}

/**
 * Inicia o worker automático. Primeiro ciclo é agendado imediatamente (não espera o intervalo) para
 * que um finding deixado por um processo anterior seja assumido assim que o serviço sobe.
 */
function startBugLoopWorker({
  intervalMs = Number(process.env.ENGINEERING_BUG_LOOP_INTERVAL_MS || 15000),
  limit = Number(process.env.ENGINEERING_BUG_LOOP_BATCH || 10),
  autoFix = process.env.ENGINEERING_BUG_LOOP_AUTOFIX !== 'false',
  runImmediately = true,
} = {}) {
  if (timer) return { started: false, reason: 'already_running' };

  timer = setInterval(() => { void runBugLoopCycle({ limit, autoFix }); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  if (runImmediately) setTimeout(() => { void runBugLoopCycle({ limit, autoFix }); }, 25).unref?.();

  logger.info('[bugLoopWorker] iniciado', { intervalMs, limit, autoFix });
  return { started: true, intervalMs, limit, autoFix };
}

/** Para o worker (shutdown gracioso). O trabalho pendente permanece no banco. */
function stopBugLoopWorker() {
  if (!timer) return { stopped: false, reason: 'not_running' };
  clearInterval(timer);
  timer = null;
  logger.info('[bugLoopWorker] parado', { cycles: stats.cycles });
  return { stopped: true };
}

function getBugLoopWorkerStatus() {
  return {
    running: Boolean(timer),
    cycleRunning,
    ...stats,
  };
}

module.exports = {
  WORKER_TYPE,
  runBugLoopCycle,
  startBugLoopWorker,
  stopBugLoopWorker,
  getBugLoopWorkerStatus,
};
