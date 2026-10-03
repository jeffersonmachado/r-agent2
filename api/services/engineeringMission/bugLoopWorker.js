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
const { deriveWorkerState } = require('../../../engine/engineeringMission/workerHealth');
const logger = require('../../utils/logger');

const WORKER_TYPE = 'BUG_LOOP';

let timer = null;
let cycleRunning = false;
let instanceSeq = 0;

/** Falha de START do worker. Antes vivia só num `logger.warn` do chamador ('ignorado') e o
 *  subsistema seguia parecendo saudável — o defeito que este estado expõe. */
let startError = null;
let startedAtMs = null;

/**
 * Identidade ESTÁVEL da instância em execução (lease/fence). Fica vazia quando o worker NÃO roda.
 *
 * DEFEITO ELIMINADO (2026-10-03): `buildWorkerInstanceId()` era chamado DENTRO de cada ciclo, então
 * a identidade do worker mudava a cada passagem e o estado observável não a expunha de forma
 * alguma. Sem identidade estável não há como responder "qual worker está segurando o lease?" — e
 * a saúde publicada não permitia distinguir duas instâncias vivas do mesmo processo lógico.
 */
let runningWorkerInstanceId = null;

/** Quantos findings este processo já processou (contador de trabalho REAL, não de ticks). */
let processedFindings = 0;

const stats = {
  cycles: 0,
  lastRunAt: null,
  lastDurationMs: null,
  lastSummary: null,
  lastSuccessfulCycleAt: null,
  lastError: null,
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
  // Identidade ESTÁVEL enquanto este worker roda: os ciclos do próprio worker compartilham a
  // instância (o id por ciclo existe só para execuções avulsas, sem worker vivo).
  const instance = workerInstanceId || runningWorkerInstanceId || buildWorkerInstanceId();
  try {
    const summary = await coordinator.runBugLoopSweep({ limit, actor, autoFix, workerInstanceId: instance });
    stats.cycles += 1;
    stats.lastRunAt = new Date().toISOString();
    stats.lastSuccessCycleAtMs = Date.now();
    stats.lastSuccessfulCycleAt = new Date().toISOString();
    stats.lastDurationMs = Date.now() - startedAt;
    stats.lastSummary = summary;
    stats.consecutiveErrors = 0;
    // TRABALHO REAL: um ciclo "bem-sucedido" que não processa nada não é progresso. Contar os
    // findings efetivamente tocados evita que "worker rodando" signifique apenas "timer vivo".
    processedFindings += Array.isArray(summary.items) ? summary.items.length : 0;
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
    stats.lastError = { code: err.code || null, message: err.message, at: new Date().toISOString() };
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
  if (timer) return { started: false, reason: 'already_running', state: getBugLoopWorkerStatus().health };
  if (String(process.env.ENABLE_BUG_LOOP_WORKER || '').toLowerCase() === 'false') {
    return { started: false, reason: 'disabled_by_policy', state: 'DISABLED_BY_POLICY' };
  }

  try {
    timer = setInterval(() => { void runBugLoopCycle({ limit, autoFix }); }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    runningWorkerInstanceId = buildWorkerInstanceId();
    if (runImmediately) setTimeout(() => { void runBugLoopCycle({ limit, autoFix }); }, 25).unref?.();
  } catch (err) {
    // O START em si falhou (ex.: recurso indisponível no boot). Registrar é obrigatório: sem isto o
    // subsistema de engenharia seguiria reportando saúde normal sem o worker que processa findings.
    startError = err.message;
    stats.lastError = { code: err.code || 'WORKER_START_FAILED', message: err.message, at: new Date().toISOString() };
    logger.error('[bugLoopWorker] FALHA AO INICIAR o worker obrigatório do laço de bugs', {
      error: err.message, code: err.code || null,
    });
    return { started: false, reason: 'start_failed', error: err.message, state: 'DOWN' };
  }

  startError = null;
  startedAtMs = Date.now();
  logger.info('[bugLoopWorker] iniciado', { intervalMs, limit, autoFix });
  return { started: true, intervalMs, limit, autoFix, state: 'RUNNING' };
}

/** Para o worker (shutdown gracioso). O trabalho pendente permanece no banco. */
function stopBugLoopWorker() {
  if (!timer) return { stopped: false, reason: 'not_running' };
  clearInterval(timer);
  timer = null;
  runningWorkerInstanceId = null;
  logger.info('[bugLoopWorker] parado', { cycles: stats.cycles });
  return { stopped: true };
}

/**
 * ESTADO OBSERVÁVEL do worker. É o que impede a mentira: "tem timer" não é saúde, e uma falha de
 * start registrada é DOWN explícito. `staleAfterMs` é derivado do próprio intervalo de ciclo (com
 * folga generosa) para que o limiar acompanhe a configuração real em vez de um número solto.
 */
function getBugLoopWorkerStatus({
  nowMs = Date.now(),
  staleAfterMs = Number(process.env.ENGINEERING_BUG_LOOP_STALE_MS || 0)
    || Math.max(60000, Number(process.env.ENGINEERING_BUG_LOOP_INTERVAL_MS || 15000) * 4),
} = {}) {
  const health = deriveWorkerState({
    enabledByPolicy: String(process.env.ENABLE_BUG_LOOP_WORKER || '').toLowerCase() !== 'false',
    started: Boolean(timer),
    startError,
    startedAtMs,
    nowMs,
    lastCycleAtMs: stats.lastRunAt ? Date.parse(stats.lastRunAt) : null,
    lastSuccessAtMs: stats.lastSuccessfulCycleAt ? Date.parse(stats.lastSuccessfulCycleAt) : null,
    consecutiveErrors: stats.consecutiveErrors,
    staleAfterMs,
  });

  return {
    type: WORKER_TYPE,
    running: Boolean(timer),
    cycleRunning,
    health: health.health,
    state: health.health,
    stuck: health.stuck,
    healthy: health.healthy,
    code: health.code,
    reason: health.reason,
    startedAt: startedAtMs ? new Date(startedAtMs).toISOString() : null,
    // Identidade da instância VIVA (null quando não há worker rodando): é o que permite ligar a
    // saúde publicada a um worker real, e não a um processo anônimo.
    workerInstanceId: runningWorkerInstanceId,
    lastError: stats.lastError,
    processedFindings,
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
