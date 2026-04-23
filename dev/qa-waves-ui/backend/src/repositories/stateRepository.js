import { baseWaves, baseWaveItems, baseReplays } from '../data/mockData.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../../..');
const MONOREPO_ROOT = path.resolve(ROOT_DIR, '..', '..');
const QA_MESH_REGISTRY_PATH = path.join(ROOT_DIR, 'qa-mesh', 'meshRegistry.json');
const QA_MESH_EVIDENCE_ROOT = path.join(ROOT_DIR, 'qa-mesh', 'system-validate', 'meshEvidence');
const QA_MESH_REPORT_PATH = path.join(ROOT_DIR, 'qa-mesh', 'system-validate', 'meshReport.json');
const QA_MESH_HISTORY_ROOT = path.join(ROOT_DIR, 'qa-mesh', 'system-validate', 'meshHistory');
const RPA_REPLAY_DIR_CANDIDATES = [
  process.env.RUNTIME_ROOT ? path.join(process.env.RUNTIME_ROOT, 'rpa', 'replay') : null,
  path.join(MONOREPO_ROOT, 'tests', 'rpa', 'replay'),
  path.join(MONOREPO_ROOT, 'rpa', 'replay')
].filter(Boolean);

const state = {
  waves: structuredClone(baseWaves),
  waveItems: structuredClone(baseWaveItems),
  replays: structuredClone(baseReplays),
  replayFileById: new Map(),
  executions: []
};

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

function normalizeChannel(adapter) {
  if (adapter === 'pbx') return 'voice';
  if (adapter === 'api') return 'webchat';
  if (adapter === 'rpa') return 'whatsapp';
  return 'webchat';
}

function normalizeItemType(type) {
  if (type === 'smoke' || type === 'technical') return 'qa';
  if (type === 'business') return 'rpa';
  return 'replay';
}

function normalizeStatus(status) {
  if (status === 'passed') return 'success';
  if (status === 'failed' || status === 'failure') return 'failure';
  if (status === 'executing' || status === 'running') return 'executing';
  if (status === 'pending') return 'pending';
  return 'success';
}

function normalizeRpaReplayStatus(result) {
  const normalized = String(result || '').toLowerCase();
  if (normalized === 'success' || normalized === 'passed' || normalized === 'ok') return 'success';
  if (normalized === 'failed' || normalized === 'failure' || normalized === 'error') return 'failure';
  if (normalized === 'executing' || normalized === 'running') return 'executing';
  if (normalized === 'pending') return 'pending';
  return 'success';
}

function extractRpaReplaySummary(content) {
  const summary = {};
  const fieldPatterns = {
    id: /"id"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
    recordingId: /"recordingId"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
    startTime: /"startTime"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
    endTime: /"endTime"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
    result: /"result"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/
  };

  for (const [field, regex] of Object.entries(fieldPatterns)) {
    const match = content.match(regex);
    if (!match?.[1]) continue;
    try {
      summary[field] = JSON.parse(`"${match[1]}"`);
    } catch (_error) {
      summary[field] = match[1];
    }
  }

  if (summary.startTime && summary.endTime) {
    const start = new Date(summary.startTime);
    const end = new Date(summary.endTime);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      summary.durationMs = Math.max(0, end.getTime() - start.getTime());
    }
  }

  return summary;
}

function readReplayPreview(filePath, maxBytes = 16384) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function listRpaReplayFilesNewestFirst() {
  const entriesByName = new Map();

  for (const replayDir of RPA_REPLAY_DIR_CANDIDATES) {
    if (!fs.existsSync(replayDir)) continue;

    const entries = fs.readdirSync(replayDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      if (entriesByName.has(entry.name)) continue;

      const fullPath = path.join(replayDir, entry.name);
      const stats = fs.statSync(fullPath);
      entriesByName.set(entry.name, {
        fileName: entry.name,
        fullPath,
        modified: stats.mtime.toISOString()
      });
    }
  }

  return Array.from(entriesByName.values()).sort((a, b) => b.modified.localeCompare(a.modified));
}

function buildRpaReplaysDataset() {
  const files = listRpaReplayFilesNewestFirst();
  if (files.length === 0) {
    return { waves: [], waveItems: [], replays: [], replayFileById: new Map() };
  }

  const waveId = 'wave-rpa-replays';
  const waveName = 'Wave RPA Replays';
  const replayFileById = new Map();

  const replays = files.map((entry) => {
    const preview = readReplayPreview(entry.fullPath);
    const summary = extractRpaReplaySummary(preview);
    const fileBase = entry.fileName.replace(/\.json$/i, '');
    const replayId = `rpa-replay-${fileBase}`;
    const startedAt = summary.startTime || entry.modified || nowIso();
    const finishedAt = summary.endTime || startedAt;
    const durationMs = Number(summary.durationMs)
      || Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());

    replayFileById.set(replayId, entry.fullPath);

    return {
      id: replayId,
      waveId,
      waveName,
      itemId: replayId,
      itemName: summary.recordingId || summary.id || fileBase,
      name: `Replay ${fileBase}`,
      seed: summary.recordingId || summary.id || fileBase,
      channel: 'rpa',
      status: normalizeRpaReplayStatus(summary.result),
      startedAt,
      finishedAt,
      durationMs,
      critical: false,
      fileName: entry.fileName
    };
  });

  const waveItems = replays.map((replay) => ({
    id: replay.itemId,
    waveId,
    name: replay.itemName,
    type: 'replay',
    channel: replay.channel,
    critical: false,
    lastStatus: replay.status,
    lastRunAt: replay.startedAt
  }));

  return {
    waves: [
      {
        id: waveId,
        name: waveName,
        description: 'Replays carregados dos diretórios de replay RPA do sistema principal',
        status: 'active',
        coverage: 100
      }
    ],
    waveItems,
    replays,
    replayFileById
  };
}

function buildFromQaMesh() {
  if (process.env.QA_WAVES_FORCE_MOCK === '1') {
    return {
      waves: structuredClone(baseWaves),
      waveItems: structuredClone(baseWaveItems),
      replays: structuredClone(baseReplays),
      replayFileById: new Map()
    };
  }

  const registry = safeReadJson(QA_MESH_REGISTRY_PATH, []);
  let waves = structuredClone(baseWaves);
  let waveItems = structuredClone(baseWaveItems);
  let replays = structuredClone(baseReplays);

  if (Array.isArray(registry) && registry.length > 0) {
    const domains = [...new Set(registry.map((item) => item.domain).filter(Boolean))];
    waves = domains.map((domain) => {
      const domainItems = registry.filter((scenario) => scenario.domain === domain);
      return {
        id: `wave-${domain}`,
        name: `Wave ${domain}`,
        description: `Cenarios do dominio ${domain} carregados do qa-mesh/meshRegistry.json`,
        status: 'active',
        coverage: Math.min(100, 50 + domainItems.length)
      };
    });

    waveItems = registry.map((scenario, idx) => {
      const scenarioId = scenario.id || `scenario-${idx + 1}`;
      return {
        id: scenarioId,
        waveId: `wave-${scenario.domain || 'core'}`,
        name: scenario.flow || scenarioId,
        type: normalizeItemType(scenario.type),
        channel: normalizeChannel(scenario.adapter),
        critical: scenario.criticality === 'blocking' || scenario.criticality === 'high',
        lastStatus: 'success',
        lastRunAt: null
      };
    });

    const report = safeReadJson(QA_MESH_REPORT_PATH, null);
    const reportTimestamp = report?.timestamp || report?.summary?.finishedAt || null;
    if (reportTimestamp) {
      waveItems.forEach((item) => {
        item.lastRunAt = reportTimestamp;
      });
    }

    replays = [];
    if (fs.existsSync(QA_MESH_EVIDENCE_ROOT)) {
      const executionDirs = fs
        .readdirSync(QA_MESH_EVIDENCE_ROOT, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort((a, b) => a.localeCompare(b));

      const latestExecution = executionDirs.at(-1);
      if (latestExecution) {
        const scenariosDir = path.join(QA_MESH_EVIDENCE_ROOT, latestExecution, 'scenarios');
        if (fs.existsSync(scenariosDir)) {
          const scenarioFiles = fs
            .readdirSync(scenariosDir)
            .filter((fileName) => fileName.endsWith('.json'));

          scenarioFiles.forEach((fileName) => {
            const scenario = safeReadJson(path.join(scenariosDir, fileName), null);
            if (!scenario?.id) return;

            const item = waveItems.find((entry) => entry.id === scenario.id);
            if (item) {
              item.lastStatus = normalizeStatus(scenario.status);
              item.lastRunAt = scenario.finishedAt || scenario.startedAt || item.lastRunAt;
            }

            const startedAt = scenario.startedAt || nowIso();
            const finishedAt = scenario.finishedAt || startedAt;
            const durationMs = Number(scenario.durationMs) || Math.max(1000, new Date(finishedAt).getTime() - new Date(startedAt).getTime());

            replays.push({
              id: `replay-${scenario.id}-${new Date(startedAt).getTime()}`,
              waveId: `wave-${scenario.domain || 'core'}`,
              waveName: `Wave ${scenario.domain || 'core'}`,
              itemId: scenario.id,
              itemName: scenario.flow || scenario.id,
              name: `Replay ${scenario.id}`,
              seed: scenario.executionId || latestExecution,
              channel: normalizeChannel(scenario.adapter),
              status: normalizeStatus(scenario.status),
              startedAt,
              finishedAt,
              durationMs,
              critical: scenario.criticality === 'blocking' || scenario.criticality === 'high'
            });
          });
        }
      }
    }

    if (replays.length === 0) {
      replays = structuredClone(baseReplays);
    }
  }

  const rpaDataset = buildRpaReplaysDataset();
  return {
    waves: [...waves, ...rpaDataset.waves],
    waveItems: [...waveItems, ...rpaDataset.waveItems],
    replays: [...rpaDataset.replays, ...replays],
    replayFileById: rpaDataset.replayFileById
  };
}

function rehydrateFromSources() {
  const data = buildFromQaMesh();
  state.waves = data.waves;
  state.waveItems = data.waveItems;
  state.replays = data.replays;
  state.replayFileById = data.replayFileById || new Map();
}

function listHistoryFilesNewestFirst() {
  if (!fs.existsSync(QA_MESH_HISTORY_ROOT)) return [];
  return fs
    .readdirSync(QA_MESH_HISTORY_ROOT)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a))
    .map((fileName) => path.join(QA_MESH_HISTORY_ROOT, fileName));
}

function extractTypedEntriesFromLogs(logs = []) {
  return logs.reduce((entries, log, index) => {
    const message = String(log?.message || '').trim();
    if (!message) return entries;

    const filledMatch = message.match(/^.*?([A-Za-zÀ-ÿ0-9_\- ]+) preenchido:?\s*(.*?)(?:\s*\(usando:\s*(.*?)\))?$/i);
    if (filledMatch) {
      const field = filledMatch[1].trim();
      const typedValue = filledMatch[2]?.trim() || (field.toLowerCase().includes('password') ? '[oculto]' : '');
      entries.push({
        id: `${index}-${field}`,
        field,
        value: typedValue || '[sem valor identificado]',
        selector: filledMatch[3]?.trim() || null,
        at: log.timestamp || null,
        rawMessage: message
      });
      return entries;
    }

    const digitadoMatch = message.match(/^.*?digitad[oa]:\s*(.*)$/i);
    if (digitadoMatch) {
      entries.push({
        id: `${index}-digitado`,
        field: 'Texto digitado',
        value: digitadoMatch[1].trim() || '[sem valor identificado]',
        selector: null,
        at: log.timestamp || null,
        rawMessage: message
      });
    }

    return entries;
  }, []);
}

function findHistoryDetailsForReplay(replay) {
  if (!replay?.itemId) return null;

  for (const historyFile of listHistoryFilesNewestFirst()) {
    const history = safeReadJson(historyFile, null);
    const results = Array.isArray(history?.results) ? history.results : [];
    const matched = results.find((result) => result?.id === replay.itemId);
    if (!matched) continue;

    return {
      historyFile: path.relative(ROOT_DIR, historyFile),
      replayArtifact: matched.replayArtifact || null,
      typedEntries: extractTypedEntriesFromLogs(matched.logs || []),
      logs: Array.isArray(matched.logs) ? matched.logs : [],
      playback: {
        steps: (Array.isArray(matched.logs) ? matched.logs : []).map((log, index) => ({
          id: `log-${index}`,
          type: 'log',
          label: String(log?.message || '').trim() || `Etapa ${index + 1}`,
          at: log?.timestamp || null,
          selector: null,
          value: null,
          screenshot: null
        }))
      }
    };
  }

  return null;
}

function extractTypedEntriesFromRpaReplay(replayData) {
  const actions = Array.isArray(replayData?.actions) ? replayData.actions : [];

  return actions
    .map((action, index) => {
      const actionType = String(action?.type || action?.action || '').toLowerCase();
      if (!actionType.includes('type') && !actionType.includes('fill') && !actionType.includes('input')) {
        return null;
      }

      const value = action?.value ?? action?.text ?? action?.input ?? action?.payload?.value;
      if (value === undefined || value === null || value === '') {
        return null;
      }

      const field = action?.field || action?.name || action?.label || 'Campo';
      const selector = action?.selector || action?.target || null;

      return {
        id: `rpa-${index}`,
        field,
        value: String(value),
        selector,
        at: action?.timestamp || replayData?.startTime || null,
        rawMessage: `${field} preenchido: ${value}${selector ? ` (usando: ${selector})` : ''}`
      };
    })
    .filter(Boolean);
}

function findRpaReplayDetailsForReplay(replay) {
  const replayPath = state.replayFileById.get(replay?.id);
  if (!replayPath || !fs.existsSync(replayPath)) return null;

  const replayData = safeReadJson(replayPath, null);
  if (!replayData) return null;

  const typedEntries = extractTypedEntriesFromRpaReplay(replayData);
  const actions = Array.isArray(replayData.actions) ? replayData.actions : [];
  const screens = Array.isArray(replayData.screens) ? replayData.screens : [];

  const playbackSteps = [
    ...actions.map((action, index) => ({
      id: `action-${index}`,
      type: 'action',
      label: action?.type || action?.action || `Acao ${index + 1}`,
      at: action?.timestamp || replayData?.startTime || null,
      selector: action?.selector || action?.target || null,
      value: action?.value ?? action?.text ?? action?.input ?? null,
      screenshot: null
    })),
    ...screens.map((screen, index) => ({
      id: `screen-${index}`,
      type: 'screen',
      label: screen?.name || `Tela ${index + 1}`,
      at: screen?.timestamp || replayData?.startTime || null,
      selector: null,
      value: null,
      screenshot: screen?.screenshot || null
    }))
  ].sort((left, right) => {
    const leftTs = new Date(left.at || 0).getTime();
    const rightTs = new Date(right.at || 0).getTime();
    return leftTs - rightTs;
  });

  const actionLogs = (Array.isArray(replayData.actions) ? replayData.actions : []).map((action, index) => ({
    timestamp: action?.timestamp || replayData?.startTime || null,
    level: 'info',
    message: `${action?.type || action?.action || 'step'} ${action?.selector || action?.target || ''}`.trim(),
    sequence: index + 1
  }));

  return {
    historyFile: path.relative(ROOT_DIR, replayPath),
    replayArtifact: replay.fileName || path.basename(replayPath),
    typedEntries,
    logs: actionLogs,
    playback: {
      steps: playbackSteps
    }
  };
}

function buildFallbackReplayDetails(replay) {
  const startedAt = replay?.startedAt || nowIso();
  const finishedAt = replay?.finishedAt || startedAt;
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(finishedAt).getTime();
  const hasValidRange = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;

  const checkpoints = hasValidRange
    ? [0.25, 0.5, 0.75].map((ratio, index) => ({
        id: `fallback-checkpoint-${index + 1}`,
        type: 'log',
        label: `Checkpoint ${Math.round(ratio * 100)}% - ${replay?.itemName || replay?.name || 'Replay'}`,
        at: new Date(startMs + Math.round((endMs - startMs) * ratio)).toISOString(),
        selector: null,
        value: null,
        screenshot: null
      }))
    : [];

  return {
    historyFile: null,
    replayArtifact: null,
    typedEntries: [],
    logs: [
      {
        timestamp: startedAt,
        level: 'info',
        message: `Replay iniciado: ${replay?.name || replay?.id || 'sem nome'}`
      },
      {
        timestamp: finishedAt,
        level: 'info',
        message: `Replay finalizado com status ${replay?.status || 'desconhecido'}`
      }
    ],
    playback: {
      steps: [
        {
          id: 'fallback-start',
          type: 'log',
          label: `Inicio - ${replay?.itemName || replay?.name || 'Replay'}`,
          at: startedAt,
          selector: null,
          value: null,
          screenshot: null
        },
        ...checkpoints,
        {
          id: 'fallback-end',
          type: 'log',
          label: `Fim - status ${replay?.status || 'desconhecido'}`,
          at: finishedAt,
          selector: null,
          value: replay?.status || null,
          screenshot: null
        }
      ]
    }
  };
}

rehydrateFromSources();

function nowIso() {
  return new Date().toISOString();
}

function randomStatus() {
  return Math.random() > 0.18 ? 'success' : 'failure';
}

function toDateTime(date, time, isEnd) {
  if (!date) return null;
  const normalizedTime = time && time.trim() ? time.trim() : (isEnd ? '23:59' : '00:00');
  const full = `${date}T${normalizedTime}${normalizedTime.length === 5 ? ':00' : ''}.000Z`;
  const parsed = new Date(full);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildWaveSnapshot() {
  return state.waves.map((wave) => {
    const items = state.waveItems.filter((item) => item.waveId === wave.id);
    const waveReplays = state.replays.filter((replay) => replay.waveId === wave.id);
    const latestItemRun = items
      .map((item) => item.lastRunAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null;

    return {
      ...wave,
      lastRunAt: latestItemRun,
      itemsCount: items.length,
      replayCount: waveReplays.length
    };
  });
}

export function listWaves() {
  return buildWaveSnapshot();
}

export function listWavesPaged(filters = {}) {
  const page = Number.parseInt(filters.page, 10) > 0 ? Number.parseInt(filters.page, 10) : 1;
  const pageSizeRaw = Number.parseInt(filters.pageSize, 10) > 0 ? Number.parseInt(filters.pageSize, 10) : 6;
  const pageSize = Math.min(100, pageSizeRaw);

  const all = listWaves();
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;

  return {
    items: all.slice(startIndex, startIndex + pageSize),
    total,
    page: safePage,
    pageSize,
    totalPages
  };
}

export function listWaveItems(waveId) {
  if (!waveId) return state.waveItems;
  return state.waveItems.filter((item) => item.waveId === waveId);
}

export function listExecutions() {
  return state.executions;
}

export function getExecutionById(executionId) {
  return state.executions.find((execution) => execution.executionId === executionId) || null;
}

export function listReplays(filters = {}) {
  const startDateTime = toDateTime(filters.startDate, filters.startTime, false);
  const endDateTime = toDateTime(filters.endDate, filters.endTime, true);
  const page = Number.parseInt(filters.page, 10) > 0 ? Number.parseInt(filters.page, 10) : 1;
  const pageSizeRaw = Number.parseInt(filters.pageSize, 10) > 0 ? Number.parseInt(filters.pageSize, 10) : 10;
  const pageSize = Math.min(100, pageSizeRaw);
  const sortBy = (filters.sortBy || 'startedAt').trim();
  const sortDir = (filters.sortDir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  function readSortValue(replay) {
    switch (sortBy) {
      case 'name':
        return replay.name || '';
      case 'waveName':
        return replay.waveName || '';
      case 'itemName':
        return replay.itemName || '';
      case 'channel':
        return replay.channel || '';
      case 'status':
        return replay.status || '';
      case 'durationMs':
        return Number(replay.durationMs) || 0;
      case 'critical':
        return replay.critical ? 1 : 0;
      case 'startedAt':
      default:
        return new Date(replay.startedAt).getTime();
    }
  }

  function compareValues(a, b) {
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }
    return String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' });
  }

  const filtered = state.replays
    .filter((replay) => {
      if (filters.waveId && replay.waveId !== filters.waveId) return false;
      if (filters.itemId && replay.itemId !== filters.itemId) return false;
      if (filters.status && replay.status !== filters.status) return false;
      if (filters.channel && replay.channel !== filters.channel) return false;
      if (filters.query) {
        const q = filters.query.toLowerCase();
        const textBlob = `${replay.name} ${replay.waveName} ${replay.itemName} ${replay.seed}`.toLowerCase();
        if (!textBlob.includes(q)) return false;
      }

      const startedAt = new Date(replay.startedAt);
      if (startDateTime && startedAt < startDateTime) return false;
      if (endDateTime && startedAt > endDateTime) return false;

      return true;
    })
    .sort((a, b) => {
      const left = readSortValue(a);
      const right = readSortValue(b);
      const base = compareValues(left, right);
      return sortDir === 'asc' ? base : -base;
    });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const items = filtered.slice(startIndex, startIndex + pageSize);

  return {
    items,
    total,
    page: safePage,
    pageSize,
    totalPages
  };
}

export function getReplayById(replayId) {
  const replay = state.replays.find((entry) => entry.id === replayId) || null;
  if (!replay) return null;

  const historyDetails = findHistoryDetailsForReplay(replay);
  const sourceDetails = historyDetails || findRpaReplayDetailsForReplay(replay) || buildFallbackReplayDetails(replay);
  return {
    ...replay,
    typedEntries: sourceDetails?.typedEntries || [],
    replayArtifact: sourceDetails?.replayArtifact || null,
    historyFile: sourceDetails?.historyFile || null,
    logs: sourceDetails?.logs || [],
    playback: sourceDetails?.playback || { steps: [] }
  };
}

function createReplayFromExecutionItem(item, executionId) {
  const startedAt = nowIso();
  const durationMs = Math.floor(Math.random() * 250000) + 60000;
  const finishedAt = new Date(new Date(startedAt).getTime() + durationMs).toISOString();

  const wave = state.waves.find((w) => w.id === item.waveId);

  return {
    id: `replay-${Math.floor(Math.random() * 900000 + 100000)}`,
    waveId: item.waveId,
    waveName: wave?.name || 'Wave desconhecida',
    itemId: item.itemId,
    itemName: item.itemName,
    name: `Replay ${item.itemName} (${executionId})`,
    seed: `seed-${Math.random().toString(36).slice(2, 8)}`,
    channel: item.channel,
    status: item.status,
    startedAt,
    finishedAt,
    durationMs,
    critical: item.critical
  };
}

function updateItemLastStatus(resultItem) {
  const current = state.waveItems.find((item) => item.id === resultItem.itemId);
  if (!current) return;
  current.lastStatus = resultItem.status;
  current.lastRunAt = nowIso();
}

function runExecutionQueue(execution) {
  const steps = execution.items;
  let index = 0;

  function runNext() {
    if (index >= steps.length) {
      execution.finishedAt = nowIso();
      execution.status = execution.items.some((item) => item.status === 'failure') ? 'failure' : 'success';
      return;
    }

    const currentItem = steps[index];
    currentItem.status = 'executing';

    setTimeout(() => {
      currentItem.status = randomStatus();
      currentItem.finishedAt = nowIso();
      updateItemLastStatus(currentItem);
      state.replays.unshift(createReplayFromExecutionItem(currentItem, execution.executionId));
      index += 1;
      runNext();
    }, 700);
  }

  runNext();
}

export function createExecution(payload) {
  const selectedWaveIds = Array.isArray(payload.selectedWaveIds) ? payload.selectedWaveIds : [];
  const selectedItemIds = Array.isArray(payload.selectedItemIds) ? payload.selectedItemIds : [];

  const waveSelectedItems = state.waveItems.filter((item) => selectedWaveIds.includes(item.waveId));
  const explicitItems = state.waveItems.filter((item) => selectedItemIds.includes(item.id));

  const merged = [...waveSelectedItems, ...explicitItems].reduce((acc, item) => {
    if (!acc.find((existing) => existing.id === item.id)) acc.push(item);
    return acc;
  }, []);

  const executionId = `exec-${Date.now()}`;
  const execution = {
    executionId,
    startedAt: nowIso(),
    finishedAt: null,
    status: 'running',
    selectedWaveIds,
    selectedItemIds: merged.map((item) => item.id),
    items: merged.map((item) => ({
      itemId: item.id,
      itemName: item.name,
      waveId: item.waveId,
      channel: item.channel,
      critical: item.critical,
      status: 'pending',
      startedAt: null,
      finishedAt: null
    }))
  };

  state.executions.unshift(execution);
  runExecutionQueue(execution);
  return execution;
}

export function reexecuteReplay(replayId) {
  const replay = getReplayById(replayId);
  if (!replay) return null;
  return createExecution({ selectedWaveIds: [], selectedItemIds: [replay.itemId] });
}

export function resetStateForTests() {
  state.executions = [];
  rehydrateFromSources();
}
