'use strict';

const fs = require('fs');
const path = require('path');
const qaMeshService = require('./qaMeshService');
const { getRpaReplayDir } = require('../../lib/rpaPathResolver');
const { clearExecutions } = require('../../qa-mesh/executionQueue');
const logger = require('../utils/logger');
const { emitEvent } = require('./websocketService');

const ROOT_DIR = path.join(__dirname, '..', '..');
const EVIDENCE_ROOT = path.join(ROOT_DIR, 'qa-mesh', 'meshEvidence');
const MESH_REGISTRY_PATH = path.join(ROOT_DIR, 'qa-mesh', 'meshRegistry.json');

let _meshRegistryCache = null;
function getMeshRegistry() {
  if (_meshRegistryCache) return _meshRegistryCache;
  try {
    _meshRegistryCache = JSON.parse(fs.readFileSync(MESH_REGISTRY_PATH, 'utf8'));
  } catch (_) {
    _meshRegistryCache = [];
  }
  return _meshRegistryCache;
}

function resolvePlatformAdapter(platformScenarioIds = []) {
  if (platformScenarioIds.length === 0) return 'unknown';
  const registry = getMeshRegistry();
  const adapters = platformScenarioIds.map((id) => {
    const entry = registry.find((r) => r.id === id);
    if (!entry) {
      logger.error('[QaWavesExecutionService] Cenário não encontrado no mesh registry', {
        scenarioId: id,
        registryIds: registry.map((r) => r.id),
      });
      const error = new Error(`Cenário "${id}" não encontrado no mesh registry. Verifique platformScenarioIds.`);
      error.code = 'INVALID_PLATFORM_SCENARIO_ID';
      throw error;
    }
    return entry.adapter || 'api';
  });
  // Se qualquer cenário usa rpa, considera rpa; senão api
  return adapters.includes('rpa') ? 'rpa' : (adapters[0] || 'api');
}
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_MAX_POLLS = 120;

// Cache do índice de replays com validação por mtime
let replayArtifactsIndexCache = null;
let replayArtifactsIndexCacheMtime = null;
const REPLAY_ARTIFACT_PREFIX_BYTES = 16 * 1024;
const replayArtifactMetaCache = new Map();

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function readFilePrefix(filePath, maxBytes = REPLAY_ARTIFACT_PREFIX_BYTES) {
  let fd;
  try {
    const stats = fs.statSync(filePath);
    const bytesToRead = Math.max(0, Math.min(Number(stats.size) || 0, maxBytes));
    if (bytesToRead === 0) return '';
    const buffer = Buffer.alloc(bytesToRead);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, bytesToRead, 0);
    return buffer.toString('utf8');
  } catch (_) {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (_) {
        // noop
      }
    }
  }
}

function extractJsonStringField(prefix, key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const match = pattern.exec(prefix);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch (_) {
    return match[1];
  }
}

function buildReplayArtifactMeta(replay) {
  if (!replay || typeof replay !== 'object') return null;
  const executionId = replay.executionId || null;
  if (!executionId) return null;
  return {
    executionId,
    replayId: replay.replayId || replay.id || null,
    waveId: replay.waveId || null,
    journeyId: replay.journeyId || null,
    journeyStep: replay.journeyStep || null,
    scenarioId: replay.scenarioId || null,
    seedId: replay.seedId || null,
    status: replay.status || null,
    finishedAt: replay.finishedAt || null,
    platformAdapter: replay.platformAdapter || null,
  };
}

function extractReplayArtifactMeta(filePath) {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch (_) {
    return null;
  }

  const cacheKey = `${filePath}:${stats.mtimeMs}:${stats.size}`;
  const cached = replayArtifactMetaCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const prefix = readFilePrefix(filePath);
  const fastMeta = buildReplayArtifactMeta({
    executionId: extractJsonStringField(prefix, 'executionId'),
    replayId: extractJsonStringField(prefix, 'replayId') || extractJsonStringField(prefix, 'id'),
    waveId: extractJsonStringField(prefix, 'waveId'),
    journeyId: extractJsonStringField(prefix, 'journeyId'),
    journeyStep: extractJsonStringField(prefix, 'journeyStep'),
    scenarioId: extractJsonStringField(prefix, 'scenarioId'),
    seedId: extractJsonStringField(prefix, 'seedId'),
    status: extractJsonStringField(prefix, 'status'),
    finishedAt: extractJsonStringField(prefix, 'finishedAt'),
    platformAdapter: extractJsonStringField(prefix, 'platformAdapter'),
  });

  const meta = fastMeta || buildReplayArtifactMeta(safeReadJson(filePath, null));
  replayArtifactMetaCache.clear();
  replayArtifactMetaCache.set(cacheKey, meta);
  return meta;
}

function safeWriteJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function writeReplayArtifact({ executionId, replayId, scenario, seed, status = 'running', platformScenarioIds = [] }) {
  const replayDir = getRpaReplayDir();
  ensureDir(replayDir);
  const startedAt = nowIso();
  const scenarioName = scenario.name || scenario.title || scenario.id;
  const journeyId = scenario.journeyId || scenario.journey || null;
  const journeySteps = Array.isArray(scenario.journeySteps) ? scenario.journeySteps : [];
  const payload = {
    id: replayId,
    replayId,
    recordingId: scenario.id,
    type: 'qa_wave_rpa_replay',
    executionId,
    executionStatus: 'running',
    waveId: scenario.waveId,
    journeyId,
    journeySteps,
    journeyStep: journeySteps[0] || null,
    scenarioId: scenario.id,
    platformScenarioIds,
    platformAdapter: resolvePlatformAdapter(platformScenarioIds),
    scenarioName,
    stepId: scenario.steps?.[0]?.id || null,
    seedId: seed?.id || null,
    source: scenario.source,
    status,
    startedAt,
    finishedAt: null,
    durationMs: 0,
    latency: null,
    timeline: [],
    actions: [],
    logs: [],
    errors: [],
    steps: [],
    assertions: Array.isArray(scenario.validators)
      ? scenario.validators.map((validator, index) => ({
        id: validator.id || `assertion_${index + 1}`,
        type: validator.type || 'validator',
        expected: validator.expected || null,
        status: 'pending',
      }))
      : [],
    screenshots: [],
    semanticSteps: Array.isArray(scenario.semanticSteps) ? scenario.semanticSteps : (scenario.steps || []),
    tags: {
      waveId: scenario.waveId,
      journey: journeyId,
      scenario: scenario.id,
      seed: seed?.id || null,
      source: scenario.source,
      vertical: scenario.vertical,
    },
    mode: 'qa_waves_real',
    startTime: startedAt,
    endTime: null,
    result: status,
  };

  const fullPath = path.join(replayDir, `${replayId}.json`);
  safeWriteJson(fullPath, payload);
  return { replayId, path: fullPath, payload, scenario, seed };
}

function updateReplayArtifact(replayArtifact, patch = {}) {
  const current = safeReadJson(replayArtifact.path, replayArtifact.payload) || replayArtifact.payload;
  const merged = {
    ...current,
    ...patch,
  };
  safeWriteJson(replayArtifact.path, merged);
  replayArtifact.payload = merged;
  return merged;
}

function buildResultLatency(result, execution) {
  if (Number.isFinite(Number(result?.latency))) return Number(result.latency);
  const startedAt = result?.startedAt || execution?.startedAt || null;
  const finishedAt = result?.finishedAt || execution?.finishedAt || null;
  if (!startedAt || !finishedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

function findMeshResult(execution, platformScenarioIds = []) {
  const results = Array.isArray(execution?.results) ? execution.results : [];
  const matched = results.find((result) => platformScenarioIds.includes(result?.id));
  
  if (matched) return matched;
  
  // Se não encontrar correspondência exata com platformScenarioIds, é erro de correlação
  if (results.length > 0 && platformScenarioIds.length > 0) {
    logger.warn('[QaWavesExecutionService] Falha na correlação de resultado', {
      platformScenarioIds,
      availableResultIds: results.map((r) => r?.id),
      warning: 'Nenhum resultado encontrado para os cenários solicitados. Retornando null.',
    });
    return null;
  }
  
  // Se há resultados mas nenhum ID foi solicitado, retorna o primeiro (aceitável em contextos heurísticos)
  return results[0] || null;
}

function mapExecutionStatus(execution, result) {
  const raw = String(result?.status || execution?.status || '').toLowerCase();
  if (raw === 'passed' || raw === 'completed' || raw === 'success') {
    return { replayStatus: 'completed', publicResult: 'success', evidenceStatus: 'passed' };
  }
  if (raw === 'failed' || raw === 'error' || raw === 'failure') {
    return { replayStatus: 'failed', publicResult: 'failed', evidenceStatus: 'failed' };
  }
  return { replayStatus: 'failed', publicResult: 'failed', evidenceStatus: 'failed' };
}

function buildReplayPatch(replayArtifact, execution) {
  const result = findMeshResult(execution, replayArtifact.payload.platformScenarioIds || []);
  const status = mapExecutionStatus(execution, result);
  const finishedAt = execution?.finishedAt || result?.finishedAt || nowIso();
  const startedAt = replayArtifact.payload.startedAt || execution?.startedAt || nowIso();
  const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  const latency = buildResultLatency(result, execution);
  const errors = Array.isArray(result?.errors)
    ? result.errors
    : (execution?.error ? [{ message: execution.error }] : []);

  // Extrai screens/screenshots do replay gerado pelo RpaTestRunner (rpaAdapter).
  // O artifact sem summaryType é o do rpaAdapter (o sintético do meshRunner tem summaryType).
  const rpaReplayArtifact = Array.isArray(result?.artifacts)
    ? result.artifacts.find((a) => a.type === 'replay' && !a.summaryType)
    : null;
  let screens = [];
  let screenshots = [];
  if (rpaReplayArtifact?.path) {
    const rpaReplayData = safeReadJson(rpaReplayArtifact.path, null);
    if (rpaReplayData) {
      screens = Array.isArray(rpaReplayData.screens) ? rpaReplayData.screens : [];
      screenshots = screens
        .map((s) => s.screenshot)
        .filter((s) => typeof s === 'string' && s.length > 0);
    }
  }

  return {
    executionStatus: String(execution?.status || 'completed').toLowerCase(),
    status: status.replayStatus,
    result: status.publicResult,
    finishedAt,
    endTime: finishedAt,
    durationMs,
    latency,
    steps: Array.isArray(replayArtifact.scenario.semanticSteps)
      ? replayArtifact.scenario.semanticSteps
      : (replayArtifact.scenario.steps || []),
    logs: Array.isArray(result?.logs) ? result.logs : [],
    timeline: Array.isArray(result?.logs) ? result.logs : [],
    errors,
    assertions: Array.isArray(replayArtifact.payload.assertions)
      ? replayArtifact.payload.assertions.map((assertion) => ({
        ...assertion,
        status: status.evidenceStatus === 'passed' ? 'passed' : 'failed',
      }))
      : [],
    meshExecution: {
      executionId: execution?.executionId || null,
      historyPath: execution?.historyPath || null,
      summary: execution?.summary || null,
      resultId: result?.id || null,
      scenarioContext: execution?.payload?.scenarioContext || [],
    },
    screens,
    screenshots,
    screenCount: screens.length,
  };
}

function writeEvidenceArtifact(replayArtifact, execution) {
  const result = findMeshResult(execution, replayArtifact.payload.platformScenarioIds || []);
  const status = mapExecutionStatus(execution, result);
  const waveId = replayArtifact.scenario.waveId;
  const evidenceDir = path.join(EVIDENCE_ROOT, waveId);
  ensureDir(evidenceDir);
  const fileName = `${execution.executionId}${replayArtifact.seed?.id ? `__${replayArtifact.seed.id}` : ''}.json`;
  const fullPath = path.join(evidenceDir, fileName);
  const payload = {
    executionId: execution.executionId,
    scenarioId: replayArtifact.scenario.id,
    waveId,
    journeyId: replayArtifact.scenario.journeyId || replayArtifact.scenario.journey || null,
    journeyStep: replayArtifact.scenario.journeySteps?.[0] || null,
    journeySteps: Array.isArray(replayArtifact.scenario.journeySteps) ? replayArtifact.scenario.journeySteps : [],
    seedId: replayArtifact.seed?.id || null,
    status: status.evidenceStatus,
    steps: Array.isArray(replayArtifact.scenario.semanticSteps)
      ? replayArtifact.scenario.semanticSteps
      : (replayArtifact.scenario.steps || []),
    latency: buildResultLatency(result, execution),
    errors: Array.isArray(result?.errors)
      ? result.errors
      : (execution?.error ? [{ message: execution.error }] : []),
    generatedAt: nowIso(),
    replayId: replayArtifact.replayId,
    historyPath: execution?.historyPath || null,
  };

  safeWriteJson(fullPath, payload);
  return { filePath: fullPath, payload };
}

function finalizeExecutionArtifacts(execution, replayArtifacts = []) {
  return replayArtifacts.map((replayArtifact) => {
    const replay = updateReplayArtifact(replayArtifact, buildReplayPatch(replayArtifact, execution));
    const evidence = writeEvidenceArtifact(replayArtifact, execution);
    return { replay, evidence };
  });
}

function monitorExecution(executionId, replayArtifacts, options = {}) {
  const pollIntervalMs = Number(options.pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = Number(options.maxPolls) || DEFAULT_MAX_POLLS;
  const tenantId = options.tenantId || null;
  let attempts = 0;

  function emitWsUpdate(status, extra = {}) {
    const firstArtifact = replayArtifacts[0];
    emitEvent('qa-waves.execution.updated', {
      executionId,
      status,
      waveId: firstArtifact?.scenario?.waveId || null,
      journeyId: firstArtifact?.scenario?.journeyId || firstArtifact?.scenario?.journey || null,
      replayIds: replayArtifacts.map((a) => a.replayId),
      ...extra,
    }, { tenantId });
  }

  function poll() {
    attempts += 1;
    const execution = qaMeshService.getQueuedExecutionStatus(executionId);

    if (!execution) {
      if (attempts >= maxPolls) {
        finalizeExecutionArtifacts({
          executionId,
          status: 'failed',
          finishedAt: nowIso(),
          error: 'Execução não encontrada para reconciliar replay QA Waves',
          results: [],
        }, replayArtifacts);
        emitWsUpdate('failed', { error: 'execution_not_found' });
        return;
      }
      setTimeout(poll, pollIntervalMs);
      return;
    }

    const rawStatus = String(execution.status || '').toLowerCase();
    if (rawStatus === 'queued' || rawStatus === 'running' || rawStatus === 'processing') {
      if (attempts >= maxPolls) {
        finalizeExecutionArtifacts({
          ...execution,
          status: 'failed',
          finishedAt: nowIso(),
          error: 'Timeout aguardando execução QA Waves',
        }, replayArtifacts);
        emitWsUpdate('failed', { error: 'timeout' });
        return;
      }
      setTimeout(poll, pollIntervalMs);
      return;
    }

    finalizeExecutionArtifacts(execution, replayArtifacts);
    const finalStatus = String(execution.status || 'completed').toLowerCase();
    emitWsUpdate(finalStatus);
  }

  setTimeout(poll, pollIntervalMs);
}

function executePreparedWaveScenarios({ expanded, platformScenarioIds, governanceFindings, tenantId = null }) {
  const scenarioContext = expanded.map(({ scenario, seed }) => ({
    scenarioId: scenario.id,
    seedId: seed?.id || null,
    waveId: scenario.waveId,
    journeyId: scenario.journeyId || scenario.journey || null,
    journeySteps: Array.isArray(scenario.journeySteps) ? scenario.journeySteps : [],
    semanticSteps: Array.isArray(scenario.semanticSteps) ? scenario.semanticSteps : (scenario.steps || []),
  }));

  logger.info('[QA_WAVE_EXECUTION] Enfileirando execucao QA Waves', {
    scenarioCount: expanded.length,
    platformScenarioIds,
    scenarioContext,
  });

  const queued = qaMeshService.queueMeshRun({
    scenarioIds: platformScenarioIds,
    executionOrigin: 'qa_waves_real',
    scenarioContext,
  });

  const replayArtifacts = expanded.map(({ scenario, seed }) => writeReplayArtifact({
    executionId: queued.executionId,
    replayId: makeId('qa_wave_replay'),
    scenario,
    seed,
    status: 'running',
    platformScenarioIds,
  }));

  logger.info('[QA_REPLAY_LINKED] Replay(s) vinculados a execucao QA Waves', {
    executionId: queued.executionId,
    replayIds: replayArtifacts.map((item) => item.replayId),
    scenarioContext,
  });

  emitEvent('qa-waves.execution.started', {
    executionId: queued.executionId,
    scenarioCount: expanded.length,
    platformScenarioIds,
  }, { tenantId });

  monitorExecution(queued.executionId, replayArtifacts, { tenantId });

  return {
    executionId: queued.executionId,
    replayId: replayArtifacts[0]?.replayId || null,
    replayIds: replayArtifacts.map((item) => item.replayId),
    platformScenarioIds,
    governance: governanceFindings,
  };
}

function buildReplayArtifactsIndex(executionIds = null) {
  const replayDir = getRpaReplayDir();
  const byExecutionId = new Map();
  
  if (!fs.existsSync(replayDir)) {
    return { byExecutionId, scannedFiles: 0, indexedFiles: 0 };
  }

  // Validar cache com mtime do diretório
  let dirStats;
  try {
    dirStats = fs.statSync(replayDir);
  } catch (_) {
    return { byExecutionId, scannedFiles: 0, indexedFiles: 0 };
  }
  
  const dirCacheKey = `${replayDir}:${dirStats.mtimeMs}`;
  if (
    replayArtifactsIndexCache &&
    replayArtifactsIndexCacheMtime === dirCacheKey &&
    (!executionIds || executionIds.size === 0)
  ) {
    // Cache válido: retornar sem rescanear
    return replayArtifactsIndexCache;
  }

  const targetExecutionIds = executionIds instanceof Set ? executionIds : null;
  if (targetExecutionIds && targetExecutionIds.size === 0) {
    return { byExecutionId, scannedFiles: 0, indexedFiles: 0 };
  }

  let scannedFiles = 0;
  let indexedFiles = 0;

  fs.readdirSync(replayDir)
    .filter((fileName) => fileName.endsWith('.json'))
    .forEach((fileName) => {
      scannedFiles += 1;
      const replay = extractReplayArtifactMeta(path.join(replayDir, fileName));
      if (!replay) return;
      const executionId = replay.executionId;
      if (!executionId) return;
      if (targetExecutionIds && !targetExecutionIds.has(executionId)) return;
      const existing = byExecutionId.get(executionId) || [];
      existing.push({
        replayId: replay.replayId,
        waveId: replay.waveId || null,
        journeyId: replay.journeyId || null,
        journeyStep: replay.journeyStep || null,
        scenarioId: replay.scenarioId || null,
        seedId: replay.seedId || null,
        status: replay.status || null,
        finishedAt: replay.finishedAt || null,
        platformAdapter: replay.platformAdapter || null,
      });
      byExecutionId.set(executionId, existing);
      indexedFiles += 1;
    });

  const result = { byExecutionId, scannedFiles, indexedFiles };
  
  // Armazenar em cache apenas se não há filtro de executionIds (full index)
  if (!targetExecutionIds) {
    replayArtifactsIndexCache = result;
    replayArtifactsIndexCacheMtime = dirCacheKey;
  }

  return result;
}

function listWaveExecutions(limit = 20) {
  const executions = qaMeshService.getAllExecutions(limit)
    .filter((execution) => execution?.payload?.executionOrigin === 'qa_waves_real')
  const executionIds = new Set(executions.map((execution) => execution.executionId).filter(Boolean));
  const startedAt = Date.now();
  const { byExecutionId: replayArtifactsIndex, scannedFiles, indexedFiles } = buildReplayArtifactsIndex(executionIds);
  const elapsedMs = Date.now() - startedAt;

  if (elapsedMs >= 1000) {
    qaMeshService.logger?.warn?.('[QaWavesExecutionService] listWaveExecutions lento', {
      elapsedMs,
      limit,
      executionCount: executions.length,
      scannedFiles,
      indexedFiles,
    });
  }

  return executions
    .map((execution) => ({
      ...execution,
      replayArtifacts: replayArtifactsIndex.get(execution.executionId) || [],
    }));
}

function clearWaveExecutions() {
  // 1. Limpa a fila em memória
  clearExecutions();

  // 2. Remove arquivos de meshHistory
  const meshHistoryDir = path.join(ROOT_DIR, 'qa-mesh', 'meshHistory');
  if (fs.existsSync(meshHistoryDir)) {
    for (const file of fs.readdirSync(meshHistoryDir)) {
      try {
        fs.unlinkSync(path.join(meshHistoryDir, file));
      } catch (_) { /* ignora */ }
    }
  }

  return { cleared: true };
}

module.exports = {
  executePreparedWaveScenarios,
  listWaveExecutions,
  clearWaveExecutions,
  writeReplayArtifact,
  updateReplayArtifact,
  writeEvidenceArtifact,
  finalizeExecutionArtifacts,
  monitorExecution,
};