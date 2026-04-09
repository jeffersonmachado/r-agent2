'use strict';

const fs = require('fs');
const path = require('path');
const { loadRegistry, refreshRegistry, runMesh, loadHistory } = require('../../qa-mesh/meshRunner');
const { buildScheduleStatus, runScheduledMesh, startScheduler } = require('../../qa-mesh/meshScheduler');
const { enqueueExecution, getExecution, getAllExecutions, appendLog, updateExecution } = require('../../qa-mesh/executionQueue');

const ROOT_DIR = path.join(__dirname, '..', '..');
const STABILITY_SNAPSHOT_PATH = path.join(ROOT_DIR, 'qa/mesh/intelligence/stabilitySnapshot.json');
const STABILITY_HISTORY_INDEX_PATH = path.join(ROOT_DIR, 'qa/mesh/intelligence/history/index.json');
const CHECKPOINT_WAVES_DIR = path.join(ROOT_DIR, 'qa/checkpoints/waves');
const CHECKPOINT_PROGRESS_PATH = path.join(ROOT_DIR, 'qa/checkpoints/state/progress.json');
const CHECKPOINT_FAILURES_PATH = path.join(ROOT_DIR, 'qa/checkpoints/state/failures.json');
const LEARN_BASE_DIR = path.join(ROOT_DIR, 'qa/mesh/intelligence/learning');

if (process.env.RUNNING_IN_PIPELINE !== '1' && process.env.QA_MESH_DISABLE_SCHEDULER !== '1') {
  startScheduler();
}

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

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function getStabilitySnapshot() {
  return safeReadJson(STABILITY_SNAPSHOT_PATH, {
    generatedAt: null,
    global: {
      stabilityScore: 0,
      releaseReadiness: 0,
      flakyRate: 0,
      replayConsistency: 0,
      criticalFlowSuccess: 0,
    },
    domains: [],
    channels: [],
    verticals: [],
    failures: [],
    releaseGate: {
      backendBuild: 'unknown',
      frontendBuild: 'unknown',
      technicalQA: 'unknown',
      businessQA: 'unknown',
      criticalReplay: 'unknown',
      artifactIntegrity: 'unknown',
    },
  });
}

function getStabilityHistory() {
  return safeReadJson(STABILITY_HISTORY_INDEX_PATH, { snapshots: [] });
}

function getStabilityFailures() {
  const snapshot = getStabilitySnapshot();
  return {
    generatedAt: snapshot.generatedAt,
    failures: Array.isArray(snapshot.failures) ? snapshot.failures : [],
  };
}

function getCheckpointsOverview() {
  const progress = safeReadJson(CHECKPOINT_PROGRESS_PATH, {
    currentWave: null,
    completedWaves: [],
    failedWaves: [],
    globalStatus: 'running',
    lastSuccessfulCheckpoint: null,
  });
  const failures = safeReadJson(CHECKPOINT_FAILURES_PATH, { failures: [] });

  const waves = fs.existsSync(CHECKPOINT_WAVES_DIR)
    ? fs.readdirSync(CHECKPOINT_WAVES_DIR)
      .filter((file) => file.endsWith('.json'))
      .map((file) => safeReadJson(path.join(CHECKPOINT_WAVES_DIR, file), null))
      .filter(Boolean)
    : [];

  return {
    progress,
    waves,
    failures: failures.failures || [],
  };
}

function getCheckpointByWaveId(wave) {
  const filePath = path.join(CHECKPOINT_WAVES_DIR, `${String(wave || '').toUpperCase()}.json`);
  if (!fs.existsSync(filePath)) return null;
  return safeReadJson(filePath, null);
}

function getLearnFile(fileName, fallback) {
  return safeReadJson(path.join(LEARN_BASE_DIR, fileName), fallback);
}

function getLearnSummary() {
  const ranked = getLearnFile('failures.ranked.json', { ranked: [] });
  const suggestions = getLearnFile('fixSuggestions.json', { suggestions: [] });
  const plans = getLearnFile('fixPlans.json', { plans: [] });
  const memory = getLearnFile('learningMemory.json', { stats: {} });
  return {
    generatedAt: new Date().toISOString(),
    ranked: ranked.ranked.length,
    suggestions: suggestions.suggestions.length,
    plans: plans.plans.length,
    memory: memory.stats || {},
  };
}

function getLearnFailures() {
  return getLearnFile('failures.ranked.json', { ranked: [] });
}

function getLearnSuggestions() {
  return getLearnFile('fixSuggestions.json', { suggestions: [] });
}

function getLearnPlans() {
  return getLearnFile('fixPlans.json', { plans: [] });
}

function getLearnMemory() {
  return getLearnFile('learningMemory.json', { entries: [], stats: {} });
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
  getStabilitySnapshot,
  getStabilityHistory,
  getStabilityFailures,
  getCheckpointsOverview,
  getCheckpointByWaveId,
  getLearnSummary,
  getLearnFailures,
  getLearnSuggestions,
  getLearnPlans,
  getLearnMemory,
};
