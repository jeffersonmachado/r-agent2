'use strict';

const fs = require('fs');
const path = require('path');
const dbStateStore = require('../state/dbStateStore');

const ROOT = path.join(__dirname, '..', '..');
const CHECKPOINT_ROOT = path.join(ROOT, 'qa', 'checkpoints');
const WAVES_DIR = path.join(CHECKPOINT_ROOT, 'waves');
const REPORTS_DIR = path.join(CHECKPOINT_ROOT, 'reports');
const LOGS_DIR = path.join(CHECKPOINT_ROOT, 'logs');
const STATE_DIR = path.join(CHECKPOINT_ROOT, 'state');

const CURRENT_WAVE_PATH = path.join(STATE_DIR, 'current-wave.json');
const PROGRESS_PATH = path.join(STATE_DIR, 'progress.json');
const FAILURES_PATH = path.join(STATE_DIR, 'failures.json');

const DEFAULT_VALIDATION = {
  buildBackend: false,
  buildFrontend: false,
  qaTechnical: false,
  qaBusiness: false,
  replay: false,
};

const DEFAULT_METRICS = {
  testsPassed: 0,
  testsFailed: 0,
  warnings: 0,
  criticalFlowsValidated: 0,
  durationMs: 0,
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch (_) {
    return [];
  }
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  // RAP-078: estado canônico em banco para os checkpoints de estado (não wave snapshots).
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  if (rel.startsWith('qa/checkpoints/state/')) {
    dbStateStore.saveSyncExport(rel, payload);
  }
}

function normalizeWaveId(wave) {
  return String(wave || '').trim().toUpperCase().replace(/\s+/g, '-');
}

function ensureStateFiles() {
  ensureDir(CHECKPOINT_ROOT);
  ensureDir(WAVES_DIR);
  ensureDir(REPORTS_DIR);
  ensureDir(LOGS_DIR);
  ensureDir(STATE_DIR);

  if (!fs.existsSync(CURRENT_WAVE_PATH)) {
    writeJson(CURRENT_WAVE_PATH, {
      wave: null,
      title: null,
      status: 'idle',
      startedAt: null,
      finishedAt: null,
    });
  }

  if (!fs.existsSync(PROGRESS_PATH)) {
    writeJson(PROGRESS_PATH, {
      currentWave: null,
      completedWaves: [],
      failedWaves: [],
      globalStatus: 'running',
      lastSuccessfulCheckpoint: null,
    });
  }

  if (!fs.existsSync(FAILURES_PATH)) {
    writeJson(FAILURES_PATH, { failures: [] });
  }
}

function getWaveJsonPath(wave) {
  return path.join(WAVES_DIR, `${normalizeWaveId(wave)}.json`);
}

function getWaveReportPath(wave) {
  return path.join(REPORTS_DIR, `${normalizeWaveId(wave)}.md`);
}

function createWaveTemplate({ wave, title }) {
  return {
    wave: normalizeWaveId(wave),
    title: title || '',
    status: 'running',
    startedAt: nowIso(),
    finishedAt: null,
    changes: [],
    filesCreated: [],
    filesModified: [],
    filesRemoved: [],
    validation: { ...DEFAULT_VALIDATION },
    metrics: { ...DEFAULT_METRICS },
    blockers: [],
    nextActions: [],
  };
}

function loadWave(wave) {
  return safeReadJson(getWaveJsonPath(wave), null);
}

function saveWave(waveData) {
  writeJson(getWaveJsonPath(waveData.wave), waveData);
}

function writeCurrentWave(waveData) {
  writeJson(CURRENT_WAVE_PATH, {
    wave: waveData.wave,
    title: waveData.title,
    status: waveData.status,
    startedAt: waveData.startedAt,
    finishedAt: waveData.finishedAt,
  });
}

function updateProgressState(mutator) {
  const current = safeReadJson(PROGRESS_PATH, {
    currentWave: null,
    completedWaves: [],
    failedWaves: [],
    globalStatus: 'running',
    lastSuccessfulCheckpoint: null,
  });
  const next = mutator(current) || current;
  writeJson(PROGRESS_PATH, next);
  return next;
}

function appendFailureRecord(item) {
  const current = safeReadJson(FAILURES_PATH, { failures: [] });
  current.failures = Array.isArray(current.failures) ? current.failures : [];
  current.failures.unshift(item);
  current.failures = current.failures.slice(0, 300);
  writeJson(FAILURES_PATH, current);
}

function toTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function uniqueList(items = []) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function loadAllWaves() {
  ensureStateFiles();
  return safeReadDir(WAVES_DIR)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => safeReadJson(path.join(WAVES_DIR, fileName), null))
    .filter(Boolean)
    .sort((left, right) => {
      const leftTs = toTimestamp(left.finishedAt || left.startedAt) || 0;
      const rightTs = toTimestamp(right.finishedAt || right.startedAt) || 0;
      return leftTs - rightTs;
    });
}

function normalizeFailures({ progress = {}, failures = [], waves = [] } = {}) {
  const waveIndex = new Map(
    (waves || []).map((wave) => [normalizeWaveId(wave.wave), wave])
  );
  const lastSuccessfulWaveId = progress?.lastSuccessfulCheckpoint
    ? normalizeWaveId(progress.lastSuccessfulCheckpoint)
    : null;
  const lastSuccessfulWave = lastSuccessfulWaveId ? waveIndex.get(lastSuccessfulWaveId) : null;
  const lastSuccessfulAt = toTimestamp(lastSuccessfulWave?.finishedAt || lastSuccessfulWave?.startedAt);
  const latestFailureByWave = new Map();

  for (const failure of Array.isArray(failures) ? failures : []) {
    if (!failure || !failure.wave) continue;
    const waveId = normalizeWaveId(failure.wave);
    const failureTs = toTimestamp(failure.finishedAt);
    const waveState = waveIndex.get(waveId) || null;
    const waveStateTs = toTimestamp(waveState?.finishedAt || waveState?.startedAt);
    const waveStatus = String(waveState?.status || '').toLowerCase();

    if (lastSuccessfulAt !== null && failureTs !== null && failureTs <= lastSuccessfulAt) {
      continue;
    }

    if ((waveStatus === 'passed' || waveStatus === 'partial') && waveStateTs !== null) {
      if (failureTs === null || waveStateTs >= failureTs) {
        continue;
      }
    }

    if (waveStatus === 'running') {
      continue;
    }

    const previous = latestFailureByWave.get(waveId);
    const previousTs = toTimestamp(previous?.finishedAt);
    if (!previous || (failureTs !== null && (previousTs === null || failureTs > previousTs))) {
      latestFailureByWave.set(waveId, {
        ...failure,
        wave: waveId,
      });
    }
  }

  return Array.from(latestFailureByWave.values()).sort((left, right) => {
    const leftTs = toTimestamp(left.finishedAt) || 0;
    const rightTs = toTimestamp(right.finishedAt) || 0;
    return rightTs - leftTs;
  });
}

function deriveProgressState(progress = {}, waves = [], failures = []) {
  const completedWaves = waves
    .filter((wave) => ['passed', 'partial'].includes(String(wave.status || '').toLowerCase()))
    .map((wave) => normalizeWaveId(wave.wave));
  const failedWaves = failures
    .map((failure) => normalizeWaveId(failure.wave))
    .filter(Boolean);
  const runningWave = [...waves]
    .reverse()
    .find((wave) => String(wave.status || '').toLowerCase() === 'running');

  return {
    currentWave: runningWave?.wave || progress.currentWave || null,
    completedWaves,
    failedWaves,
    globalStatus: failures.length > 0 ? 'blocked' : (runningWave ? 'running' : 'completed'),
    lastSuccessfulCheckpoint: progress.lastSuccessfulCheckpoint || completedWaves[completedWaves.length - 1] || null,
  };
}

function buildCheckpointSnapshot() {
  ensureStateFiles();
  const progress = safeReadJson(PROGRESS_PATH, {
    currentWave: null,
    completedWaves: [],
    failedWaves: [],
    globalStatus: 'running',
    lastSuccessfulCheckpoint: null,
  });
  const rawFailures = safeReadJson(FAILURES_PATH, { failures: [] });
  const failures = Array.isArray(rawFailures)
    ? rawFailures
    : Array.isArray(rawFailures?.failures)
    ? rawFailures.failures
    : [];
  const waves = loadAllWaves();
  const activeFailures = normalizeFailures({ progress, failures, waves });

  return {
    progress: deriveProgressState(progress, waves, activeFailures),
    failures: activeFailures,
    totals: {
      waves: waves.length,
      activeFailures: activeFailures.length,
      historicalFailures: failures.length,
    },
    finalizedAt: nowIso(),
  };
}

function gateResult(validation) {
  const failed = [];
  if (!validation.buildBackend) failed.push('backend_build');
  if (!validation.buildFrontend) failed.push('frontend_build');
  if (!validation.qaTechnical) failed.push('qa_technical');
  if (!validation.replay) failed.push('critical_replay');
  return {
    passed: failed.length === 0,
    failed,
  };
}

function buildWaveMarkdown(waveData, decision) {
  const lines = [
    `# ${waveData.wave} - ${waveData.title || 'Sem titulo'}`,
    '',
    `- status: ${waveData.status}`,
    `- startedAt: ${waveData.startedAt || ''}`,
    `- finishedAt: ${waveData.finishedAt || ''}`,
    '',
    '## Objetivo da onda',
    `- ${waveData.title || 'Nao informado'}`,
    '',
    '## O que foi feito',
    ...(waveData.changes.length ? waveData.changes.map((item) => `- ${item}`) : ['- Sem alteracoes registradas']),
    '',
    '## Arquivos impactados',
    ...(waveData.filesCreated.length ? waveData.filesCreated.map((item) => `- criado: ${item}`) : ['- criado: nenhum']),
    ...(waveData.filesModified.length ? waveData.filesModified.map((item) => `- modificado: ${item}`) : ['- modificado: nenhum']),
    ...(waveData.filesRemoved.length ? waveData.filesRemoved.map((item) => `- removido: ${item}`) : ['- removido: nenhum']),
    '',
    '## Validacoes executadas',
    `- buildBackend: ${waveData.validation.buildBackend}`,
    `- buildFrontend: ${waveData.validation.buildFrontend}`,
    `- qaTechnical: ${waveData.validation.qaTechnical}`,
    `- qaBusiness: ${waveData.validation.qaBusiness}`,
    `- replay: ${waveData.validation.replay}`,
    '',
    '## Falhas encontradas',
    ...(waveData.blockers.length ? waveData.blockers.map((item) => `- ${item}`) : ['- Nenhum blocker registrado']),
    '',
    '## Evidencia',
    `- json: qa/checkpoints/waves/${waveData.wave}.json`,
    '',
    '## Decisao',
    `- ${decision}`,
  ];
  return `${lines.join('\n')}\n`;
}

function persistWaveReport(waveData) {
  const gate = gateResult(waveData.validation);
  const blocked = waveData.status === 'failed' || waveData.status === 'blocked' || !gate.passed;
  const decision = blocked ? 'NAO AVANCAR' : 'AVANCAR';
  fs.writeFileSync(getWaveReportPath(waveData.wave), buildWaveMarkdown(waveData, decision), 'utf8');
}

function startWave({ wave, title, changes = [] }) {
  ensureStateFiles();
  const waveData = createWaveTemplate({ wave, title });
  waveData.changes = uniqueList(changes);
  saveWave(waveData);
  writeCurrentWave(waveData);
  updateProgressState((progress) => ({
    ...progress,
    currentWave: waveData.wave,
    globalStatus: 'running',
  }));
  persistWaveReport(waveData);
  return waveData;
}

function registerProgress({ wave, changes = [], filesCreated = [], filesModified = [], filesRemoved = [] }) {
  ensureStateFiles();
  const existing = loadWave(wave) || createWaveTemplate({ wave, title: '' });
  existing.changes = uniqueList([...(existing.changes || []), ...changes]);
  existing.filesCreated = uniqueList([...(existing.filesCreated || []), ...filesCreated]);
  existing.filesModified = uniqueList([...(existing.filesModified || []), ...filesModified]);
  existing.filesRemoved = uniqueList([...(existing.filesRemoved || []), ...filesRemoved]);
  saveWave(existing);
  writeCurrentWave(existing);
  persistWaveReport(existing);
  return existing;
}

function registerValidation({ wave, validation = {}, metrics = {} }) {
  ensureStateFiles();
  const existing = loadWave(wave);
  if (!existing) throw new Error(`Wave nao encontrada: ${wave}`);
  existing.validation = {
    ...DEFAULT_VALIDATION,
    ...(existing.validation || {}),
    ...validation,
  };
  existing.metrics = {
    ...DEFAULT_METRICS,
    ...(existing.metrics || {}),
    ...metrics,
  };
  saveWave(existing);
  writeCurrentWave(existing);
  persistWaveReport(existing);
  return existing;
}

function completeWave({ wave, status = 'passed', blockers = [], nextActions = [] }) {
  ensureStateFiles();
  const existing = loadWave(wave);
  if (!existing) throw new Error(`Wave nao encontrada: ${wave}`);
  const gate = gateResult(existing.validation || DEFAULT_VALIDATION);
  existing.status = !gate.passed && status === 'passed' ? 'blocked' : status;
  existing.blockers = uniqueList([...(existing.blockers || []), ...blockers, ...gate.failed]);
  existing.nextActions = uniqueList([...(existing.nextActions || []), ...nextActions]);
  existing.finishedAt = nowIso();
  if (!existing.metrics.durationMs && existing.startedAt && existing.finishedAt) {
    const durationMs = Math.max(0, new Date(existing.finishedAt).getTime() - new Date(existing.startedAt).getTime());
    existing.metrics.durationMs = durationMs;
  }

  saveWave(existing);
  writeCurrentWave(existing);
  persistWaveReport(existing);

  updateProgressState((progress) => {
    const completed = new Set(progress.completedWaves || []);
    const failed = new Set(progress.failedWaves || []);
    completed.delete(existing.wave);
    failed.delete(existing.wave);
    if (existing.status === 'passed' || existing.status === 'partial') {
      completed.add(existing.wave);
    }
    if (existing.status === 'failed' || existing.status === 'blocked') {
      failed.add(existing.wave);
    }
    return {
      ...progress,
      currentWave: existing.wave,
      completedWaves: Array.from(completed),
      failedWaves: Array.from(failed),
      globalStatus: failed.size > 0 ? 'blocked' : 'running',
      lastSuccessfulCheckpoint: existing.status === 'passed' ? existing.wave : progress.lastSuccessfulCheckpoint,
    };
  });

  if (existing.status === 'failed' || existing.status === 'blocked') {
    appendFailureRecord({
      wave: existing.wave,
      title: existing.title,
      finishedAt: existing.finishedAt,
      blockers: existing.blockers,
      metrics: existing.metrics,
    });
  }

  return existing;
}

function failWave({ wave, blockers = [], nextActions = [] }) {
  return completeWave({ wave, status: 'failed', blockers, nextActions });
}

function markGlobalCompleted() {
  updateProgressState((progress) => ({
    ...progress,
    globalStatus: 'completed',
  }));
}

module.exports = {
  ensureStateFiles,
  startWave,
  registerProgress,
  registerValidation,
  completeWave,
  failWave,
  markGlobalCompleted,
  loadWave,
  loadAllWaves,
  normalizeFailures,
  buildCheckpointSnapshot,
  gateResult,
  paths: {
    CHECKPOINT_ROOT,
    WAVES_DIR,
    REPORTS_DIR,
    LOGS_DIR,
    STATE_DIR,
    CURRENT_WAVE_PATH,
    PROGRESS_PATH,
    FAILURES_PATH,
  },
};
