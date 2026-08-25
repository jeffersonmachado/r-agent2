'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const cron = require('./nodeCronCompat');
const { loadRegistry, runMesh } = require('./meshRunner');

const dbStateStore = require('../qa/state/dbStateStore');
const SCHEDULER_STATE_KEY = 'qa-mesh/scheduler-state.json';
const SCHEDULER_STATE_PATH = path.join(__dirname, 'scheduler-state.json');
const PIPELINE_ACTIVE_LOCK_PATH = path.join(__dirname, '..', 'pipeline', '.active-validation.lock');
const MESH_RUNNING_LOCK_PATH = path.join(__dirname, 'mesh-running.lock');
const CRITICAL_CRON = '*/15 * * * *';
const REGRESSION_CRON = '0 2 * * *';
// Frequências configuráveis do scheduler crítico. A UI expõe apenas o rótulo
// amigável; a expressão cron fica interna (nunca é mostrada ao usuário final).
const CRITICAL_FREQUENCY_PRESETS = Object.freeze({
  '15min': { cron: '*/15 * * * *', label: 'A cada 15 minutos' },
  '30min': { cron: '*/30 * * * *', label: 'A cada 30 minutos' },
  '1h': { cron: '0 * * * *', label: 'A cada 1 hora' },
  '2h': { cron: '0 */2 * * *', label: 'A cada 2 horas' },
  '6h': { cron: '0 */6 * * *', label: 'A cada 6 horas' },
  '12h': { cron: '0 */12 * * *', label: 'A cada 12 horas' },
  'daily': { cron: '0 0 * * *', label: 'Uma vez por dia' },
});
const DEFAULT_FREQUENCY_KEY = '15min';

let activeLock = false;
let activeTasks = [];
// Estado de ligado/desligado do scheduler. Default ligado; a env var força
// desligado (fail-closed) e a preferência persistida (via UI) também é
// respeitada no próximo start.
// Habilitação do agendamento é EXPLÍCITA (opt-in): por padrão DESLIGADO. Só liga
// quando o usuário ativar pela UI (estado persistido `enabled:true`) ou via env
// QA_MESH_SCHEDULER_ENABLED=true. QA_MESH_SCHEDULER_DISABLED=true é o kill-switch
// fail-closed que sempre vence.
let schedulerEnabled = false;
let criticalFrequencyKey = DEFAULT_FREQUENCY_KEY;

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
  // DB canônico (RAP-078): grava no banco e mantém o JSON como export derivado.
  dbStateStore.saveSyncExport(SCHEDULER_STATE_KEY, nextState);
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
      ...safeReadState(),
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

function currentFrequencyPreset() {
  return CRITICAL_FREQUENCY_PRESETS[criticalFrequencyKey] || CRITICAL_FREQUENCY_PRESETS[DEFAULT_FREQUENCY_KEY];
}

function buildScheduleStatus() {
  const state = safeReadState();
  const preset = currentFrequencyPreset();
  return {
    enabled: schedulerEnabled,
    lock: activeLock || state.activeLock,
    frequency: {
      key: criticalFrequencyKey,
      label: preset.label,
      cron: preset.cron,
    },
    schedule: {
      smokeOnDeploy: 'deploy',
      critical: preset.cron,
      regression: REGRESSION_CRON,
    },
    nextRuns: {
      smokeOnDeploy: 'on_deploy',
      critical: preset.cron,
      regression: REGRESSION_CRON,
    },
    lastExecution: {
      kind: state.lastExecutionKind,
      executionId: state.lastExecutionId,
      at: state.lastExecutionAt,
    },
  };
}

function startCronTasks() {
  const criticalCron = currentFrequencyPreset().cron;
  activeTasks = [
    cron.schedule(criticalCron, () => {
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
  schedulerEnabled = true;
}

function startScheduler() {
  // Kill-switch fail-closed sempre vence.
  if (process.env.QA_MESH_SCHEDULER_DISABLED === 'true') {
    schedulerEnabled = false;
    return { enabled: false, reason: 'QA_MESH_SCHEDULER_DISABLED' };
  }

  const persisted = safeReadState();
  // Limpa lock obsoleto de um processo anterior (reinício do server).
  if (persisted.activeLock === true) {
    writeState({ ...persisted, activeLock: false });
    persisted.activeLock = false;
  }
  if (persisted.criticalFrequencyKey && CRITICAL_FREQUENCY_PRESETS[persisted.criticalFrequencyKey]) {
    criticalFrequencyKey = persisted.criticalFrequencyKey;
  }

  // Habilitação EXPLÍCITA (opt-in): estado persistido enabled:true (toggle da UI)
  // ou env QA_MESH_SCHEDULER_ENABLED=true. Sem isso, o bootstrap NÃO inicia o mesh.
  const explicitlyEnabled = persisted.enabled === true || process.env.QA_MESH_SCHEDULER_ENABLED === 'true';
  if (!explicitlyEnabled) {
    schedulerEnabled = false;
    return { enabled: false, reason: 'not_explicitly_enabled' };
  }

  if (activeTasks.length > 0) {
    schedulerEnabled = true;
    return buildScheduleStatus();
  }
  startCronTasks();
  return buildScheduleStatus();
}

function stopScheduler() {
  activeTasks.forEach((task) => {
    if (task?.stop) task.stop();
    if (task?.destroy) task.destroy();
  });
  activeTasks = [];
  schedulerEnabled = false;
}

/**
 * Liga/desliga o scheduler em runtime (controle via UI de configuração).
 * A preferência é persistida (RAP-078: dbStateStore + export JSON) e respeitada
 * no próximo start do processo. Se QA_MESH_SCHEDULER_DISABLED=true, permanece
 * desligado (fail-closed) — a UI não pode religar contra uma env var de kill.
 */
function setSchedulerEnabled(enabled, frequencyKey) {
  const next = Boolean(enabled);
  const requestedKey = CRITICAL_FREQUENCY_PRESETS[frequencyKey] ? frequencyKey : criticalFrequencyKey;
  const frequencyChanged = requestedKey !== criticalFrequencyKey;
  criticalFrequencyKey = requestedKey;

  if (next) {
    if (process.env.QA_MESH_SCHEDULER_DISABLED === 'true') {
      writeState({ ...safeReadState(), enabled: false, criticalFrequencyKey });
      return buildScheduleStatus();
    }
    if (activeTasks.length > 0) {
      // Se só a frequência mudou (já estava ligado), reinicia os timers com a nova cadência.
      if (frequencyChanged) {
        stopScheduler();
        startCronTasks();
      }
    } else {
      startCronTasks();
    }
  } else {
    stopScheduler();
  }
  writeState({ ...safeReadState(), enabled: schedulerEnabled, criticalFrequencyKey });
  return buildScheduleStatus();
}

module.exports = {
  SCHEDULER_STATE_PATH,
  PIPELINE_ACTIVE_LOCK_PATH,
  CRITICAL_CRON,
  REGRESSION_CRON,
  CRITICAL_FREQUENCY_PRESETS,
  DEFAULT_FREQUENCY_KEY,
  selectScenariosForSchedule,
  buildScheduleStatus,
  runScheduledMesh,
  startScheduler,
  stopScheduler,
  setSchedulerEnabled,
};
