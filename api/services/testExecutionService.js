'use strict';

const fs = require('fs');
const path = require('path');
const {
  runScenarioExecution,
} = require('./qaWavesScenarioService');
const {
  getExecutionStatus: getQaWavesExecutionStatus,
} = require('./qaWavesService');
const {
  getQueuedExecutionStatus: getQaMeshQueuedExecutionStatus,
} = require('./qaMeshService');
const {
  executeRecording,
  getExecutionStatus: getRpaExecutionStatus,
  cancelExecution,
  listRecordings,
  startManualRecording,
  stopManualRecording,
  getRecordingStatus,
} = require('./rpaService');
const {
  getAllReplayReadDirs,
  getRpaReplayReadDirs,
  getRpaReportReadDirs,
} = require('../../lib/rpaPathResolver');

// Cache de metadados para listReplayFiles com validação por mtime
const REPLAY_LIST_PREFIX_BYTES = 16 * 1024;
const REPLAY_LIST_SUFFIX_BYTES = 32 * 1024;
const REPLAY_LIST_FULL_THRESHOLD = 64 * 1024 * 1024; // lê arquivo completo até 64MB (contagem precisa)
let replayListCache = null;
let replayListCacheMtimes = null;

function readFilePrefix(filePath, maxBytes = REPLAY_LIST_PREFIX_BYTES) {
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

/**
 * Lê o prefixo E sufixo de um arquivo para extração de metadados de replay.
 * Para arquivos pequenos (< REPLAY_LIST_FULL_THRESHOLD), lê o arquivo completo.
 * Retorna { prefixBuf, suffixBuf } como Buffer.
 */
function readFilePrefixAndSuffix(filePath, fileSize) {
  let fd;
  try {
    if (fileSize <= REPLAY_LIST_FULL_THRESHOLD) {
      const buffer = Buffer.alloc(fileSize);
      fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, fileSize, 0);
      return { prefixBuf: buffer, suffixBuf: buffer };
    }
    const prefixBuf = Buffer.alloc(REPLAY_LIST_PREFIX_BYTES);
    const suffixBuf = Buffer.alloc(REPLAY_LIST_SUFFIX_BYTES);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, prefixBuf, 0, REPLAY_LIST_PREFIX_BYTES, 0);
    const suffixOffset = Math.max(0, fileSize - REPLAY_LIST_SUFFIX_BYTES);
    fs.readSync(fd, suffixBuf, 0, REPLAY_LIST_SUFFIX_BYTES, suffixOffset);
    return { prefixBuf, suffixBuf };
  } catch (_) {
    return { prefixBuf: Buffer.alloc(0), suffixBuf: Buffer.alloc(0) };
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) { /* noop */ }
    }
  }
}

function countBytesPattern(buf, pattern) {
  const pat = Buffer.from(pattern, 'utf8');
  let count = 0;
  let pos = 0;
  while ((pos = buf.indexOf(pat, pos)) !== -1) {
    count++;
    pos += pat.length;
  }
  return count;
}

function extractTimingsTotal(suffixBuf) {
  const str = suffixBuf.toString('latin1');
  const m = /"timings"\s*:\s*\{[^}]*"total"\s*:\s*(\d+)/.exec(str);
  return m ? Number(m[1]) : 0;
}

/**
 * Conta objetos reais dentro do array "errors" do replay.
 * Evita falsos positivos causados por entradas de logs[].message ou logs[].error.
 * Retorna 0 se o array não estiver inteiramente no buffer (sufixo truncado).
 */
function extractErrorCount(suffixBuf) {
  const str = suffixBuf.toString('latin1');
  // Localiza "errors": [ — usa a última ocorrência pois errors fica no final
  const errIdx = str.lastIndexOf('"errors"');
  if (errIdx === -1) return 0;
  const bracketStart = str.indexOf('[', errIdx);
  if (bracketStart === -1) return 0;
  // Percorre até o ] correspondente contando objetos de topo.
  // IMPORTANTE: ignora [ e ] dentro de strings JSON para evitar contagem
  // incorreta causada por caracteres literais em stack traces/mensagens.
  let depth = 1;
  let count = 0;
  let i = bracketStart + 1;
  while (i < str.length && depth > 0) {
    const c = str[i];
    if (c === '"') {
      // Avança até o fechamento da string JSON, respeitando escapes
      i++;
      while (i < str.length) {
        if (str[i] === '\\') { i += 2; continue; }
        if (str[i] === '"') { break; }
        i++;
      }
    } else if (c === '[') {
      depth++;
    } else if (c === ']') {
      depth--;
    } else if (c === '{' && depth === 1) {
      count++;
    }
    i++;
  }
  // Se o array não fechou dentro do buffer, retorna 0 (seguro)
  return depth === 0 ? count : 0;
}

function extractJsonStringField(prefix, key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'g');
  const match = pattern.exec(prefix);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch (_) {
    return match[1];
  }
}

function makeError(message, code = 'BAD_REQUEST') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function getReplayDateTimestamp(replay) {
  const value = replay.modifiedAt || replay.modified || replay.startTime || replay.startedAt || 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getReplayDurationMs(replay) {
  const durationMs = Number(replay?.durationMs);
  if (Number.isFinite(durationMs) && durationMs > 0) return durationMs;

  const duration = Number(replay?.duration);
  if (Number.isFinite(duration) && duration > 0) return duration;

  const start = new Date(replay?.startTime || replay?.startedAt || 0).getTime();
  const end = new Date(replay?.endTime || replay?.finishedAt || 0).getTime();
  if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
    return end - start;
  }
  return 0;
}

function matchesReplayFilters(replay, filters) {
  if (filters.search) {
    const haystacks = [
      replay.filename,
      replay.replayId,
      replay.id,
      replay.recordingId,
      replay.executionId,
      replay.scenarioId,
    ].map(normalizeText);
    if (!haystacks.some((value) => value.includes(filters.search))) {
      return false;
    }
  }

  if (filters.result === 'success' && normalizeText(replay.result) !== 'success') {
    return false;
  }

  if (filters.result === 'failed') {
    const result = normalizeText(replay.result);
    if (!result || result === 'success') {
      return false;
    }
  }

  if (filters.dateRange && filters.dateRange !== 'all') {
    const replayDate = getReplayDateTimestamp(replay);
    if (!replayDate) return false;

    const cutoffDate = new Date();
    if (filters.dateRange === 'today') {
      cutoffDate.setHours(0, 0, 0, 0);
    } else if (filters.dateRange === 'week') {
      cutoffDate.setDate(cutoffDate.getDate() - 7);
    } else if (filters.dateRange === 'month') {
      cutoffDate.setDate(cutoffDate.getDate() - 30);
    }

    if (replayDate < cutoffDate.getTime()) {
      return false;
    }
  }

  return true;
}

function sortReplayFiles(replays, sortBy, sortOrder) {
  const direction = sortOrder === 'asc' ? 1 : -1;
  const list = [...replays];

  list.sort((a, b) => {
    let comparison = 0;

    if (sortBy === 'name') {
      comparison = normalizeText(a.filename).localeCompare(normalizeText(b.filename));
    } else if (sortBy === 'size') {
      comparison = (Number(a.size) || 0) - (Number(b.size) || 0);
    } else if (sortBy === 'duration') {
      comparison = getReplayDurationMs(a) - getReplayDurationMs(b);
    } else if (sortBy === 'replayId') {
      comparison = normalizeText(a.replayId || a.id).localeCompare(normalizeText(b.replayId || b.id));
    } else if (sortBy === 'executionId') {
      comparison = normalizeText(a.executionId).localeCompare(normalizeText(b.executionId));
    } else if (sortBy === 'scenarioId') {
      comparison = normalizeText(a.scenarioId).localeCompare(normalizeText(b.scenarioId));
    } else if (sortBy === 'result') {
      comparison = normalizeText(a.result).localeCompare(normalizeText(b.result));
    } else if (sortBy === 'mode') {
      comparison = normalizeText(a.mode).localeCompare(normalizeText(b.mode));
    } else if (sortBy === 'actionCount') {
      comparison = (Number(a.actionCount) || 0) - (Number(b.actionCount) || 0);
    } else if (sortBy === 'screenCount') {
      comparison = (Number(a.screenCount) || 0) - (Number(b.screenCount) || 0);
    } else if (sortBy === 'errorCount') {
      comparison = (Number(a.errorCount) || 0) - (Number(b.errorCount) || 0);
    } else if (sortBy === 'startTime') {
      comparison = new Date(a.startTime || a.startedAt || 0).getTime() - new Date(b.startTime || b.startedAt || 0).getTime();
    } else if (sortBy === 'endTime') {
      comparison = new Date(a.endTime || a.finishedAt || 0).getTime() - new Date(b.endTime || b.finishedAt || 0).getTime();
    } else {
      comparison = getReplayDateTimestamp(a) - getReplayDateTimestamp(b);
    }

    if (comparison === 0) {
      return normalizeText(a.filename).localeCompare(normalizeText(b.filename));
    }
    return direction * comparison;
  });

  return list;
}

function normalizePublicStatus(status) {
  const raw = String(status || '').toLowerCase();
  if (raw === 'queued' || raw === 'running' || raw === 'processing') return 'processing';
  if (raw === 'completed' || raw === 'success') return 'success';
  if (raw === 'failed' || raw === 'failure' || raw === 'error') return 'failed';
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled';
  return 'processing';
}

function hasFailureIndicators(execution = {}) {
  const summary = execution.summary && typeof execution.summary === 'object' ? execution.summary : null;
  if (summary && Number(summary.failed || 0) > 0) return true;

  if (Array.isArray(execution.errors) && execution.errors.length > 0) return true;

  if (Array.isArray(execution.results)) {
    const failed = execution.results.some((result) => {
      const raw = String(result?.status || result?.result || '').toLowerCase();
      return raw === 'failed' || raw === 'failure' || raw === 'error';
    });
    if (failed) return true;
  }

  return false;
}

function inferQaWavesPublicStatus(execution = {}) {
  const rawStatus = String(execution.status || '').toLowerCase();
  const mapped = normalizePublicStatus(rawStatus);

  if (mapped !== 'processing') {
    return mapped;
  }

  if (execution.finishedAt) {
    return hasFailureIndicators(execution) ? 'failed' : 'success';
  }

  return 'processing';
}

function mapQaWavesStatus(execution) {
  const startedAt = execution.startedAt || null;
  const finishedAt = execution.finishedAt || null;
  let durationMs = Number.isFinite(execution.durationMs) ? execution.durationMs : 0;

  if ((!durationMs || durationMs <= 0) && startedAt && finishedAt) {
    const start = new Date(startedAt).getTime();
    const end = new Date(finishedAt).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      durationMs = Math.max(0, end - start);
    }
  }

  return {
    executionId: execution.executionId,
    source: 'qa_waves',
    status: inferQaWavesPublicStatus(execution),
    progress: Number.isFinite(execution.progress) ? execution.progress : 0,
    startedAt,
    finishedAt,
    durationMs,
    summary: execution.summary || null,
    currentStep: execution.currentStep || null,
    results: Array.isArray(execution.results) ? execution.results : [],
    errors: [],
  };
}

function mapRpaStatus(execution) {
  const startedAt = execution.startTime || execution.startedAt || null;
  const finishedAt = execution.endTime || execution.finishedAt || null;
  const durationMs = startedAt && finishedAt
    ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
    : 0;

  return {
    executionId: execution.id || execution.executionId,
    source: 'rpa_tests',
    status: normalizePublicStatus(execution.status),
    progress: Number.isFinite(execution.progress) ? execution.progress : 0,
    startedAt,
    finishedAt,
    durationMs,
    summary: execution.results?.summary || null,
    currentStep: execution.currentStep || null,
    results: execution.results || null,
    errors: Array.isArray(execution.errors)
      ? execution.errors
      : (execution.error ? [{ error: execution.error }] : []),
  };
}

function ensureSafeJsonFilename(filename) {
  const value = String(filename || '');
  if (!value || !value.endsWith('.json') || value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw makeError('Nome de arquivo inválido', 'BAD_REQUEST');
  }
  return value;
}

function findFirstExistingFile(directories, filename) {
  for (const dirPath of directories) {
    const candidate = path.join(dirPath, filename);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function mapQaMeshStatusToReplayStatus(rawStatus) {
  const raw = String(rawStatus || '').toLowerCase();
  if (raw === 'completed' || raw === 'success') return 'success';
  if (raw === 'failed' || raw === 'failure' || raw === 'error') return 'failed';
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled';
  if (raw === 'running') return 'running';
  return 'queued';
}

function inferReplayStatusFromExecution(execution = {}, fallbackStatus = null) {
  const mapped = mapQaMeshStatusToReplayStatus(execution?.status || fallbackStatus);
  if (mapped !== 'queued' && mapped !== 'running') {
    return mapped;
  }

  if (execution?.finishedAt) {
    return hasFailureIndicators(execution) ? 'failed' : 'success';
  }

  return mapped;
}

function normalizeScreensArray(sourceScreens = []) {
  if (!Array.isArray(sourceScreens)) return [];

  return sourceScreens
    .map((item, index) => {
      if (typeof item === 'string') {
        return {
          screenId: `auto-${index + 1}`,
          step: 'auto',
          timestamp: null,
          screenshot: item,
        };
      }

      if (!item || typeof item !== 'object') return null;

      const screenshot = item.screenshot || item.path || item.url || item.file || null;
      return {
        ...item,
        screenId: item.screenId || `auto-${index + 1}`,
        step: item.step || 'auto',
        timestamp: item.timestamp || null,
        ...(screenshot ? { screenshot } : {}),
      };
    })
    .filter(Boolean);
}

function extractScreensFromArtifacts(result = {}) {
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const screenshots = artifacts
    .filter((artifact) => String(artifact?.type || '').toLowerCase() === 'screenshot' && artifact?.path)
    .map((artifact, index) => ({
      screenId: `artifact-${index + 1}`,
      step: 'artifact',
      timestamp: result.finishedAt || result.startedAt || null,
      screenshot: artifact.path,
    }));
  return screenshots;
}

function selectQaMeshScenarioResult(payload, queuedExecution) {
  const results = Array.isArray(queuedExecution?.results) ? queuedExecution.results : [];
  if (results.length === 0) return null;

  const scenarioId = payload?.scenarioId || payload?.recordingId || null;
  const platformScenarioIds = Array.isArray(payload?.platformScenarioIds)
    ? payload.platformScenarioIds.filter(Boolean)
    : [];

  if (scenarioId) {
    const byScenario = results.find((item) => item?.id === scenarioId);
    if (byScenario) return byScenario;
  }

  if (platformScenarioIds.length > 0) {
    const byPlatform = results.find((item) => platformScenarioIds.includes(item?.id));
    if (byPlatform) return byPlatform;
  }

  return results[0] || null;
}

const QA_WAVE_STEP_TYPE_LABELS = {
  send_message: 'Enviar Mensagem',
  validate_intent: 'Validar Intenção',
  validate_response: 'Validar Resposta',
  validate_sla: 'Validar SLA',
  validate_fallback: 'Validar Fallback',
  validate_state: 'Validar Estado',
  wait: 'Aguardar',
  assert: 'Validar',
};

function buildQaWaveStepTitle(step) {
  const baseLabel = QA_WAVE_STEP_TYPE_LABELS[step.type] || String(step.type || 'Passo').replace(/_/g, ' ');
  if (step.type === 'send_message') {
    const variants = Array.isArray(step.input?.variants) ? step.input.variants : [];
    const first = variants[0] ? String(variants[0]).slice(0, 60) : null;
    return first ? `${baseLabel}: "${first}"` : baseLabel;
  }
  if (step.type === 'validate_intent') {
    const intent = step.expected?.intent;
    const conf = step.expected?.confidenceMin;
    if (intent) return `${baseLabel}: ${intent}${conf !== undefined ? ` (conf ≥ ${conf})` : ''}`;
  }
  if (step.type === 'validate_response') {
    const semantic = step.expected?.semantic;
    return semantic ? `${baseLabel}: "${String(semantic).slice(0, 60)}"` : baseLabel;
  }
  return baseLabel;
}

function isQaWaveStepDefinition(step) {
  return step && typeof step === 'object' && typeof step.type === 'string' && !('title' in step);
}

function normalizeQaWaveSteps(steps, payload) {
  if (!Array.isArray(steps) || steps.length === 0) return steps;
  if (!steps.some(isQaWaveStepDefinition)) return steps;
  const overallStatus = String(payload.status || payload.result || 'pending').toLowerCase();
  const stepStatus = (overallStatus === 'completed' || overallStatus === 'success' || overallStatus === 'passed')
    ? 'success'
    : overallStatus === 'failed' || overallStatus === 'failure' ? 'failure' : 'pending';
  return steps.map((step, idx) => ({
    id: step.id || `step-${idx + 1}`,
    index: Number.isFinite(Number(step.order)) ? Number(step.order) : idx + 1,
    title: step.name || buildQaWaveStepTitle(step),
    at: payload.startedAt || payload.startTime || null,
    status: stepStatus,
    adapter: step.adapter || null,
    channel: step.channel || null,
    stepType: step.type || null,
  }));
}

function normalizeReplayPayload(payload = {}) {
  const normalized = { ...payload };

  if (!normalized.startedAt && normalized.startTime) normalized.startedAt = normalized.startTime;
  if (!normalized.startTime && normalized.startedAt) normalized.startTime = normalized.startedAt;
  if (!normalized.finishedAt && normalized.endTime) normalized.finishedAt = normalized.endTime;
  if (!normalized.endTime && normalized.finishedAt) normalized.endTime = normalized.finishedAt;

  const hasDurationMs = Number.isFinite(Number(normalized.durationMs));
  if (!hasDurationMs) {
    const start = new Date(normalized.startedAt || normalized.startTime || 0).getTime();
    const end = new Date(normalized.finishedAt || normalized.endTime || 0).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      normalized.durationMs = Math.max(0, end - start);
    } else if (normalized.timings && Number.isFinite(Number(normalized.timings.total))) {
      normalized.durationMs = Number(normalized.timings.total);
    } else {
      normalized.durationMs = 0;
    }
  }

  const sourceScreens = Array.isArray(normalized.screens)
    ? normalized.screens
    : (Array.isArray(normalized.screenshots) ? normalized.screenshots : []);
  const normalizedScreens = normalizeScreensArray(sourceScreens);
  normalized.screens = normalizedScreens;
  normalized.screenshots = normalizedScreens
    .map((screen) => screen?.screenshot || null)
    .filter(Boolean);

  normalized.screenCount = normalizedScreens.length;
  normalized.actionCount = Array.isArray(normalized.actions) ? normalized.actions.length : 0;
  normalized.errorCount = Array.isArray(normalized.errors) ? normalized.errors.length : 0;

  if (!normalized.result && normalized.status) normalized.result = normalized.status;
  if (!normalized.status && normalized.result) normalized.status = normalized.result;

  // Compatibilidade com páginas antigas que usam campo `duration`.
  if (!Number.isFinite(Number(normalized.duration))) {
    normalized.duration = Number(normalized.durationMs) || 0;
  }

  if (Array.isArray(normalized.steps)) {
    normalized.steps = normalizeQaWaveSteps(normalized.steps, normalized);
  }

  return normalized;
}

function reconcileQaWaveReplayPayload(payload = {}) {
  if (String(payload.type || '').toLowerCase() !== 'qa_wave_rpa_replay') {
    return payload;
  }

  const executionId = String(payload.executionId || '').trim();
  if (!executionId) {
    return payload;
  }

  const queuedExecution = getQaMeshQueuedExecutionStatus(executionId);
  const qaWavesExecution = getQaWavesExecutionStatus(executionId);
  const executionState = qaWavesExecution || queuedExecution;

  if (!executionState) {
    return payload;
  }

  const merged = { ...payload };
  const mergedStatus = inferReplayStatusFromExecution(executionState, payload.status || payload.result);

  if (!merged.startedAt && (executionState.startedAt || executionState.createdAt)) {
    merged.startedAt = executionState.startedAt || executionState.createdAt;
    merged.startTime = merged.startedAt;
  }

  if ((mergedStatus === 'success' || mergedStatus === 'failed' || mergedStatus === 'cancelled') && !merged.finishedAt) {
    merged.finishedAt = executionState.finishedAt || null;
    merged.endTime = merged.finishedAt;
  }

  if (mergedStatus) {
    merged.status = mergedStatus;
    merged.result = mergedStatus;
  }

  const scenarioResult = selectQaMeshScenarioResult(merged, executionState);
  if (scenarioResult) {
    if ((!Array.isArray(merged.logs) || merged.logs.length === 0) && Array.isArray(scenarioResult.logs)) {
      merged.logs = scenarioResult.logs;
    }

    if ((!Array.isArray(merged.errors) || merged.errors.length === 0) && Array.isArray(scenarioResult.errors)) {
      merged.errors = scenarioResult.errors;
    }

    const artifactScreens = extractScreensFromArtifacts(scenarioResult);
    if (artifactScreens.length > 0) {
      const existingScreens = Array.isArray(merged.screens) ? merged.screens : merged.screenshots;
      const normalizedExisting = normalizeScreensArray(existingScreens || []);
      if (normalizedExisting.length === 0) {
        merged.screens = artifactScreens;
      }
    }
  }

  const normalizedMerged = normalizeReplayPayload(merged);

  if ((!Number(normalizedMerged.durationMs) || Number(normalizedMerged.durationMs) <= 0)
      && Number.isFinite(Number(executionState.durationMs))
      && Number(executionState.durationMs) > 0) {
    normalizedMerged.durationMs = Number(executionState.durationMs);
    normalizedMerged.duration = normalizedMerged.durationMs;
  }

  // Calcula duration novamente se houve finalização recente.
  if ((!Number(normalizedMerged.durationMs) || Number(normalizedMerged.durationMs) <= 0)
      && normalizedMerged.startedAt
      && normalizedMerged.finishedAt) {
    const start = new Date(normalizedMerged.startedAt).getTime();
    const end = new Date(normalizedMerged.finishedAt).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      normalizedMerged.durationMs = Math.max(0, end - start);
      normalizedMerged.duration = normalizedMerged.durationMs;
    }
  }

  return normalizedMerged;
}

function normalizeAndReconcileReplayPayload(payload = {}) {
  const reconciled = reconcileQaWaveReplayPayload(payload);
  return normalizeReplayPayload(reconciled);
}

function persistReplayIfChanged(filePath, originalPayload, nextPayload) {
  try {
    const before = JSON.stringify(originalPayload);
    const after = JSON.stringify(nextPayload);
    if (before !== after) {
      fs.writeFileSync(filePath, `${JSON.stringify(nextPayload, null, 2)}\n`, 'utf8');
    }
  } catch (_) {
    // Não bloqueia listagem/leitura se falhar em persistir reconciliação.
  }
}

async function createExecution(payload = {}, { authToken } = {}) {
  const source = String(payload.source || 'qa_waves').toLowerCase();

  if (source === 'qa_waves') {
    const scenarioIds = Array.isArray(payload.scenarioIds) ? payload.scenarioIds.filter(Boolean) : [];
    if (scenarioIds.length === 0) {
      throw makeError('scenarioIds obrigatorio', 'BAD_REQUEST');
    }

    const run = runScenarioExecution({
      mode: String(payload.mode || 'real').toLowerCase(),
      scenarioIds,
      seedIds: Array.isArray(payload.seedIds) ? payload.seedIds : [],
      replay: payload.replay !== false,
    });

    return {
      executionId: run.executionId,
      source,
      status: 'processing',
      acceptedAt: new Date().toISOString(),
      pollAfterMs: 5000,
    };
  }

  if (source === 'rpa_tests') {
    const recordingId = String(payload.recordingId || '').trim();
    if (!recordingId) {
      throw makeError('recordingId obrigatorio para source=rpa_tests', 'BAD_REQUEST');
    }

    const result = await executeRecording(
      recordingId,
      payload.config || {},
      payload.data || {},
      authToken || null
    );

    return {
      executionId: result.executionId,
      source,
      status: 'processing',
      acceptedAt: new Date().toISOString(),
      pollAfterMs: 1000,
    };
  }

  throw makeError('source inválido. Use qa_waves ou rpa_tests', 'BAD_REQUEST');
}

function getExecutionStatus(executionId) {
  const cleanId = String(executionId || '').trim();
  if (!cleanId) return null;

  const waveExecution = getQaWavesExecutionStatus(cleanId);
  if (waveExecution) return mapQaWavesStatus(waveExecution);

  const rpaExecution = getRpaExecutionStatus(cleanId);
  if (rpaExecution) return mapRpaStatus(rpaExecution);

  return null;
}

async function cancelUnifiedExecution(executionId) {
  const cleanId = String(executionId || '').trim();
  if (!cleanId) {
    throw makeError('executionId obrigatorio', 'BAD_REQUEST');
  }

  const cancelled = await cancelExecution(cleanId);
  if (cancelled?.success) {
    return {
      executionId: cleanId,
      cancelled: true,
      status: 'cancelled',
    };
  }

  const existing = getExecutionStatus(cleanId);
  if (existing && existing.source === 'qa_waves') {
    throw makeError('Cancelamento não suportado para execuções QA Waves no momento', 'NOT_SUPPORTED');
  }

  throw makeError('Execução não encontrada', 'NOT_FOUND');
}

function getExecutionArtifacts(executionId) {
  const status = getExecutionStatus(executionId);
  if (!status) return null;

  const artifacts = [];
  const rpaResults = status.source === 'rpa_tests' && status.results && typeof status.results === 'object'
    ? status.results
    : null;

  if (rpaResults?.replayPath) {
    artifacts.push({ type: 'replay', path: rpaResults.replayPath });
  }

  if (Array.isArray(rpaResults?.screenshots)) {
    for (const screenshot of rpaResults.screenshots) {
      artifacts.push({ type: 'screenshot', path: screenshot });
    }
  }

  return {
    executionId: status.executionId,
    source: status.source,
    artifacts,
  };
}

function listReplayFiles({
  limit = 50,
  offset = 0,
  search = '',
  result = 'all',
  dateRange = 'all',
  sortBy = 'date',
  sortOrder = 'desc',
} = {}) {
  const replayDirs = getAllReplayReadDirs().filter((dirPath) => fs.existsSync(dirPath));
  const filters = {
    search: normalizeText(search).trim(),
    result: String(result || 'all'),
    dateRange: String(dateRange || 'all'),
  };
  const safeSortBy = String(sortBy || 'date');
  const safeSortOrder = sortOrder === 'asc' ? 'asc' : 'desc';
  const safeOffset = Math.max(0, Number.parseInt(String(offset), 10) || 0);
  const safeLimit = Math.min(parsePositiveInt(limit, 50), 500);

  const paginateResult = (items) => ({
    total: items.length,
    files: items.slice(safeOffset, safeOffset + safeLimit),
    offset: safeOffset,
    limit: safeLimit,
  });
  
  // Validar cache com mtime dos diretórios
  const dirMtimes = {};
  for (const dir of replayDirs) {
    try {
      const stats = fs.statSync(dir);
      dirMtimes[dir] = stats.mtimeMs;
    } catch (_) {
      // skip
    }
  }
  
  const cacheKey = JSON.stringify(dirMtimes);
  if (replayListCache && replayListCacheMtimes === cacheKey) {
    // Cache válido: aplica filtros/sort em memória antes de paginar
    const filtered = replayListCache.filter((replay) => matchesReplayFilters(replay, filters));
    const sorted = sortReplayFiles(filtered, safeSortBy, safeSortOrder);
    return paginateResult(sorted);
  }

  const unique = new Map();

  for (const replayDir of replayDirs) {
    const entries = fs.readdirSync(replayDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || unique.has(entry.name)) continue;
      const fullPath = path.join(replayDir, entry.name);
      const stat = fs.statSync(fullPath);
      
      // Extração rápida por regex dos metadados essenciais
      const { prefixBuf, suffixBuf } = readFilePrefixAndSuffix(fullPath, stat.size);
      const prefix = prefixBuf.toString('utf8');
      const replayMeta = {
        replayId: extractJsonStringField(prefix, 'replayId') || extractJsonStringField(prefix, 'id') || entry.name.replace(/\.json$/i, ''),
        scenarioId: extractJsonStringField(prefix, 'scenarioId'),
        executionId: extractJsonStringField(prefix, 'executionId'),
        status: extractJsonStringField(prefix, 'status'),
        result: extractJsonStringField(prefix, 'result') || extractJsonStringField(prefix, 'status'),
        mode: extractJsonStringField(prefix, 'mode'),
        startedAt: extractJsonStringField(prefix, 'startedAt') || extractJsonStringField(prefix, 'startTime'),
        finishedAt: extractJsonStringField(prefix, 'finishedAt') || extractJsonStringField(prefix, 'endTime'),
      };

      // Extrai contagens por padrão de bytes (sem JSON.parse completo):
      // - screenCount: "screenId": ocorre uma vez por tela
      // - actionCount: "selector": ocorre uma vez por ação (ações ficam no final → suffix)
      // - errorCount:  conta objetos reais em errors[] — NÃO usa "message" para evitar
      //                falsos positivos de logs[].message e logs[].error
      // - durationMs:  extraído de timings.total no suffix
      const screenCount = countBytesPattern(prefixBuf, '"screenId"');
      const actionCount = countBytesPattern(suffixBuf, '"selector"');
      const errorCount = extractErrorCount(suffixBuf);
      const durationMs = extractTimingsTotal(suffixBuf);

      unique.set(entry.name, {
        filename: entry.name,
        path: fullPath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        ...replayMeta,
        duration: durationMs,
        durationMs,
        actionCount,
        screenCount,
        errorCount,
      });
    }
  }

  const sortedByDateDesc = Array.from(unique.values()).sort((a, b) => {
    return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
  });

  // Armazenar em cache
  replayListCache = sortedByDateDesc;
  replayListCacheMtimes = cacheKey;

  const filtered = replayListCache.filter((replay) => matchesReplayFilters(replay, filters));
  const sorted = sortReplayFiles(filtered, safeSortBy, safeSortOrder);
  return paginateResult(sorted);
}

function getReplayFile(filename) {
  const safeName = ensureSafeJsonFilename(filename);
  const replayPath = findFirstExistingFile(getAllReplayReadDirs(), safeName);
  if (!replayPath) return null;
  const parsed = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
  const normalized = normalizeAndReconcileReplayPayload(parsed);
  persistReplayIfChanged(replayPath, parsed, normalized);
  return normalized;
}

function getReportFile(filename) {
  const safeName = ensureSafeJsonFilename(filename);
  const reportPath = findFirstExistingFile(getRpaReportReadDirs(), safeName);
  if (!reportPath) return null;
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

function deleteReplayFile(filename) {
  const safeName = ensureSafeJsonFilename(filename);
  const replayPath = findFirstExistingFile(getAllReplayReadDirs(), safeName);
  if (!replayPath) {
    throw makeError('Replay não encontrado', 'NOT_FOUND');
  }

  fs.unlinkSync(replayPath);
  replayListCache = null;
  replayListCacheMtimes = null;

  return {
    success: true,
    deletedFilename: safeName,
    message: `Replay "${safeName}" removido com sucesso`,
  };
}

function deleteAllReplayFiles() {
  const replayDirs = getAllReplayReadDirs().filter((dirPath) => fs.existsSync(dirPath));

  let deletedRoot = 0;
  let deletedSystem = 0;
  for (const replayDir of replayDirs) {
    const rootEntries = fs.readdirSync(replayDir, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      fs.unlinkSync(path.join(replayDir, entry.name));
      deletedRoot += 1;
    }

    const systemDir = path.join(replayDir, 'system');
    if (!fs.existsSync(systemDir)) continue;
    const systemEntries = fs.readdirSync(systemDir, { withFileTypes: true });
    for (const entry of systemEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      fs.unlinkSync(path.join(systemDir, entry.name));
      deletedSystem += 1;
    }
  }

  replayListCache = null;
  replayListCacheMtimes = null;

  return {
    success: true,
    deletedCount: deletedRoot + deletedSystem,
    deletedRootCount: deletedRoot,
    deletedSystemCount: deletedSystem,
    message: 'Replays removidos com sucesso',
  };
}

module.exports = {
  createExecution,
  getExecutionStatus,
  cancelUnifiedExecution,
  getExecutionArtifacts,
  listRecordings,
  startManualRecording,
  stopManualRecording,
  getRecordingStatus,
  listReplayFiles,
  getReplayFile,
  getReportFile,
  deleteReplayFile,
  deleteAllReplayFiles,
};
