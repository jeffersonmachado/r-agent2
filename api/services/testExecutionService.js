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
const {
  getExecutionManifest,
  listExecutionManifests,
  getRecording: getPersistedRecording,
  getReplay: getPersistedReplay,
  getTraceBuffer,
  getScreenshotBuffer,
  getExecutionArtifactReality,
} = require('./rpaArtifactPersistence');
const {
  belongsToTenant,
  normalizeTenantKey,
  redactDeep,
  stripInternalFilesystemPaths,
  tenantFromArtifact,
} = require('../../lib/rpaSecurity');
const { validateReplayIntegrity } = require('../../lib/replayIntegrity');

// Cache de metadados para listReplayFiles com validação por mtime
const REPLAY_LIST_PREFIX_BYTES = 16 * 1024;
const REPLAY_LIST_SUFFIX_BYTES = 32 * 1024;
// NOTA: Para listagem de metadados, SEMPRE usamos prefix+suffix.
// A leitura completa só ocorre no endpoint de replay individual (getReplayFile).
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
    // Sempre usa prefix+suffix para listagem de metadados (evita ler arquivos grandes inteiros)
    const prefixBytes = Math.min(REPLAY_LIST_PREFIX_BYTES, fileSize);
    const suffixBytes = Math.min(REPLAY_LIST_SUFFIX_BYTES, fileSize);
    const prefixBuf = Buffer.alloc(prefixBytes);
    const suffixBuf = Buffer.alloc(suffixBytes);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, prefixBuf, 0, prefixBytes, 0);
    const suffixOffset = Math.max(0, fileSize - suffixBytes);
    if (suffixOffset > prefixBytes || fileSize <= prefixBytes) {
      // Só lê suffix se não houver overlap com prefix
      fs.readSync(fd, suffixBuf, 0, suffixBytes, suffixOffset);
    }
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

function extractJsonBoolField(prefix, key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*(true|false)`);
  const match = pattern.exec(prefix);
  if (!match) return null;
  return match[1] === 'true';
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
  if (filters.tenantId && !belongsToTenant(replay, filters.tenantId)) return false;
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

  if (filters.source) {
    if (normalizeText(replay.source) !== filters.source) return false;
  }

  // Separação por natureza do replay:
  // - api: resumos de QA Mesh (adapter API) — source qa|hybrid, sem UI.
  // - ui: replays de interface/execução RPA — todo o resto.
  if (filters.kind === 'api') {
    const src = normalizeText(replay.source);
    if (src !== 'qa' && src !== 'hybrid') return false;
  } else if (filters.kind === 'ui') {
    const src = normalizeText(replay.source);
    if (src === 'qa' || src === 'hybrid') return false;
  }

  if (filters.waveId) {
    if (normalizeText(replay.waveId) !== filters.waveId) return false;
  }

  if (filters.journeyId) {
    if (normalizeText(replay.journeyId) !== filters.journeyId) return false;
  }

  if (filters.scenarioId) {
    if (normalizeText(replay.scenarioId) !== filters.scenarioId) return false;
  }

  if (filters.seedId) {
    if (normalizeText(replay.seedId) !== filters.seedId) return false;
  }

  if (filters.executionId) {
    if (normalizeText(replay.executionId) !== filters.executionId) return false;
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

  return stripInternalFilesystemPaths(redactDeep({
    executionId: execution.executionId,
    tenantId: tenantFromArtifact(execution),
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
  }));
}

function mapRpaStatus(execution) {
  const startedAt = execution.startTime || execution.startedAt || null;
  const finishedAt = execution.endTime || execution.finishedAt || null;
  const durationMs = startedAt && finishedAt
    ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
    : 0;

  return stripInternalFilesystemPaths(redactDeep({
    executionId: execution.id || execution.executionId,
    tenantId: tenantFromArtifact(execution),
    recordingId: execution.recordingId || null,
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
  }));
}

function ensureSafeJsonFilename(filename) {
  const value = String(filename || '');
  if (!value || !value.endsWith('.json') || value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw makeError('Nome de arquivo inválido', 'BAD_REQUEST');
  }
  return value;
}

function findOwnedJsonFile(directories, filename, tenantId) {
  for (const dirPath of directories) {
    const candidate = path.join(dirPath, filename);
    if (!fs.existsSync(candidate)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (belongsToTenant(payload, tenantId)) return { filePath: candidate, payload };
    } catch (_) {
      // Um arquivo inválido ou de outro tenant não mascara uma cópia válida
      // com o mesmo nome em outro diretório governado.
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

function resolveScreenshotToBase64(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.startsWith('data:') || !value.startsWith('/')) return value;
  try {
    if (fs.existsSync(value)) {
      return fs.readFileSync(value).toString('base64');
    }
  } catch (_) {
    // arquivo inacessível — retorna null para filtrar
  }
  return null;
}

function normalizeScreensArray(sourceScreens = []) {
  if (!Array.isArray(sourceScreens)) return [];

  return sourceScreens
    .map((item, index) => {
      if (typeof item === 'string') {
        const screenshot = resolveScreenshotToBase64(item);
        if (!screenshot) return null;
        return {
          screenId: `auto-${index + 1}`,
          step: 'auto',
          timestamp: null,
          screenshot,
        };
      }

      if (!item || typeof item !== 'object') return null;

      const rawScreenshot = item.screenshot || item.path || item.url || item.file || null;
      const screenshot = resolveScreenshotToBase64(rawScreenshot);
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
  if (!step || typeof step !== 'object') return false;
  if (step.action || step.name || step.screenshotAfter || step.startedAt || step.durationMs !== undefined) {
    return false;
  }
  return typeof step.type === 'string' && !('title' in step);
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
    // Evidência assinada é imutável. Reconciliação de apresentação não pode
    // sobrescrever o payload que originou hash/checksum/HMAC.
    if (originalPayload?.replayHash || originalPayload?.governanceSignature) return;
    const before = JSON.stringify(originalPayload);
    const after = JSON.stringify(nextPayload);
    if (before !== after) {
      fs.writeFileSync(filePath, `${JSON.stringify(nextPayload, null, 2)}\n`, 'utf8');
    }
  } catch (_) {
    // Não bloqueia listagem/leitura se falhar em persistir reconciliação.
  }
}

async function createExecution(payload = {}, { authToken, tenantId = null } = {}) {
  const source = String(payload.source || 'qa_waves').toLowerCase();

  if (source === 'qa_waves') {
    const scenarioIds = Array.isArray(payload.scenarioIds) ? payload.scenarioIds.filter(Boolean) : [];
    if (scenarioIds.length === 0) {
      throw makeError('scenarioIds obrigatorio', 'BAD_REQUEST');
    }

    const run = await runScenarioExecution({
      mode: String(payload.mode || 'real').toLowerCase(),
      scenarioIds,
      seedIds: Array.isArray(payload.seedIds) ? payload.seedIds : [],
      replay: payload.replay !== false,
      tenantId,
    });

    return {
      executionId: run.executionId || null,
      replayId: run.replayId || null,
      replayIds: Array.isArray(run.replayIds) ? run.replayIds : [],
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
      authToken || null,
      normalizeTenantKey(tenantId)
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

function getExecutionStatus(executionId, tenantId = 'system') {
  const cleanId = String(executionId || '').trim();
  if (!cleanId) return null;
  const scopedTenantId = normalizeTenantKey(tenantId);

  const waveExecution = getQaWavesExecutionStatus(cleanId);
  if (waveExecution && belongsToTenant(waveExecution, scopedTenantId)) return mapQaWavesStatus(waveExecution);

  const rpaExecution = getRpaExecutionStatus(cleanId, scopedTenantId);
  if (rpaExecution) return mapRpaStatus(rpaExecution);

  return null;
}

async function cancelUnifiedExecution(executionId, tenantId = 'system') {
  const cleanId = String(executionId || '').trim();
  if (!cleanId) {
    throw makeError('executionId obrigatorio', 'BAD_REQUEST');
  }

  const scopedTenantId = normalizeTenantKey(tenantId);
  const cancelled = await cancelExecution(cleanId, scopedTenantId);
  if (cancelled?.success) {
    return {
      executionId: cleanId,
      cancelled: true,
      status: 'cancelled',
    };
  }

  const existing = getExecutionStatus(cleanId, scopedTenantId);
  if (existing && existing.source === 'qa_waves') {
    throw makeError('Cancelamento não suportado para execuções QA Waves no momento', 'NOT_SUPPORTED');
  }

  throw makeError('Execução não encontrada', 'NOT_FOUND');
}

async function getExecutionArtifacts(executionId, tenantId = 'system') {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const status = getExecutionStatus(executionId, scopedTenantId);
  const manifest = await getExecutionManifest(executionId, scopedTenantId);
  if (!status && !manifest) return null;

  const artifacts = [];
  const rpaResults = status?.source === 'rpa_tests' && status.results && typeof status.results === 'object'
    ? status.results
    : null;

  if (rpaResults?.replayPath) {
    artifacts.push({ type: 'replay', available: true });
  }

  if (Array.isArray(rpaResults?.screenshots)) {
    for (const screenshot of rpaResults.screenshots) {
      artifacts.push({ type: 'screenshot', available: true });
    }
  }

  // Artefatos persistidos no banco (roteiro + trace visual + replay) — sempre
  // disponíveis após a execução, mesmo após restart do processo.
  const recordingId = manifest?.recordingId || status?.recordingId || null;

  if (manifest?.recording || recordingId) {
    artifacts.push({
      type: 'recording',
      persisted: true,
      recordingId: recordingId || null,
      downloadUrl: `/api/test-executions/${encodeURIComponent(executionId)}/artifact/recording`,
    });
  }

  if (manifest?.trace) {
    artifacts.push({
      type: 'trace',
      persisted: true,
      sizeBytes: manifest.traceSizeBytes || null,
      downloadUrl: `/api/test-executions/${encodeURIComponent(executionId)}/artifact/trace`,
    });
  }

  if (manifest?.replay) {
    artifacts.push({
      type: 'replay_persisted',
      persisted: true,
      downloadUrl: `/api/test-executions/${encodeURIComponent(executionId)}/artifact/replay`,
    });
  }

  for (let index = 0; index < Number(manifest?.screenshots || 0); index += 1) {
    artifacts.push({
      type: 'screenshot_persisted',
      persisted: true,
      index,
      downloadUrl: `/api/test-executions/${encodeURIComponent(executionId)}/artifact/screenshot/${index}`,
    });
  }

  return {
    executionId: status?.executionId || manifest.executionId || String(executionId),
    source: status?.source || 'rpa_tests',
    recordingId: recordingId || null,
    artifacts,
  };
}

/**
 * Recupera um artefato persistido de uma execução RPA (roteiro, replay, trace
 * visual ou screenshot) para download/serialização.
 *
 * Retorna:
 *  - { kind, contentType, filename, buffer } para binários (trace/screenshot)
 *  - { kind, contentType: 'application/json', json } para roteiro/replay
 *  - null quando o artefato não existe.
 */
async function getExecutionArtifact(executionId, kind, index = null, tenantId = 'system') {
  const cleanId = String(executionId || '').trim();
  const cleanKind = String(kind || '').trim().toLowerCase();
  const scopedTenantId = normalizeTenantKey(tenantId);

  if (cleanKind === 'recording') {
    const manifest = await getExecutionManifest(cleanId, scopedTenantId);
    const recordingId = manifest?.recordingId || getExecutionStatus(cleanId, scopedTenantId)?.recordingId || null;
    if (!recordingId) return null;
    const recording = await getPersistedRecording(recordingId, scopedTenantId);
    if (!recording) return null;
    return {
      kind: 'recording',
      contentType: 'application/json',
      filename: `${recordingId}.recording.json`,
      json: recording,
    };
  }

  if (cleanKind === 'replay') {
    const replay = await getPersistedReplay(cleanId, scopedTenantId);
    if (!replay) return null;
    return {
      kind: 'replay',
      contentType: 'application/json',
      filename: `${cleanId}.replay.json`,
      json: replay,
    };
  }

  if (cleanKind === 'trace') {
    const buffer = await getTraceBuffer(cleanId, scopedTenantId);
    if (!buffer) return null;
    return {
      kind: 'trace',
      contentType: 'application/zip',
      filename: `${cleanId}.trace.zip`,
      buffer,
    };
  }

  if (cleanKind === 'screenshot') {
    const screenshotIndex = Number.parseInt(String(index), 10);
    if (!Number.isFinite(screenshotIndex) || screenshotIndex < 0) return null;
    const buffer = await getScreenshotBuffer(`${cleanId}-${screenshotIndex}`, scopedTenantId);
    if (!buffer) return null;
    return {
      kind: 'screenshot',
      contentType: 'image/png',
      filename: `${cleanId}.screenshot-${screenshotIndex}.png`,
      buffer,
    };
  }

  return null;
}

/**
 * Lista as execuções RPA persistidas no banco (roteiro + trace + replay),
 * com os campos necessários para a UI de consulta.
 */
async function listExecutionArtifacts(tenantId = 'system') {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const manifests = await listExecutionManifests(scopedTenantId);
  // Disponibilidade de binários (trace/screenshot) derivada das linhas reais
  // do store — o manifesto pode ficar desatualizado se os binários forem
  // removidos depois da persistência (sweep de metadados órfãos).
  const reality = await getExecutionArtifactReality(scopedTenantId);
  const items = [];
  for (const meta of manifests) {
    const manifest = await getExecutionManifest(meta.refId, scopedTenantId);
    if (!manifest) continue;
    const executionId = manifest.executionId || meta.refId;
    items.push({
      executionId,
      recordingId: manifest.recordingId || null,
      status: manifest.status || null,
      hasRecording: !!manifest.recording,
      hasTrace: reality.traces.has(executionId),
      hasReplay: !!manifest.replay,
      screenshots: reality.screenshots.get(executionId) || 0,
      startedAt: manifest.startedAt || null,
      finishedAt: manifest.finishedAt || null,
      persistedAt: manifest.persistedAt || meta.createdAt || null,
    });
  }
  return items;
}

function listReplayFiles({
  limit = 50,
  offset = 0,
  search = '',
  result = 'all',
  dateRange = 'all',
  sortBy = 'date',
  sortOrder = 'desc',
  source = '',
  waveId = '',
  journeyId = '',
  scenarioId = '',
  seedId = '',
  executionId = '',
  kind = '',
  tenantId = 'system',
} = {}) {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const replayDirs = getAllReplayReadDirs(scopedTenantId).filter((dirPath) => fs.existsSync(dirPath));
  const filters = {
    search: normalizeText(search).trim(),
    result: String(result || 'all'),
    dateRange: String(dateRange || 'all'),
    source: normalizeText(source).trim(),
    waveId: normalizeText(waveId).trim(),
    journeyId: normalizeText(journeyId).trim(),
    scenarioId: normalizeText(scenarioId).trim(),
    seedId: normalizeText(seedId).trim(),
    executionId: normalizeText(executionId).trim(),
    kind: normalizeText(kind).trim(),
    tenantId: scopedTenantId,
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
      const replayType = extractJsonStringField(prefix, 'type');
      const explicitSource = extractJsonStringField(prefix, 'source');
      const replayMeta = {
        tenantId: extractJsonStringField(prefix, 'tenantId')
          || extractJsonStringField(prefix, 'tenantKey')
          || extractJsonStringField(prefix, 'tenant_id')
          || extractJsonStringField(prefix, 'tenant_key')
          || 'system',
        replayId: extractJsonStringField(prefix, 'replayId') || extractJsonStringField(prefix, 'id') || entry.name.replace(/\.json$/i, ''),
        // Origem do replay: o roteiro/gravação (recordingId) que originou esta
        // execução. Exposto no card da UI para responder "de onde veio este replay".
        recordingId: extractJsonStringField(prefix, 'recordingId') || null,
        recordingName: extractJsonStringField(prefix, 'recordingName') || null,
        // Em artefatos legados finalizados, scenarioId/seedId ficavam após o
        // array journeySteps (fora do prefixo lido). Para replays QA Waves,
        // recordingId é gravado com o mesmo valor de scenario.id.
        scenarioId: extractJsonStringField(prefix, 'scenarioId')
          || (replayType === 'qa_wave_rpa_replay' ? extractJsonStringField(prefix, 'recordingId') : null),
        executionId: extractJsonStringField(prefix, 'executionId'),
        // Artefatos legados de QA Waves não gravavam `source`; deriva a origem
        // de produto a partir do tipo para que o filtro source=qa-waves os encontre.
        source: explicitSource || (replayType === 'qa_wave_rpa_replay' ? 'qa-waves' : null),
        // Detalhe do cenário (QA Mesh): objetivo/criticidade/adapter/fallback
        // ficam no prefixo e são expostos direto no card da listagem.
        description: extractJsonStringField(prefix, 'description'),
        criticality: extractJsonStringField(prefix, 'criticality'),
        adapter: extractJsonStringField(prefix, 'adapter'),
        fallback: extractJsonBoolField(prefix, 'fallback'),
        waveId: extractJsonStringField(prefix, 'waveId'),
        journeyId: extractJsonStringField(prefix, 'journeyId'),
        seedId: extractJsonStringField(prefix, 'seedId'),
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

function getReplayFile(filename, tenantId = 'system') {
  const safeName = ensureSafeJsonFilename(filename);
  const scopedTenantId = normalizeTenantKey(tenantId);
  const owned = findOwnedJsonFile(getAllReplayReadDirs(scopedTenantId), safeName, scopedTenantId);
  if (!owned) return null;
  const { filePath: replayPath, payload: parsed } = owned;
  const signed = Boolean(parsed.replayHash || parsed.replayChecksum || parsed.governanceSignature);
  if (signed || process.env.NODE_ENV === 'production') {
    const integrity = validateReplayIntegrity(parsed, parsed.governance || parsed.governanceResult || {}, {
      maxAgeMs: -1,
    });
    if (!integrity.valid) return null;
  }
  // Não transforme evidência assinada em memória: o objeto entregue pela API
  // deve continuar verificável exatamente como foi persistido.
  if (signed) return parsed;
  const normalized = normalizeAndReconcileReplayPayload(parsed);
  persistReplayIfChanged(replayPath, parsed, normalized);
  return redactDeep(normalized);
}

function getReportFile(filename, tenantId = 'system') {
  const safeName = ensureSafeJsonFilename(filename);
  const scopedTenantId = normalizeTenantKey(tenantId);
  const owned = findOwnedJsonFile(getRpaReportReadDirs(scopedTenantId), safeName, scopedTenantId);
  return owned ? redactDeep(owned.payload) : null;
}

function deleteReplayFile(filename, tenantId = 'system') {
  const safeName = ensureSafeJsonFilename(filename);
  const scopedTenantId = normalizeTenantKey(tenantId);
  const owned = findOwnedJsonFile(getAllReplayReadDirs(scopedTenantId), safeName, scopedTenantId);
  if (!owned) {
    throw makeError('Replay não encontrado', 'NOT_FOUND');
  }

  fs.unlinkSync(owned.filePath);
  replayListCache = null;
  replayListCacheMtimes = null;

  return {
    success: true,
    deletedFilename: safeName,
    message: `Replay "${safeName}" removido com sucesso`,
  };
}

function deleteAllReplayFiles(tenantId = 'system') {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const replayDirs = getAllReplayReadDirs(scopedTenantId).filter((dirPath) => fs.existsSync(dirPath));

  let deletedRoot = 0;
  let deletedSystem = 0;
  for (const replayDir of replayDirs) {
    const rootEntries = fs.readdirSync(replayDir, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = path.join(replayDir, entry.name);
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!belongsToTenant(parsed, scopedTenantId)) continue;
        fs.unlinkSync(filePath);
        deletedRoot += 1;
      } catch (_) {
        // Arquivo inválido não é apagado por uma operação tenant-scoped.
      }
    }

    const systemDir = path.join(replayDir, 'system');
    if (!fs.existsSync(systemDir)) continue;
    const systemEntries = fs.readdirSync(systemDir, { withFileTypes: true });
    for (const entry of systemEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = path.join(systemDir, entry.name);
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!belongsToTenant(parsed, scopedTenantId)) continue;
        fs.unlinkSync(filePath);
        deletedSystem += 1;
      } catch (_) {
        // Arquivo inválido não é apagado por uma operação tenant-scoped.
      }
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
  getExecutionArtifact,
  listExecutionArtifacts,
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
