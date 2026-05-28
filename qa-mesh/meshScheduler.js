'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const cron = require('./nodeCronCompat');
const { loadRegistry, runMesh } = require('./meshRunner');

const SCHEDULER_STATE_PATH = path.join(__dirname, 'scheduler-state.json');
const PIPELINE_ACTIVE_LOCK_PATH = path.join(__dirname, '..', 'pipeline', '.active-validation.lock');
const MESH_RUNNING_LOCK_PATH = path.join(__dirname, 'mesh-running.lock');
const CRITICAL_CRON = '*/15 * * * *';
const REGRESSION_CRON = '0 2 * * *';

let activeLock = false;
let activeTasks = [];

function isMeshAlreadyRunning() {
  // Verifica lock persistente em disco
  if (fs.existsSync(MESH_RUNNING_LOCK_PATH)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(MESH_RUNNING_LOCK_PATH, 'utf8'));
      const pid = lockData.pid;
      // Verifica se o PID ainda está vivo
      try {
        process.kill(pid, 0);
        return { running: true, reason: `lock_pid_${pid}_alive`, pid };
      } catch (_) {
        // PID morto - lock stale, podemos limpar
        fs.unlinkSync(MESH_RUNNING_LOCK_PATH);
        return { running: false, reason: 'stale_lock_cleaned', pid };
      }
    } catch (_) {
      // Lock corrompido, limpa
      try { fs.unlinkSync(MESH_RUNNING_LOCK_PATH); } catch (__) {}
      return { running: false, reason: 'corrupt_lock_cleaned' };
    }
  }

  // Verifica processos meshRunner vivos
  try {
    const procs = execSync('ps aux | grep "meshRunner\\.js" | grep -v grep | grep -v meshScheduler', {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
    if (procs) {
      const pids = procs.split('\n').map(l => l.trim().split(/\s+/)[1]).filter(Boolean);
      return { running: true, reason: `meshRunner_processes_${pids.join(',')}`, pid: pids[0] };
    }
  } catch (_) {
    // ps falhou, ignora
  }

  return { running: false, reason: 'no_lock_no_process' };
}

function acquireMeshLock(pid) {
  fs.writeFileSync(MESH_RUNNING_LOCK_PATH, JSON.stringify({
    pid: pid || process.pid,
    startedAt: new Date().toISOString(),
    host: require('os').hostname(),
  }, null, 2), 'utf8');
}

function releaseMeshLock() {
  try { fs.unlinkSync(MESH_RUNNING_LOCK_PATH); } catch (_) {}
}

function logSchedulerSkip(reason, details = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    event: 'scheduler_skipped',
    reason,
    ...details,
  };
  // eslint-disable-next-line no-console
  console.log(`[qa-mesh/meshScheduler] SKIP: ${reason} ${JSON.stringify(details)}`);
  // Grava no log de scheduler
  const logPath = path.join(__dirname, 'scheduler-activity.log');
  fs.appendFileSync(logPath, `${JSON.stringify(logEntry)}\n`, 'utf8');
}

function safeReadState() {
  try {
    return JSON.parse(fs.readFileSync(SCHEDULER_STATE_PATH, 'utf8'));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[qa-mesh/meshScheduler] estado inválido ou ausente em ${SCHEDULER_STATE_PATH}: ${error.message || error}`);
    return {
      lastExecutionAt: null,
      lastExecutionKind: null,
      lastExecutionId: null,
      activeLock: false,
    };
  }
}

function writeState(nextState) {
  fs.writeFileSync(SCHEDULER_STATE_PATH, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
  return nextState;
}

function selectScenariosForSchedule(kind, registry = loadRegistry()) {
  if (kind === 'smoke') return registry.filter((item) => item.type === 'smoke');
  if (kind === 'critical') return registry.filter((item) => item.criticality === 'blocking');
  return registry;
}

async function runScheduledMesh(kind = 'critical') {
  if (fs.existsSync(PIPELINE_ACTIVE_LOCK_PATH)) {
    logSchedulerSkip('pipeline_active');
    return { skipped: true, reason: 'pipeline_active', state: safeReadState() };
  }

  // ── Proteção contra execuções simultâneas ──
  const meshCheck = isMeshAlreadyRunning();
  if (meshCheck.running) {
    logSchedulerSkip('mesh_already_running', { details: meshCheck });
    return { skipped: true, reason: 'mesh_already_running', details: meshCheck };
  }

  if (activeLock) {
    logSchedulerSkip('scheduler_locked');
    return { skipped: true, reason: 'scheduler_locked', state: safeReadState() };
  }

  const selected = selectScenariosForSchedule(kind);
  activeLock = true;
  writeState({ ...safeReadState(), activeLock: true });

  try {
    const result = await runMesh({
      scenarioIds: selected.map((item) => item.id),
      autoReplayOnFailure: true,
      executionOrigin: 'scheduler',
      executionKind: kind,
      writeCanonicalOutputs: false,
      closeGovernanceDbAfterIntegration: false,
    });
    writeState({
      activeLock: false,
      lastExecutionAt: new Date().toISOString(),
      lastExecutionKind: kind,
      lastExecutionId: result.executionId,
    });
    return result;
  } finally {
    activeLock = false;
  }
}

function buildScheduleStatus() {
  const state = safeReadState();
  return {
    enabled: true,
    lock: activeLock || state.activeLock,
    schedule: {
      smokeOnDeploy: 'deploy',
      critical: CRITICAL_CRON,
      regression: REGRESSION_CRON,
    },
    nextRuns: {
      smokeOnDeploy: 'on_deploy',
      critical: CRITICAL_CRON,
      regression: REGRESSION_CRON,
    },
    lastExecution: {
      kind: state.lastExecutionKind,
      executionId: state.lastExecutionId,
      at: state.lastExecutionAt,
    },
  };
}

function startScheduler() {
  if (process.env.QA_MESH_SCHEDULER_DISABLED === 'true') {
    return { enabled: false, reason: 'QA_MESH_SCHEDULER_DISABLED' };
  }
  if (activeTasks.length > 0) {
    return buildScheduleStatus();
  }
  activeTasks = [
    cron.schedule(CRITICAL_CRON, () => {
      runScheduledMesh('critical').catch((error) => {
        // eslint-disable-next-line no-console
        console.error(`[qa-mesh/meshScheduler] critical falhou: ${error.message || error}`);
      });
    }),
    cron.schedule(REGRESSION_CRON, () => {
      runScheduledMesh('regression').catch((error) => {
        // eslint-disable-next-line no-console
        console.error(`[qa-mesh/meshScheduler] regression falhou: ${error.message || error}`);
      });
    }),
  ];
  return buildScheduleStatus();
}

function stopScheduler() {
  activeTasks.forEach((task) => {
    if (task?.stop) task.stop();
    if (task?.destroy) task.destroy();
  });
  activeTasks = [];
}

module.exports = {
  SCHEDULER_STATE_PATH,
  PIPELINE_ACTIVE_LOCK_PATH,
  CRITICAL_CRON,
  REGRESSION_CRON,
  selectScenariosForSchedule,
  buildScheduleStatus,
  runScheduledMesh,
  startScheduler,
  stopScheduler,
};
