'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const { loadRegistry, refreshRegistry, runMesh, loadHistory, normalizeExecutionRecord } = require('../../qa-mesh/meshRunner');
const { buildScheduleStatus, runScheduledMesh, startScheduler, setSchedulerEnabled } = require('../../qa-mesh/meshScheduler');
const { enqueueExecution, getExecution, getAllExecutions, appendLog, updateExecution } = require('../../qa-mesh/executionQueue');
const { emitEvent } = require('./websocketService');
const qaWavesLogger = require('../utils/qaWavesLogger');
const logger = require('../utils/logger');
const { belongsToTenant, normalizeTenantKey } = require('../../lib/rpaSecurity');
const meshLease = require('../../qa-mesh/meshLease');

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
//
// A AUTORIDADE de posse é o LEASE COM HEARTBEAT (`qa-mesh/meshLease.js`), nunca
// o PID nem a idade do mtime do arquivo. Defeitos reais corrigidos (2026-09-26):
//   - PID reciclado por processo não relacionado mantinha o lock ATIVO para
//     sempre (mesh wedged);
//   - `cleanStaleLocks` do runner apagava por mtime o lock de um mesh SAUDÁVEL e
//     em andamento, permitindo duas execuções concorrentes na mesma malha.
let meshLeaseInstanceId = null;

function isMeshAlreadyRunning() {
  const lock = meshLease.readLease(MESH_RUNNING_LOCK_PATH);
  if (lock) {
    const decision = meshLease.decideMeshLease(lock, {
      nowMs: Date.now(),
      // corroboração de diagnóstico: NÃO decide a posse
      pidAlive: meshLease.isPidAlive(lock.pid),
    });
    if (decision.running) {
      return {
        running: true,
        reason: decision.reason,
        details: lock,
        leaseState: decision.state,
        heartbeatAgeMs: decision.heartbeatAgeMs,
      };
    }
    // Posse expirada por ausência de heartbeat (mesmo com PID vivo — pode ser
    // reciclado): libera o lease. Quem decide é o LEASE.
    meshLease.releaseLease(MESH_RUNNING_LOCK_PATH);
    return {
      running: false,
      reason: decision.reason,
      pidAlive: decision.pidAlive,
      heartbeatAgeMs: decision.heartbeatAgeMs,
    };
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
  meshLeaseInstanceId = meshLease.newInstanceId();
  return meshLease.acquireLease(MESH_RUNNING_LOCK_PATH, meshLease.buildLeasePayload({ instanceId: meshLeaseInstanceId }));
}

/** Renova a posse. Sem heartbeat, o lease expira e outro run pode assumir. */
function heartbeatMeshLock() {
  if (!meshLeaseInstanceId) return false;
  return meshLease.heartbeatLease(MESH_RUNNING_LOCK_PATH, { instanceId: meshLeaseInstanceId });
}

function releaseMeshLock() {
  const released = meshLease.releaseLease(MESH_RUNNING_LOCK_PATH, { instanceId: meshLeaseInstanceId });
  meshLeaseInstanceId = null;
  return released;
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
  if (options.tenantId != null) {
    const tenantId = normalizeTenantKey(options.tenantId);
    history = history.filter((item) => belongsToTenant(item, tenantId));
  }
  return history.slice(0, limit);
}

function getExecutionById(executionId, options = {}) {
  if (!executionId) return null;
  const live = getExecution(executionId);
  const tenantId = options?.tenantId == null ? null : normalizeTenantKey(options.tenantId);
  if (live) return tenantId == null || belongsToTenant(live, tenantId) ? live : null;
  const filePath = path.join(__dirname, '../../qa-mesh/meshHistory', `${executionId}.json`);
  if (!fs.existsSync(filePath)) return null;
  const execution = normalizeExecutionRecord(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  return tenantId == null || belongsToTenant(execution, tenantId) ? execution : null;
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
      executionOrigin: options.executionOrigin || 'manual_run',
      closeGovernanceDbAfterIntegration: false,
      scenarioIds: options.scenarioIds,
      tenantId,
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
  // Alinhado com queueMeshRun: tenant ausente → null explícito (escopo resolvido
  // downstream), nunca fallback silencioso para 'system'.
  const tenantId = options.tenantId == null ? null : normalizeTenantKey(options.tenantId);
  return enqueueExecution('replay', { scenarioId, tenantId }, async (executionId) => {

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
      tenantId,
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

function getQueuedExecutionStatus(executionId, tenantId = null) {
  return getExecutionById(executionId, tenantId == null ? {} : { tenantId });
}

function getMeshSchedulerStatus() {
  return buildScheduleStatus();
}

function setMeshSchedulerEnabled(enabled, frequencyKey) {
  return setSchedulerEnabled(enabled, frequencyKey);
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
  setMeshSchedulerEnabled,
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
