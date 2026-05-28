'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const { isInPipeline } = require('../../pipeline/guard');
const { loadRegistry, refreshRegistry, runMesh, loadHistory, normalizeExecutionRecord } = require('../../qa-mesh/meshRunner');
const { buildScheduleStatus, runScheduledMesh, startScheduler } = require('../../qa-mesh/meshScheduler');
const { enqueueExecution, getExecution, getAllExecutions, appendLog, updateExecution } = require('../../qa-mesh/executionQueue');
const { emitEvent } = require('./websocketService');
const qaWavesLogger = require('../utils/qaWavesLogger');
const logger = require('../utils/logger');

const ROOT_DIR = path.join(__dirname, '..', '..');
const MESH_RUNNING_LOCK_PATH = path.join(ROOT_DIR, 'qa-mesh', 'mesh-running.lock');
const STABILITY_SNAPSHOT_PATH = path.join(ROOT_DIR, 'qa/mesh/intelligence/stabilitySnapshot.json');
const STABILITY_HISTORY_INDEX_PATH = path.join(ROOT_DIR, 'qa/mesh/intelligence/history/index.json');
const CHECKPOINT_WAVES_DIR = path.join(ROOT_DIR, 'qa/checkpoints/waves');
const CHECKPOINT_PROGRESS_PATH = path.join(ROOT_DIR, 'qa/checkpoints/state/progress.json');
const CHECKPOINT_FAILURES_PATH = path.join(ROOT_DIR, 'qa/checkpoints/state/failures.json');
const LEARN_BASE_DIR = path.join(ROOT_DIR, 'qa/mesh/intelligence/learning');
const QA_MESH_GO_NO_GO_PATH = path.join(ROOT_DIR, 'qa-mesh', 'go-no-go-report.json');
const QA_MESH_RELEASE_GATE_PATH = path.join(ROOT_DIR, 'qa-mesh', 'release-gate-report.json');

// ── Proteção contra execuções simultâneas ──

function isMeshAlreadyRunning() {
  if (fs.existsSync(MESH_RUNNING_LOCK_PATH)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(MESH_RUNNING_LOCK_PATH, 'utf8'));
      try {
        process.kill(lockData.pid, 0);
        return { running: true, reason: 'lock_active', details: lockData };
      } catch (_) {
        fs.unlinkSync(MESH_RUNNING_LOCK_PATH);
        return { running: false, reason: 'stale_lock_cleared' };
      }
    } catch (_) {
      try { fs.unlinkSync(MESH_RUNNING_LOCK_PATH); } catch (__) {}
      return { running: false, reason: 'corrupt_lock_cleared' };
    }
  }

  try {
    const procs = execSync(
      'ps aux | grep "meshRunner\\.js" | grep -v grep | grep -v meshScheduler',
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    if (procs) {
      const pids = procs.split('\n').map(l => l.trim().split(/\s+/)[1]).filter(Boolean);
      return { running: true, reason: 'process_found', pids };
    }
  } catch (_) { /* ps falhou, ignora */ }

  return { running: false, reason: 'clear' };
}

function acquireMeshLock() {
  fs.writeFileSync(MESH_RUNNING_LOCK_PATH, JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    host: os.hostname(),
  }, null, 2), 'utf8');
}

function releaseMeshLock() {
  try { fs.unlinkSync(MESH_RUNNING_LOCK_PATH); } catch (_) {}
}

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
  if (options.officialOnly) {
    history = history.filter((item) => item?.executionOrigin === 'pipeline' && item?.isCanonicalExecution === true);
  }
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
  return normalizeExecutionRecord(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function getOfficialReference() {
  const goNoGo = safeReadJson(QA_MESH_GO_NO_GO_PATH, null);
  const releaseGate = safeReadJson(QA_MESH_RELEASE_GATE_PATH, null);
  const executionId = releaseGate?.executionId || goNoGo?.executionId || null;

  if (!executionId) {
    return null;
  }

  const execution = getExecutionById(executionId);

  return {
    executionId,
    gate: releaseGate?.gate || goNoGo?.status || execution?.summary?.goNoGo || 'N/A',
    status: goNoGo?.status || releaseGate?.gate || execution?.summary?.goNoGo || 'N/A',
    reasons: goNoGo?.reasons || releaseGate?.reasons || execution?.summary?.reasons || [],
    historyPath: execution?.historyPath || path.join(ROOT_DIR, 'qa-mesh', 'meshHistory', `${executionId}.json`),
    reportPaths: {
      goNoGo: QA_MESH_GO_NO_GO_PATH,
      releaseGate: QA_MESH_RELEASE_GATE_PATH,
    },
    execution: execution || null,
  };
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

function toPublicExecutionStatus(rawStatus) {
  const value = String(rawStatus || '').toLowerCase();
  if (value === 'completed') return 'success';
  if (value === 'failed') return 'failed';
  return 'processing';
}

function buildExecutionRealtimePayload(executionId) {
  const execution = getExecution(executionId);
  if (!execution) return null;

  const startedAt = execution.startedAt || execution.createdAt || null;
  const finishedAt = execution.finishedAt || null;
  const durationMs = startedAt
    ? (finishedAt
      ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
      : Math.max(0, Date.now() - new Date(startedAt).getTime()))
    : 0;

  const currentScenarioId = execution.currentScenarioId || null;
  const currentStepLabel = typeof execution.currentStep === 'string'
    ? execution.currentStep.trim()
    : '';

  return {
    executionId,
    source: 'qa_waves',
    status: toPublicExecutionStatus(execution.status),
    progress: Number.isFinite(execution.progress) ? Math.max(0, Math.min(100, Number(execution.progress))) : 0,
    startedAt,
    finishedAt,
    durationMs,
    summary: execution.summary || null,
    currentStep: (currentScenarioId || currentStepLabel)
      ? {
        scenarioId: currentScenarioId,
        scenarioName: currentScenarioId,
        label: currentStepLabel || null,
        status: toPublicExecutionStatus(execution.status),
        startedAt,
        finishedAt,
      }
      : null,
    results: Array.isArray(execution.results) ? execution.results : [],
  };
}

function emitQaWavesExecutionRealtime(executionId, tenantId, eventName = 'qa-waves.execution.updated') {
  if (!tenantId) return;
  const payload = buildExecutionRealtimePayload(executionId);
  if (!payload) return;
  emitEvent(eventName, payload, { tenantId });
}

function queueMeshRun(options = {}) {
  return enqueueExecution('run', options, async (executionId) => {
    const tenantId = options.tenantId || null;

    // ── Proteção: não inicia se já tem mesh rodando ──
    const running = isMeshAlreadyRunning();
    if (running.running) {
      logger.warn('[qaMesh] Mesh já em execução — ignorando nova solicitação', {
        executionId,
        reason: running.reason,
        details: running.details || running.pids,
      });
      return {
        skipped: true,
        reason: 'mesh_already_running',
        details: running,
      };
    }
    acquireMeshLock();

    try {
      qaWavesLogger.info(`[RUN] Iniciando execução`, { executionId, tenantId, scenarioIds: options.scenarioIds });
      const result = await runMesh({
      executionId,
      executionOrigin: 'manual_run',
      closeGovernanceDbAfterIntegration: false,
      scenarioIds: options.scenarioIds,
      domain: options.domain,
      type: options.type,
      criticality: options.criticality,
      changedFiles: options.changedFiles,
      impactOnly: options.impactOnly,
      detectChangedFiles: options.detectChangedFiles,
      autoReplayOnFailure: false,
      writeCanonicalOutputs: false,
      onLog(log) {
        appendLog(executionId, log.message, log.level, log);
      },
      onScenarioStart(meta) {
        qaWavesLogger.info(`[RUN] Cenário iniciado: ${meta.scenarioId}`, { executionId, index: meta.index, total: meta.total });
        updateExecution(executionId, {
          progress: meta.total > 0 ? Math.round(((meta.index - 1) / meta.total) * 100) : 0,
          currentScenarioId: meta.scenarioId,
        });
        emitQaWavesExecutionRealtime(executionId, tenantId);
      },
      onScenarioComplete(meta) {
        qaWavesLogger.info(`[RUN] Cenário concluído: ${meta.scenarioId}`, { executionId, index: meta.index, total: meta.total });
        updateExecution(executionId, {
          progress: meta.total > 0 ? Math.round((meta.index / meta.total) * 100) : 100,
          currentScenarioId: meta.scenarioId,
          currentStep: null,
        });
        emitQaWavesExecutionRealtime(executionId, tenantId);
      },
      onStepProgress(meta) {
        qaWavesLogger.debug(`[RUN] Step: ${meta.currentStep?.title || meta.currentStep}`, { executionId, progress: meta.progress });
        updateExecution(executionId, {
          progress: meta.progress ?? undefined,
          currentStep: meta.currentStep ?? null,
        });
        emitQaWavesExecutionRealtime(executionId, tenantId);
      },
    });
    const finalStatus = result?.summary?.goNoGo === 'NO_GO' ? 'failed' : 'completed';
    qaWavesLogger.info(`[RUN] Execução finalizada: ${finalStatus}`, { executionId, goNoGo: result?.summary?.goNoGo });
    updateExecution(executionId, {
      status: finalStatus,
      finishedAt: new Date().toISOString(),
      progress: 100,
      summary: result?.summary || null,
      results: result?.results || [],
      historyPath: result?.historyPath || null,
      evidenceDir: result?.evidenceDir || null,
      currentStep: null,
    });
    emitQaWavesExecutionRealtime(executionId, tenantId);
    return result;
    } finally {
      releaseMeshLock();
    }
  });
}

function queueScenarioReplay(scenarioId, options = {}) {
  const registry = loadRegistry();
  const scenario = registry.find((item) => item.id === scenarioId);
  if (!scenario) throw new Error('Cenário não encontrado');
  if (scenario.requiresOfficialPipeline && process.env.PIPELINE_BYPASS !== '1' && !isInPipeline()) {
    const error = new Error(
      'Este cenário exige o pipeline oficial e não pode ser reproduzido pela UI local. Execute: npm run pipeline. Para uso local explícito, use PIPELINE_BYPASS=1.'
    );
    error.code = 'PIPELINE_REQUIRED';
    throw error;
  }
  return enqueueExecution('replay', { scenarioId }, async (executionId) => {
    const tenantId = options.tenantId || null;

    // ── Proteção: não inicia replay se já tem mesh rodando ──
    const running = isMeshAlreadyRunning();
    if (running.running) {
      logger.warn('[qaMesh] Mesh já em execução — ignorando replay', {
        executionId,
        scenarioId,
        reason: running.reason,
      });
      return {
        skipped: true,
        reason: 'mesh_already_running',
        details: running,
      };
    }
    acquireMeshLock();

    try {
      qaWavesLogger.info(`[REPLAY] Iniciando replay: ${scenarioId}`, { executionId, tenantId });
      const result = await runMesh({
      executionId,
      executionOrigin: 'manual_replay',
      closeGovernanceDbAfterIntegration: false,
      scenarioIds: [scenarioId],
      autoReplayOnFailure: false,
      writeCanonicalOutputs: false,
      onLog(log) {
        appendLog(executionId, log.message, log.level, log);
      },
      onScenarioStart(meta) {
        qaWavesLogger.info(`[REPLAY] Cenário iniciado: ${meta.scenarioId}`, { executionId, index: meta.index, total: meta.total });
        updateExecution(executionId, {
          progress: meta.total > 0 ? Math.round(((meta.index - 1) / meta.total) * 100) : 0,
          currentScenarioId: meta.scenarioId,
        });
        emitQaWavesExecutionRealtime(executionId, tenantId);
      },
      onScenarioComplete(meta) {
        qaWavesLogger.info(`[REPLAY] Cenário concluído: ${meta.scenarioId}`, { executionId, index: meta.index, total: meta.total });
        updateExecution(executionId, {
          progress: 100,
          currentScenarioId: meta.scenarioId,
          currentStep: null,
        });
        emitQaWavesExecutionRealtime(executionId, tenantId);
      },
      onStepProgress(meta) {
        qaWavesLogger.debug(`[REPLAY] Step: ${meta.currentStep?.title || meta.currentStep}`, { executionId, progress: meta.progress });
        updateExecution(executionId, {
          progress: meta.progress ?? undefined,
          currentStep: meta.currentStep ?? null,
        });
        emitQaWavesExecutionRealtime(executionId, tenantId);
      },
    });
    const finalStatus = result?.summary?.goNoGo === 'NO_GO' ? 'failed' : 'completed';
    qaWavesLogger.info(`[REPLAY] Execução finalizada: ${finalStatus}`, { executionId, goNoGo: result?.summary?.goNoGo });
    updateExecution(executionId, {
      status: finalStatus,
      finishedAt: new Date().toISOString(),
      progress: 100,
      summary: result?.summary || null,
      results: result?.results || [],
      historyPath: result?.historyPath || null,
      evidenceDir: result?.evidenceDir || null,
      currentStep: null,
    });
    emitQaWavesExecutionRealtime(executionId, tenantId);
    return result;
    } finally {
      releaseMeshLock();
    }
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
  getOfficialReference,
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
