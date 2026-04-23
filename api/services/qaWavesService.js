'use strict';

const fs = require('fs');
const path = require('path');
const qaMeshService = require('./qaMeshService');

const ROOT_DIR = path.join(__dirname, '..', '..');
const HISTORY_DIR_CANDIDATES = [
  path.join(ROOT_DIR, 'qa-mesh', 'meshHistory'),
  path.join(ROOT_DIR, 'qa-mesh', 'system-validate', 'meshHistory'),
];

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function combineDateTime(date, time, isEnd = false) {
  if (!date) return null;
  const safeTime = time || (isEnd ? '23:59' : '00:00');
  const iso = `${date}T${safeTime}:00`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function normalizeStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'passed' || normalized === 'pass' || normalized === 'success') return 'success';
  if (normalized === 'failed' || normalized === 'failure' || normalized === 'error') return 'failure';
  if (normalized === 'running' || normalized === 'executing') return 'executing';
  if (normalized === 'pending') return 'pending';
  return 'success';
}

function normalizeChannel(adapter) {
  if (adapter === 'pbx') return 'voice';
  if (adapter === 'rpa') return 'whatsapp';
  return 'webchat';
}

function extractTypedEntriesFromLogs(logs = []) {
  return logs.reduce((entries, log, index) => {
    const message = String(log?.message || '').trim();
    if (!message) return entries;

    const filledMatch = message.match(/^.*?([A-Za-zÀ-ÿ0-9_\- ]+) preenchido:?\s*(.*?)(?:\s*\(usando:\s*(.*?)\))?$/i);
    if (filledMatch) {
      const field = filledMatch[1].trim();
      const rawValue = filledMatch[2]?.trim() || '';
      const isSensitive = /password|senha/i.test(field);
      const value = isSensitive ? '[oculto]' : (rawValue || '[sem valor identificado]');

      entries.push({
        id: `${index}-${field}`,
        field,
        value,
        selector: filledMatch[3]?.trim() || null,
        at: log.timestamp || null,
      });
      return entries;
    }

    const typedMatch = message.match(/^.*?digitad[oa]:\s*(.*)$/i);
    if (typedMatch) {
      entries.push({
        id: `${index}-digitado`,
        field: 'Texto digitado',
        value: typedMatch[1].trim() || '[sem valor identificado]',
        selector: null,
        at: log.timestamp || null,
      });
    }

    return entries;
  }, []);
}

function extractPlaybackSteps(logs = [], replay = {}) {
  const steps = [];

  logs.forEach((log, index) => {
    const message = String(log?.message || '').trim();
    if (!message) return;

    const numberedMatch = message.match(/^(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      steps.push({
        id: `step-${index}-${numberedMatch[1]}`,
        index: Number.parseInt(numberedMatch[1], 10),
        title: numberedMatch[2].trim(),
        at: log.timestamp || replay.startedAt,
        status: 'success',
      });
      return;
    }

    if (/screenshot salvo/i.test(message)) {
      const fileMatch = message.match(/screenshot salvo:\s*(.*)$/i);
      steps.push({
        id: `shot-${index}`,
        index: steps.length + 1,
        title: 'Screenshot capturado',
        at: log.timestamp || replay.startedAt,
        status: 'success',
        screenshot: fileMatch?.[1]?.trim() || null,
      });
    }
  });

  if (steps.length === 0) {
    return [
      { id: 'fallback-1', index: 1, title: 'Inicio do replay', at: replay.startedAt, status: 'success' },
      { id: 'fallback-2', index: 2, title: 'Execucao do cenario', at: replay.startedAt, status: replay.status === 'failure' ? 'failure' : 'success' },
      { id: 'fallback-3', index: 3, title: 'Finalizacao', at: replay.finishedAt, status: replay.status || 'success' },
    ];
  }

  return steps.sort((a, b) => a.index - b.index);
}

function listHistoryFilesNewestFirst() {
  const unique = new Map();
  for (const historyDir of HISTORY_DIR_CANDIDATES) {
    if (!fs.existsSync(historyDir)) continue;
    const names = fs.readdirSync(historyDir).filter((name) => name.endsWith('.json'));
    for (const name of names) {
      if (unique.has(name)) continue;
      unique.set(name, path.join(historyDir, name));
    }
  }

  return Array.from(unique.values()).sort((a, b) => {
    const aTime = fs.statSync(a).mtimeMs;
    const bTime = fs.statSync(b).mtimeMs;
    return bTime - aTime;
  });
}

function buildExecutionLogIndex(limit = 80) {
  const files = listHistoryFilesNewestFirst().slice(0, limit);
  const index = new Map();

  for (const filePath of files) {
    try {
      const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const executionId = json.executionId || json.summary?.executionId;
      const results = Array.isArray(json.results) ? json.results : [];
      if (!executionId || results.length === 0) continue;

      const byScenario = new Map();
      for (const result of results) {
        const scenarioId = result.id || result.scenarioId;
        if (!scenarioId) continue;
        byScenario.set(scenarioId, {
          logs: Array.isArray(result.logs) ? result.logs : [],
          sourceFile: filePath,
        });
      }

      index.set(executionId, byScenario);
    } catch (_error) {
      // ignora arquivos inválidos
    }
  }

  return index;
}

function buildWaveItems(registry) {
  return registry.map((scenario, index) => ({
    id: scenario.id || `scenario-${index + 1}`,
    name: scenario.flow || scenario.name || scenario.id || `Scenario ${index + 1}`,
    domain: scenario.domain || 'core',
    adapter: scenario.adapter || 'api',
    critical: ['blocking', 'high'].includes(String(scenario.criticality || '').toLowerCase()),
    type: scenario.type || 'technical',
  }));
}

function listWaves() {
  const registry = qaMeshService.getRegistry() || [];
  const items = buildWaveItems(registry);
  const byDomain = new Map();

  for (const item of items) {
    const key = item.domain;
    if (!byDomain.has(key)) {
      byDomain.set(key, {
        id: `wave-${key}`,
        domain: key,
        name: `Wave ${key}`,
        totalItems: 0,
        criticalItems: 0,
        coverage: 0,
        items: [],
      });
    }

    const wave = byDomain.get(key);
    wave.totalItems += 1;
    if (item.critical) wave.criticalItems += 1;
    wave.items.push({
      id: item.id,
      name: item.name,
      channel: normalizeChannel(item.adapter),
      critical: item.critical,
      type: item.type,
    });
  }

  return Array.from(byDomain.values()).map((wave) => ({
    ...wave,
    coverage: Math.min(100, Math.round((wave.totalItems / Math.max(1, items.length)) * 100)),
  }));
}

function flattenReplays(maxExecutions = 150) {
  const history = qaMeshService.getMeshHistory({ limit: maxExecutions }) || [];
  const replays = [];

  for (const execution of history) {
    const executionId = execution.executionId || execution.id;
    const executionSeed = executionId || 'n/a';
    const results = Array.isArray(execution.results) ? execution.results : [];

    for (const scenario of results) {
      const scenarioId = scenario.id || scenario.scenarioId || 'scenario';
      const startedAt = scenario.startedAt || execution.startedAt || new Date().toISOString();
      const finishedAt = scenario.finishedAt || execution.finishedAt || startedAt;
      const durationMs = Number(scenario.durationMs)
        || Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());

      replays.push({
        id: `${executionSeed}::${scenarioId}`,
        executionId: executionSeed,
        scenarioId,
        waveId: `wave-${scenario.domain || 'core'}`,
        waveName: `Wave ${scenario.domain || 'core'}`,
        itemId: scenarioId,
        itemName: scenario.flow || scenario.name || scenarioId,
        name: `Replay ${scenarioId}`,
        seed: executionSeed,
        channel: normalizeChannel(scenario.adapter),
        status: normalizeStatus(scenario.status),
        startedAt,
        finishedAt,
        durationMs,
        critical: ['blocking', 'high'].includes(String(scenario.criticality || '').toLowerCase()),
      });
    }
  }

  return replays;
}

function listReplays(options = {}) {
  const {
    startDate,
    startTime,
    endDate,
    endTime,
    status,
    waveId,
    sortBy = 'startedAt',
    sortDir = 'desc',
    page = 1,
    pageSize = 10,
  } = options;

  let replays = flattenReplays();

  const start = combineDateTime(startDate, startTime, false);
  const end = combineDateTime(endDate, endTime, true);

  if (start) {
    replays = replays.filter((item) => new Date(item.startedAt).getTime() >= start.getTime());
  }
  if (end) {
    replays = replays.filter((item) => new Date(item.startedAt).getTime() <= end.getTime());
  }
  if (status) {
    replays = replays.filter((item) => item.status === String(status).toLowerCase());
  }
  if (waveId) {
    replays = replays.filter((item) => item.waveId === waveId);
  }

  const multiplier = String(sortDir).toLowerCase() === 'asc' ? 1 : -1;
  replays.sort((a, b) => {
    if (sortBy === 'durationMs') return (a.durationMs - b.durationMs) * multiplier;
    if (sortBy === 'status') return String(a.status).localeCompare(String(b.status)) * multiplier;
    return String(a.startedAt).localeCompare(String(b.startedAt)) * multiplier;
  });

  const safePage = Math.max(1, toInt(page, 1));
  const safePageSize = Math.max(1, Math.min(100, toInt(pageSize, 10)));
  const total = replays.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const offset = (safePage - 1) * safePageSize;

  return {
    items: replays.slice(offset, offset + safePageSize),
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages,
      hasNext: safePage < totalPages,
      hasPrev: safePage > 1,
    },
  };
}

function getReplayById(id) {
  const replay = flattenReplays(250).find((entry) => entry.id === id);
  if (!replay) return null;

  const executionIndex = buildExecutionLogIndex();
  const executionEntry = executionIndex.get(replay.executionId);
  const scenarioEntry = executionEntry?.get(replay.scenarioId);
  const logs = Array.isArray(scenarioEntry?.logs) ? scenarioEntry.logs : [];

  const typedEntries = extractTypedEntriesFromLogs(logs);
  const playbackSteps = extractPlaybackSteps(logs, replay);

  return {
    ...replay,
    steps: playbackSteps,
    typedEntries,
    source: {
      executionId: replay.executionId,
      scenarioId: replay.scenarioId,
      historyFile: scenarioEntry?.sourceFile || null,
      logsCount: logs.length,
    },
  };
}

function queueWaveExecution(payload = {}) {
  const scenarioIds = Array.isArray(payload.scenarioIds) ? payload.scenarioIds.filter(Boolean) : [];
  if (scenarioIds.length === 0) {
    const error = new Error('scenarioIds obrigatorio');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  return qaMeshService.queueMeshRun({ scenarioIds, executionOrigin: 'qa_waves' });
}

function reexecuteReplay(replayId) {
  const replay = getReplayById(replayId);
  if (!replay) {
    const error = new Error('Replay nao encontrado');
    error.code = 'NOT_FOUND';
    throw error;
  }
  return qaMeshService.queueScenarioReplay(replay.scenarioId);
}

module.exports = {
  listWaves,
  listReplays,
  getReplayById,
  queueWaveExecution,
  reexecuteReplay,
};
