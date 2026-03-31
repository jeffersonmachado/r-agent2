'use strict';

const fs = require('fs');
const path = require('path');
const cron = require('./nodeCronCompat');
const { loadRegistry, runMesh } = require('./meshRunner');

const SCHEDULER_STATE_PATH = path.join(__dirname, 'scheduler-state.json');
const CRITICAL_CRON = '*/15 * * * *';
const REGRESSION_CRON = '0 2 * * *';

let activeLock = false;
let activeTasks = [];

function safeReadState() {
  try {
    return JSON.parse(fs.readFileSync(SCHEDULER_STATE_PATH, 'utf8'));
  } catch (_) {
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
  if (activeLock) {
    return {
      skipped: true,
      reason: 'scheduler_locked',
      state: safeReadState(),
    };
  }

  const selected = selectScenariosForSchedule(kind);
  activeLock = true;
  writeState({
    ...safeReadState(),
    activeLock: true,
  });

  try {
    const result = await runMesh({
      scenarioIds: selected.map((item) => item.id),
      autoReplayOnFailure: true,
      executionKind: kind,
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
  if (activeTasks.length > 0) {
    return buildScheduleStatus();
  }
  activeTasks = [
    cron.schedule(CRITICAL_CRON, () => {
      runScheduledMesh('critical').catch(() => null);
    }),
    cron.schedule(REGRESSION_CRON, () => {
      runScheduledMesh('regression').catch(() => null);
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
  CRITICAL_CRON,
  REGRESSION_CRON,
  selectScenariosForSchedule,
  buildScheduleStatus,
  runScheduledMesh,
  startScheduler,
  stopScheduler,
};
