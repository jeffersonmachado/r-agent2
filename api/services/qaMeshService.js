'use strict';

const fs = require('fs');
const path = require('path');
const { loadRegistry, refreshRegistry, runMesh, loadHistory } = require('../../qa-mesh/meshRunner');
const { buildScheduleStatus, runScheduledMesh, startScheduler } = require('../../qa-mesh/meshScheduler');
const { enqueueExecution, getExecution, getAllExecutions, appendLog, updateExecution } = require('../../qa-mesh/executionQueue');

startScheduler();

function getRegistry() {
  return loadRegistry();
}

function refreshMeshRegistry() {
  return refreshRegistry();
}

function getLatestExecution() {
  return loadHistory(1)[0] || null;
}

function getMeshHistory(options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : 20;
  let history = loadHistory(limit);
  if (options.domain) {
    history = history.filter((item) => (item.results || []).some((result) => result.domain === options.domain));
  }
  return history.slice(0, limit);
}

function getExecutionById(executionId) {
  if (!executionId) return null;
  const live = getExecution(executionId);
  if (live) return live;
  const filePath = path.join(__dirname, '../../qa-mesh/meshHistory', `${executionId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function queueMeshRun(options = {}) {
  return enqueueExecution('run', options, async (executionId) => {
    return runMesh({
      executionId,
      scenarioIds: options.scenarioIds,
      domain: options.domain,
      type: options.type,
      criticality: options.criticality,
      changedFiles: options.changedFiles,
      impactOnly: options.impactOnly,
      detectChangedFiles: options.detectChangedFiles,
      autoReplayOnFailure: false,
      onLog(log) {
        appendLog(executionId, log.message, log.level, log);
      },
      onScenarioStart(meta) {
        updateExecution(executionId, {
          progress: meta.total > 0 ? Math.round(((meta.index - 1) / meta.total) * 100) : 0,
          currentScenarioId: meta.scenarioId,
        });
      },
      onScenarioComplete(meta) {
        updateExecution(executionId, {
          progress: meta.total > 0 ? Math.round((meta.index / meta.total) * 100) : 100,
          currentScenarioId: meta.scenarioId,
        });
      },
    });
  });
}

function queueScenarioReplay(scenarioId) {
  const registry = loadRegistry();
  const scenario = registry.find((item) => item.id === scenarioId);
  if (!scenario) throw new Error('Cenário não encontrado');
  return enqueueExecution('replay', { scenarioId }, async (executionId) => {
    return runMesh({
      executionId,
      scenarioIds: [scenarioId],
      autoReplayOnFailure: false,
      onLog(log) {
        appendLog(executionId, log.message, log.level, log);
      },
      onScenarioStart(meta) {
        updateExecution(executionId, {
          progress: meta.total > 0 ? Math.round(((meta.index - 1) / meta.total) * 100) : 0,
          currentScenarioId: meta.scenarioId,
        });
      },
      onScenarioComplete(meta) {
        updateExecution(executionId, {
          progress: 100,
          currentScenarioId: meta.scenarioId,
        });
      },
    });
  });
}

function getQueuedExecutionStatus(executionId) {
  return getExecutionById(executionId);
}

function getMeshSchedulerStatus() {
  return buildScheduleStatus();
}

async function runScheduled(kind) {
  return runScheduledMesh(kind);
}

module.exports = {
  getRegistry,
  refreshMeshRegistry,
  getLatestExecution,
  getMeshHistory,
  getExecutionById,
  queueMeshRun,
  queueScenarioReplay,
  getQueuedExecutionStatus,
  getMeshSchedulerStatus,
  getAllExecutions,
  runScheduled,
};
