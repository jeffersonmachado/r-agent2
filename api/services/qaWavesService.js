'use strict';

const fs = require('fs');
const path = require('path');
const qaMeshService = require('./qaMeshService');
const { buildJourneyRegistry, mapScenarioToJourney } = require('../modules/qa-waves/journeyRegistry');

const ROOT_DIR = path.join(__dirname, '..', '..');
const HISTORY_DIR_CANDIDATES = [
  path.join(ROOT_DIR, 'qa-mesh', 'meshHistory'),
  path.join(ROOT_DIR, 'qa-mesh', 'system-validate', 'meshHistory'),
];
const MAX_SCREENSHOT_SIZE_BYTES = 5 * 1024 * 1024;
const screenshotDataUrlCache = new Map();

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

function detectImageMimeType(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

function buildScreenshotDataUrl(screenshotPath) {
  const rawPath = String(screenshotPath || '').trim();
  if (!rawPath) return null;

  if (/^data:image\//i.test(rawPath)) {
    return rawPath;
  }

  if (screenshotDataUrlCache.has(rawPath)) {
    return screenshotDataUrlCache.get(rawPath);
  }

  const candidatePaths = path.isAbsolute(rawPath)
    ? [rawPath]
    : [path.join(ROOT_DIR, rawPath)];

  for (const candidatePath of candidatePaths) {
    try {
      if (!fs.existsSync(candidatePath)) continue;

      const stat = fs.statSync(candidatePath);
      if (!stat.isFile() || stat.size > MAX_SCREENSHOT_SIZE_BYTES) {
        screenshotDataUrlCache.set(rawPath, null);
        return null;
      }

      const mimeType = detectImageMimeType(candidatePath);
      const base64 = fs.readFileSync(candidatePath, 'base64');
      const dataUrl = `data:${mimeType};base64,${base64}`;
      screenshotDataUrlCache.set(rawPath, dataUrl);
      return dataUrl;
    } catch (_error) {
      // Ignora falhas de leitura e tenta próximo candidato.
    }
  }

  screenshotDataUrlCache.set(rawPath, null);
  return null;
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
      const screenshotPath = fileMatch?.[1]?.trim() || null;
      steps.push({
        id: `shot-${index}`,
        index: steps.length + 1,
        title: 'Screenshot capturado',
        at: log.timestamp || replay.startedAt,
        status: 'success',
        screenshot: screenshotPath,
        screenshotDataUrl: buildScreenshotDataUrl(screenshotPath),
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

function boolFromQuery(value) {
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  return false;
}

function buildScenarioMetadataIndex() {
  const registry = qaMeshService.getRegistry() || [];
  const index = new Map();

  for (const scenario of registry) {
    const scenarioId = scenario.id || scenario.scenarioId;
    if (!scenarioId) continue;
    index.set(scenarioId, scenario);
  }

  return index;
}

function collectScenarioLatestStats(maxExecutions = 250) {
  const history = qaMeshService.getMeshHistory({ limit: maxExecutions }) || [];
  const stats = new Map();

  for (const execution of history) {
    const results = Array.isArray(execution.results) ? execution.results : [];
    for (const result of results) {
      const scenarioId = result.id || result.scenarioId;
      if (!scenarioId) continue;

      const startedAt = result.startedAt || execution.startedAt || null;
      const status = normalizeStatus(result.status);
      const isCritical = ['blocking', 'high'].includes(String(result.criticality || '').toLowerCase());

      const current = stats.get(scenarioId) || {
        scenarioId,
        runs: 0,
        success: 0,
        failure: 0,
        executing: 0,
        pending: 0,
        lastStatus: null,
        lastExecutionAt: null,
        critical: isCritical,
      };

      current.runs += 1;
      current.critical = current.critical || isCritical;
      if (status === 'success') current.success += 1;
      if (status === 'failure') current.failure += 1;
      if (status === 'executing') current.executing += 1;
      if (status === 'pending') current.pending += 1;

      const currentTs = current.lastExecutionAt ? new Date(current.lastExecutionAt).getTime() : -1;
      const candidateTs = startedAt ? new Date(startedAt).getTime() : -1;
      if (candidateTs >= currentTs) {
        current.lastExecutionAt = startedAt;
        current.lastStatus = status;
      }

      stats.set(scenarioId, current);
    }
  }

  return stats;
}

function resolveJourneyLabels(mapping, journeyTree) {
  const fallback = {
    domainId: mapping.domainId,
    domainName: mapping.domainId,
    journeyId: mapping.journeyId,
    journeyName: mapping.journeyId,
    stepId: mapping.stepId,
    stepName: mapping.stepId,
  };

  if (!journeyTree || !Array.isArray(journeyTree.domains)) return fallback;
  const domain = journeyTree.domains.find((item) => item.id === mapping.domainId);
  if (!domain) return fallback;

  const journey = (domain.journeys || []).find((item) => item.id === mapping.journeyId);
  if (!journey) {
    return {
      ...fallback,
      domainName: domain.name,
    };
  }

  const step = (journey.steps || []).find((item) => item.id === mapping.stepId);
  return {
    domainId: domain.id,
    domainName: domain.name,
    journeyId: journey.id,
    journeyName: journey.name,
    stepId: mapping.stepId,
    stepName: step?.name || mapping.stepId,
  };
}

function computeStatusByRule({ scenarioStats = [], totalScenarios = 0 } = {}) {
  if (totalScenarios <= 0) {
    return {
      status: 'WARNING',
      successRate: 0,
      executedRate: 0,
      totalScenarios: 0,
      executedScenarios: 0,
      failedScenarios: 0,
      criticalFailures: 0,
    };
  }

  const executedScenarios = scenarioStats.filter((item) => item.runs > 0).length;
  const failedScenarios = scenarioStats.filter((item) => item.lastStatus === 'failure').length;
  const successScenarios = scenarioStats.filter((item) => item.lastStatus === 'success').length;
  const criticalFailures = scenarioStats.filter((item) => item.critical && item.lastStatus === 'failure').length;

  const successRate = Math.round((successScenarios / totalScenarios) * 100);
  const executedRate = Math.round((executedScenarios / totalScenarios) * 100);

  let status = 'GO';
  if (criticalFailures > 0) {
    status = 'NO_GO';
  } else if (successRate < 80) {
    status = 'WARNING';
  }

  return {
    status,
    successRate,
    executedRate,
    totalScenarios,
    executedScenarios,
    failedScenarios,
    criticalFailures,
  };
}

function computeStepStatus(step, scenarioStatsIndex, scenarioIndex) {
  const subJourneys = Array.isArray(step.subJourneys) ? step.subJourneys : [];
  const scenarioIds = Array.from(new Set(subJourneys.flatMap((item) => item.scenarios || [])));

  const scenarioStats = scenarioIds.map((scenarioId) => {
    const stat = scenarioStatsIndex.get(scenarioId) || {
      scenarioId,
      runs: 0,
      success: 0,
      failure: 0,
      executing: 0,
      pending: 0,
      lastStatus: 'pending',
      lastExecutionAt: null,
      critical: ['blocking', 'high'].includes(String(scenarioIndex.get(scenarioId)?.criticality || '').toLowerCase()),
    };

    return {
      ...stat,
      name: scenarioIndex.get(scenarioId)?.flow || scenarioIndex.get(scenarioId)?.name || scenarioId,
    };
  });

  const base = computeStatusByRule({ scenarioStats, totalScenarios: scenarioIds.length });
  const lastExecutionAt = scenarioStats
    .map((item) => item.lastExecutionAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

  const failureRate = scenarioIds.length > 0
    ? Math.round((scenarioStats.filter((item) => item.lastStatus === 'failure').length / scenarioIds.length) * 100)
    : 0;

  const riskScore = Math.min(100, (base.criticalFailures > 0 ? 70 : 0) + failureRate);

  return {
    stepId: step.id,
    stepName: step.name,
    subJourneys: subJourneys.map((subJourney) => ({
      id: subJourney.id,
      name: subJourney.name || subJourney.id,
      scenarios: (subJourney.scenarios || []).map((scenarioId) => {
        const detail = scenarioStats.find((item) => item.scenarioId === scenarioId);
        return {
          id: scenarioId,
          name: detail?.name || scenarioId,
          status: detail?.lastStatus || 'pending',
          critical: Boolean(detail?.critical),
          lastExecutionAt: detail?.lastExecutionAt || null,
          runs: detail?.runs || 0,
        };
      }),
    })),
    scenarios: scenarioStats,
    scenarioIds,
    coverage: base.successRate,
    lastExecutionAt,
    riskScore,
    ...base,
  };
}

function computeJourneyStatus(journey, scenarioStatsIndex, scenarioIndex) {
  const steps = Array.isArray(journey.steps) ? journey.steps : [];
  const stepStatuses = steps.map((step) => computeStepStatus(step, scenarioStatsIndex, scenarioIndex));
  const allScenarioStats = stepStatuses.flatMap((step) => step.scenarios);
  const totalScenarios = allScenarioStats.length;
  const base = computeStatusByRule({ scenarioStats: allScenarioStats, totalScenarios });

  return {
    journeyId: journey.id,
    journeyName: journey.name,
    status: base.status,
    successRate: base.successRate,
    executedRate: base.executedRate,
    totalScenarios: base.totalScenarios,
    executedScenarios: base.executedScenarios,
    failedScenarios: base.failedScenarios,
    criticalFailures: base.criticalFailures,
    steps: stepStatuses,
  };
}

function buildJourneyTreeWithStatus() {
  const scenarioIndex = buildScenarioMetadataIndex();
  const scenarioStats = collectScenarioLatestStats();
  const journeyTree = buildJourneyRegistry({ meshRegistry: Array.from(scenarioIndex.values()) });

  const domains = (journeyTree.domains || []).map((domain) => {
    const journeys = (domain.journeys || []).map((journey) => computeJourneyStatus(journey, scenarioStats, scenarioIndex));
    return {
      id: domain.id,
      name: domain.name,
      journeys,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    domains,
  };
}

function listJourneys() {
  return buildJourneyTreeWithStatus();
}

function listJourneyStatus() {
  const tree = buildJourneyTreeWithStatus();
  return {
    generatedAt: tree.generatedAt,
    items: tree.domains.flatMap((domain) =>
      (domain.journeys || []).map((journey) => ({
        domainId: domain.id,
        domainName: domain.name,
        journeyId: journey.journeyId,
        journeyName: journey.journeyName,
        status: journey.status,
        successRate: journey.successRate,
        executedRate: journey.executedRate,
        totalScenarios: journey.totalScenarios,
        failedScenarios: journey.failedScenarios,
        criticalFailures: journey.criticalFailures,
      }))
    ),
  };
}

function listStepStatus(options = {}) {
  const tree = buildJourneyTreeWithStatus();
  const journeyFilter = options.journeyId ? String(options.journeyId) : null;
  const stepFilter = options.stepId ? String(options.stepId) : null;

  const items = [];
  for (const domain of tree.domains || []) {
    for (const journey of domain.journeys || []) {
      if (journeyFilter && journey.journeyId !== journeyFilter) continue;
      for (const step of journey.steps || []) {
        if (stepFilter && step.stepId !== stepFilter) continue;
        items.push({
          domainId: domain.id,
          domainName: domain.name,
          journeyId: journey.journeyId,
          journeyName: journey.journeyName,
          stepId: step.stepId,
          stepName: step.stepName,
          status: step.status,
          successRate: step.successRate,
          executedRate: step.executedRate,
          totalScenarios: step.totalScenarios,
          failedScenarios: step.failedScenarios,
          criticalFailures: step.criticalFailures,
          riskScore: step.riskScore,
          lastExecutionAt: step.lastExecutionAt,
        });
      }
    }
  }

  return {
    generatedAt: tree.generatedAt,
    items,
  };
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
  const scenarioIndex = buildScenarioMetadataIndex();
  const journeyTree = buildJourneyRegistry({ meshRegistry: Array.from(scenarioIndex.values()) });
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
      const scenarioMeta = scenarioIndex.get(scenarioId) || {};
      const journeyMapping = mapScenarioToJourney({
        id: scenarioId,
        domain: scenarioMeta.domain || scenario.domain,
        flow: scenarioMeta.flow || scenario.flow || scenario.name,
        type: scenarioMeta.type || scenario.type,
      });
      const labels = resolveJourneyLabels(journeyMapping, journeyTree);

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
        domainId: labels.domainId,
        domainName: labels.domainName,
        journeyId: labels.journeyId,
        journeyName: labels.journeyName,
        stepId: labels.stepId,
        stepName: labels.stepName,
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
    journeyId,
    stepId,
    domainId,
    failure,
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
  if (domainId) {
    replays = replays.filter((item) => item.domainId === domainId);
  }
  if (journeyId) {
    replays = replays.filter((item) => item.journeyId === journeyId);
  }
  if (stepId) {
    replays = replays.filter((item) => item.stepId === stepId);
  }
  if (boolFromQuery(failure)) {
    replays = replays.filter((item) => item.status === 'failure');
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
  listJourneys,
  listJourneyStatus,
  listStepStatus,
  computeJourneyStatus,
  listReplays,
  getReplayById,
  queueWaveExecution,
  reexecuteReplay,
};
