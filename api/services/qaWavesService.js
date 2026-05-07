'use strict';

const fs = require('fs');
const path = require('path');
const qaMeshService = require('./qaMeshService');
const { getRpaReplayDir } = require('../../lib/rpaPathResolver');

const ROOT_DIR = path.join(__dirname, '..', '..');
const HISTORY_DIR_CANDIDATES = [
  path.join(ROOT_DIR, 'qa-mesh', 'meshHistory'),
  path.join(ROOT_DIR, 'qa-mesh', 'system-validate', 'meshHistory'),
  path.join(ROOT_DIR, 'qa-mesh', 'meshEvidence'),
];
const JOURNEY_STORE_PATH = path.join(ROOT_DIR, 'qa', 'qa-waves', 'journey-store.json');
const SCENARIO_STORE_PATH = path.join(ROOT_DIR, 'qa', 'qa-waves', 'scenario-store.json');
const MAX_SCREENSHOT_SIZE_BYTES = 5 * 1024 * 1024;
const screenshotDataUrlCache = new Map();
let cachedJourneyStore = null;
let cachedScenarioStore = null;

function toLabelFromId(value, fallback = 'Item') {
  const normalized = String(value || '').trim();
  if (!normalized) return fallback;
  return normalized
    .split(/[_:\-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

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

function loadJourneyStore() {
  if (cachedJourneyStore) return cachedJourneyStore;
  try {
    if (fs.existsSync(JOURNEY_STORE_PATH)) {
      const content = fs.readFileSync(JOURNEY_STORE_PATH, 'utf8');
      const data = JSON.parse(content);
      cachedJourneyStore = Array.isArray(data.journeys) ? data.journeys : [];
      return cachedJourneyStore;
    }
  } catch (error) {
    // Falha ao carregar; retorna vazio
  }
  cachedJourneyStore = [];
  return cachedJourneyStore;
}

function loadScenarioStore() {
  if (cachedScenarioStore) return cachedScenarioStore;
  try {
    if (fs.existsSync(SCENARIO_STORE_PATH)) {
      const content = fs.readFileSync(SCENARIO_STORE_PATH, 'utf8');
      const data = JSON.parse(content);
      cachedScenarioStore = Array.isArray(data.scenarios) ? data.scenarios : [];
      return cachedScenarioStore;
    }
  } catch (error) {
    // Falha ao carregar; retorna vazio
  }
  cachedScenarioStore = [];
  return cachedScenarioStore;
}

function buildJourneyStoreFromScenarioStore(scenarios = []) {
  const journeys = new Map();

  for (const scenario of scenarios) {
    const vertical = String(scenario?.vertical || scenario?.domain || '').trim() || 'core';
    const journeyId = String(scenario?.journeyId || scenario?.journey || '').trim();
    if (!journeyId) continue;

    const key = `${vertical}::${journeyId}`;
    const current = journeys.get(key) || {
      id: journeyId,
      title: toLabelFromId(journeyId, journeyId),
      vertical,
      script: { steps: [] },
    };

    const steps = Array.isArray(scenario?.steps) && scenario.steps.length > 0
      ? scenario.steps
      : (Array.isArray(scenario?.semanticSteps) ? scenario.semanticSteps : []);

    for (const step of steps) {
      const stepId = String(step?.id || '').trim();
      if (!stepId) continue;
      if (current.script.steps.some((item) => item.id === stepId)) continue;
      current.script.steps.push({
        id: stepId,
        name: step?.name || toLabelFromId(stepId, stepId),
      });
    }

    journeys.set(key, current);
  }

  return Array.from(journeys.values());
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

function collectWaveEvidenceStats(stats = new Map()) {
  const evidenceBaseDir = path.join(ROOT_DIR, 'qa-mesh', 'meshEvidence');
  if (!fs.existsSync(evidenceBaseDir)) return stats;

  let waveDirs;
  try {
    waveDirs = fs.readdirSync(evidenceBaseDir).filter((entry) => {
      try {
        return fs.statSync(path.join(evidenceBaseDir, entry)).isDirectory();
      } catch (_) {
        return false;
      }
    });
  } catch (_) {
    return stats;
  }

  for (const waveDir of waveDirs) {
    const waveFullDir = path.join(evidenceBaseDir, waveDir);
    let files;
    try {
      files = fs.readdirSync(waveFullDir).filter((f) => f.startsWith('meshq-') && f.endsWith('.json'));
    } catch (_) {
      continue;
    }

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(waveFullDir, file), 'utf8');
        const evidence = JSON.parse(raw);
        const scenarioId = String(evidence.scenarioId || '').trim();
        if (!scenarioId) continue;

        const startedAt = evidence.generatedAt || evidence.startedAt || null;
        const status = normalizeStatus(evidence.status);

        const current = stats.get(scenarioId) || {
          scenarioId,
          runs: 0,
          success: 0,
          failure: 0,
          executing: 0,
          pending: 0,
          lastStatus: null,
          lastExecutionAt: null,
          critical: false,
        };

        current.runs += 1;
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
      } catch (_) {
        // Ignora arquivos de evidência malformados
      }
    }
  }

  return stats;
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

  // Complementar com execuções disparadas pela UI (meshEvidence/waveId/meshq-*.json)
  collectWaveEvidenceStats(stats);

  return stats;
}

function getScenarioCandidateIds(scenario = {}) {
  const ids = new Set();

  const primaryId = String(scenario.id || scenario.scenarioId || '').trim();
  if (primaryId) ids.add(primaryId);

  const topLevelPlatformIds = Array.isArray(scenario.platformScenarioIds)
    ? scenario.platformScenarioIds
    : [];
  for (const platformId of topLevelPlatformIds) {
    const normalized = String(platformId || '').trim();
    if (normalized) ids.add(normalized);
  }

  const nestedPlatformIds = Array.isArray(scenario.platform?.platformScenarioIds)
    ? scenario.platform.platformScenarioIds
    : [];
  for (const platformId of nestedPlatformIds) {
    const normalized = String(platformId || '').trim();
    if (normalized) ids.add(normalized);
  }

  return Array.from(ids);
}

function resolveScenarioStat(scenario = {}, scenarioStats = new Map()) {
  const candidateIds = getScenarioCandidateIds(scenario);
  const matches = candidateIds
    .map((id) => scenarioStats.get(id))
    .filter(Boolean);

  const fallback = {
    scenarioId: String(scenario.id || scenario.scenarioId || '').trim(),
    runs: 0,
    success: 0,
    failure: 0,
    executing: 0,
    pending: 0,
    lastStatus: 'pending',
    lastExecutionAt: null,
    critical: scenario.criticality === 'blocking' || scenario.criticality === 'high',
  };

  if (matches.length === 0) {
    return fallback;
  }

  const merged = {
    ...fallback,
    runs: 0,
    success: 0,
    failure: 0,
    executing: 0,
    pending: 0,
  };

  for (const stat of matches) {
    merged.runs += Number(stat.runs || 0);
    merged.success += Number(stat.success || 0);
    merged.failure += Number(stat.failure || 0);
    merged.executing += Number(stat.executing || 0);
    merged.pending += Number(stat.pending || 0);
    merged.critical = merged.critical || Boolean(stat.critical);

    const currentTs = merged.lastExecutionAt ? new Date(merged.lastExecutionAt).getTime() : -1;
    const candidateTs = stat.lastExecutionAt ? new Date(stat.lastExecutionAt).getTime() : -1;
    if (candidateTs >= currentTs) {
      merged.lastExecutionAt = stat.lastExecutionAt || merged.lastExecutionAt;
      merged.lastStatus = stat.lastStatus || merged.lastStatus;
    }
  }

  if (merged.runs > 0 && (!merged.lastStatus || merged.lastStatus === 'pending')) {
    if (merged.failure > 0) merged.lastStatus = 'failure';
    else if (merged.success > 0) merged.lastStatus = 'success';
  }

  return merged;
}

function buildJourneyTreeWithStatus() {
  const scenarioStore = loadScenarioStore();
  const storedJourneys = loadJourneyStore();
  const journeyStore = storedJourneys.length > 0
    ? storedJourneys
    : buildJourneyStoreFromScenarioStore(scenarioStore);
  const scenarioStats = collectScenarioLatestStats();

  // Agrupar jornadas por vertical (domínio)
  const byVertical = new Map();
  for (const journey of journeyStore) {
    const vertical = journey.vertical || 'core';
    if (!byVertical.has(vertical)) {
      byVertical.set(vertical, []);
    }
    byVertical.get(vertical).push(journey);
  }

  const domains = Array.from(byVertical.entries()).map(([vertical, journeys]) => {
    const journeyDetails = journeys.map((journey) => {
      // Buscar cenários desta jornada
      const scenariosForJourney = scenarioStore.filter((s) => s.journeyId === journey.id);
      
      // Computar stats dos cenários
      const stats = scenariosForJourney.map((scenario) => resolveScenarioStat(scenario, scenarioStats));

      // Contar falhas críticas
      const failedScenarios = stats.filter((s) => s.lastStatus === 'failure').length;
      const criticalFailures = stats.filter((s) => s.critical && s.lastStatus === 'failure').length;
      const executingScenarios = stats.filter((s) => s.lastStatus === 'executing').length;
      const totalRuns = stats.reduce((sum, s) => sum + s.runs, 0);
      const successfulRuns = stats.reduce((sum, s) => sum + s.success, 0);
      const successRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0;
      const executedRate = stats.length > 0 ? Math.round((stats.filter((s) => s.runs > 0).length / stats.length) * 100) : 0;

      const lastExecutionAt = stats
        .map((s) => s.lastExecutionAt)
        .filter(Boolean)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

      // Determinar status geral
      let status = 'pending';
      if (criticalFailures > 0) status = 'failure';
      else if (failedScenarios > 0) status = 'warning';
      else if (executingScenarios > 0) status = 'executing';
      else if (successRate === 100 && executedRate > 0) status = 'success';
      else if (executedRate > 0) status = 'warning';

      // Construir steps a partir de script.steps
      const steps = ((journey.script && journey.script.steps) || []).map((step, index) => ({
        stepId: step.id || `step-${index + 1}`,
        stepName: step.name || `Passo ${index + 1}`,
        totalScenarios: scenariosForJourney.length,
        failedScenarios,
        criticalFailures,
        status,
        successRate,
        executedRate,
        riskScore: Math.min(100, (criticalFailures > 0 ? 70 : 0) + (100 - successRate)),
        lastExecutionAt,
      }));

      return {
        journeyId: journey.id,
        journeyName: journey.title || journey.id,
        status,
        successRate,
        executedRate,
        totalScenarios: scenariosForJourney.length,
        failedScenarios,
        criticalFailures,
        lastExecutionAt,
        steps,
      };
    });

    return {
      id: vertical,
      name: vertical,
      journeys: journeyDetails,
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

function saveJourney(journey = {}) {
  const id = String(journey.id || '').trim();
  const vertical = String(journey.vertical || '').trim();
  if (!id) throw Object.assign(new Error('id é obrigatório'), { code: 'BAD_REQUEST' });
  if (!vertical) throw Object.assign(new Error('vertical é obrigatório'), { code: 'BAD_REQUEST' });

  const store = loadJourneyStore();
  const now = new Date().toISOString();
  const index = store.findIndex((j) => j.id === id && j.vertical === vertical);
  const record = {
    id,
    title: String(journey.title || id),
    vertical,
    script: journey.script && typeof journey.script === 'object' ? journey.script : { steps: [] },
    createdAt: index >= 0 ? (store[index].createdAt || now) : now,
    updatedAt: now,
  };

  if (index >= 0) {
    store[index] = { ...store[index], ...record };
  } else {
    store.push(record);
  }

  cachedJourneyStore = store;
  const dir = require('path').dirname(JOURNEY_STORE_PATH);
  if (!require('fs').existsSync(dir)) require('fs').mkdirSync(dir, { recursive: true });
  require('fs').writeFileSync(JOURNEY_STORE_PATH, JSON.stringify({ journeys: store, updatedAt: now }, null, 2), 'utf8');
  return record;
}

function deleteJourney(journeyId, vertical) {
  if (!journeyId) throw Object.assign(new Error('journeyId é obrigatório'), { code: 'BAD_REQUEST' });
  const store = loadJourneyStore();
  const index = vertical
    ? store.findIndex((j) => j.id === journeyId && j.vertical === vertical)
    : store.findIndex((j) => j.id === journeyId);
  if (index < 0) throw Object.assign(new Error(`Jornada não encontrada: ${journeyId}`), { code: 'NOT_FOUND' });
  const [removed] = store.splice(index, 1);
  cachedJourneyStore = store;
  const now = new Date().toISOString();
  require('fs').writeFileSync(JOURNEY_STORE_PATH, JSON.stringify({ journeys: store, updatedAt: now }, null, 2), 'utf8');
  return { deleted: true, journeyId: removed.id, vertical: removed.vertical };
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
  const scenarioStore = loadScenarioStore();
  const journeyStore = loadJourneyStore();
  
  // Criar mapas para busca rápida
  const scenarioMap = new Map(scenarioStore.map((s) => [s.id, s]));
  const journeyMap = new Map(journeyStore.map((j) => [j.id, j]));
  
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
      
      // Buscar no scenario-store explícito
      const scenarioMeta = scenarioMap.get(scenarioId) || {};
      const journeyId = scenarioMeta.journeyId || scenario.journeyId;
      const journey = journeyId ? journeyMap.get(journeyId) : null;
      
      // Determinar domain/vertical
      const vertical = journey?.vertical || scenario.domain || 'core';
      
      // Montar labels
      const domainId = vertical;
      const domainName = vertical;
      const journeyName = journey?.title || journeyId || 'Unknown';
      
      // Extrair stepId do primeiro passo se houver
      const steps = journey?.script?.steps || [];
      const stepId = steps.length > 0 ? steps[0].id : 'step-1';
      const stepName = steps.length > 0 ? steps[0].name : 'Step 1';

      replays.push({
        id: `${executionSeed}::${scenarioId}`,
        executionId: executionSeed,
        scenarioId,
        waveId: `wave-${vertical}`,
        waveName: `Wave ${vertical}`,
        itemId: scenarioId,
        itemName: scenario.flow || scenario.name || scenarioMeta.title || scenarioId,
        name: `Replay ${scenarioId}`,
        seed: executionSeed,
        channel: normalizeChannel(scenario.adapter),
        status: normalizeStatus(scenario.status),
        startedAt,
        finishedAt,
        durationMs,
        critical: scenarioMeta.criticality === 'blocking' || scenarioMeta.criticality === 'high',
        domainId,
        domainName,
        journeyId: journeyId || 'unknown',
        journeyName,
        stepId,
        stepName,
      });
    }
  }

  return replays;
}

function sortReplaysNewestFirst(replays = []) {
  return [...replays].sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
}

function loadQueuedReplayArtifactById(id) {
  if (!id || !String(id).startsWith('qa_wave_replay_')) return null;

  try {
    const replayPath = path.join(getRpaReplayDir(), `${id}.json`);
    if (!fs.existsSync(replayPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
    return {
      replayPath,
      data: parsed,
    };
  } catch (_error) {
    return null;
  }
}

function resolveReplayFromQueuedArtifact(artifact = {}, allReplays = []) {
  let candidates = sortReplaysNewestFirst(allReplays);
  const artifactScenarioId = artifact.scenarioId || artifact.recordingId;
  const platformIds = Array.isArray(artifact.platformScenarioIds) ? artifact.platformScenarioIds.filter(Boolean) : [];

  if (artifact.executionId) {
    const byExecution = candidates.filter((item) => item.executionId === artifact.executionId);
    if (byExecution.length === 0) return null;
    candidates = byExecution;
  }

  // Busca pelo scenarioId semântico da wave primeiro
  if (artifactScenarioId) {
    const byScenario = candidates.filter((item) => (
      item.scenarioId === artifactScenarioId || item.itemId === artifactScenarioId
    ));
    if (byScenario.length > 0) return byScenario[0];
  }

  // Busca pelos platformScenarioIds (ex: qa-core-auth-login quando business-f1 foi substituído)
  if (platformIds.length > 0) {
    const byPlatform = candidates.filter((item) => (
      platformIds.includes(item.scenarioId) || platformIds.includes(item.itemId)
    ));
    if (byPlatform.length > 0) return byPlatform[0];
  }

  if (artifact.journeyId) {
    const byJourney = candidates.filter((item) => item.journeyId === artifact.journeyId);
    if (byJourney.length > 0) return byJourney[0];
  }

  if (artifact.executionId) return candidates[0] || null;
  if (artifact.executionId || artifactScenarioId || artifact.journeyId) return null;
  return candidates[0] || null;
}

function mapAssertionStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'passed' || normalized === 'success') return 'success';
  if (normalized === 'failed' || normalized === 'failure' || normalized === 'error') return 'failure';
  if (normalized === 'queued') return 'pending';
  return 'pending';
}

function buildQueuedArtifactReplayPayload(id, artifactData, replayPath) {
  const assertions = Array.isArray(artifactData?.assertions) ? artifactData.assertions : [];
  const stepsFromAssertions = assertions.map((item, index) => ({
    id: item?.id || `assertion-${index + 1}`,
    index: index + 1,
    title: item?.type ? `Validacao: ${item.type}` : 'Validacao pendente',
    at: null,
    status: mapAssertionStatus(item?.status),
  }));

  return {
    id: artifactData?.replayId || artifactData?.id || id,
    replayId: artifactData?.replayId || artifactData?.id || id,
    executionId: artifactData?.executionId || null,
    scenarioId: artifactData?.scenarioId || artifactData?.recordingId || null,
    waveId: artifactData?.waveId || null,
    waveName: artifactData?.waveId || null,
    itemId: artifactData?.scenarioId || artifactData?.recordingId || null,
    itemName: artifactData?.scenarioName || artifactData?.recordingId || id,
    name: artifactData?.scenarioName
      ? `Replay ${artifactData.scenarioName}`
      : `Replay ${artifactData?.recordingId || id}`,
    channel: 'webchat',
    status: String(artifactData?.status || artifactData?.result || 'queued').toLowerCase(),
    startedAt: artifactData?.startedAt || artifactData?.startTime || null,
    finishedAt: artifactData?.finishedAt || artifactData?.endTime || null,
    durationMs: Number(artifactData?.durationMs) || 0,
    journeyId: artifactData?.journeyId || null,
    journeyName: artifactData?.journeyId || null,
    stepId: artifactData?.stepId || null,
    stepName: artifactData?.stepId || null,
    steps: stepsFromAssertions,
    typedEntries: [],
    source: {
      executionId: artifactData?.executionId || null,
      scenarioId: artifactData?.scenarioId || artifactData?.recordingId || null,
      historyFile: replayPath || null,
      logsCount: Array.isArray(artifactData?.logs) ? artifactData.logs.length : 0,
    },
  };
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
  const allReplays = flattenReplays(250);
  const queuedArtifact = loadQueuedReplayArtifactById(id);

  if (queuedArtifact) {
    const artifact = queuedArtifact.data || {};
    const resolvedReplay = resolveReplayFromQueuedArtifact(artifact, allReplays);

    const baseReplay = resolvedReplay || buildQueuedArtifactReplayPayload(id, artifact, queuedArtifact.replayPath);
    const executionIndex = buildExecutionLogIndex();
    const executionEntry = executionIndex.get(baseReplay.executionId);
    const scenarioEntry = executionEntry?.get(baseReplay.scenarioId);
    const logs = Array.isArray(scenarioEntry?.logs) ? scenarioEntry.logs : [];
    const typedEntries = extractTypedEntriesFromLogs(logs);

    const explicitSteps = Array.isArray(artifact.steps) ? artifact.steps : [];
    const steps = explicitSteps.length > 0
      ? explicitSteps
      : extractPlaybackSteps(logs, baseReplay);

    return {
      ...baseReplay,
      id: artifact.replayId || artifact.id || baseReplay.id,
      replayId: artifact.replayId || artifact.id || baseReplay.replayId || baseReplay.id,
      executionId: artifact.executionId || baseReplay.executionId,
      scenarioId: artifact.scenarioId || baseReplay.scenarioId,
      waveId: artifact.waveId || baseReplay.waveId,
      journeyId: artifact.journeyId || baseReplay.journeyId,
      startedAt: artifact.startedAt || artifact.startTime || baseReplay.startedAt,
      finishedAt: artifact.finishedAt || artifact.endTime || baseReplay.finishedAt,
      durationMs: Number(artifact.durationMs) || baseReplay.durationMs || 0,
      status: normalizeStatus(artifact.status || artifact.result || baseReplay.status),
      steps,
      rpaSteps: Array.isArray(artifact.rpaSteps) ? artifact.rpaSteps : [],
      journeySteps: Array.isArray(artifact.journeySteps) ? artifact.journeySteps : [],
      events: Array.isArray(artifact.events) ? artifact.events : [],
      decisions: Array.isArray(artifact.decisions) ? artifact.decisions : [],
      evidence: Array.isArray(artifact.evidence) ? artifact.evidence : [],
      errors: Array.isArray(artifact.errors) ? artifact.errors : [],
      typedEntries,
      source: {
        executionId: artifact.executionId || baseReplay.executionId,
        scenarioId: artifact.scenarioId || baseReplay.scenarioId,
        historyFile: scenarioEntry?.sourceFile || queuedArtifact.replayPath || null,
        logsCount: logs.length,
      },
    };
  }

  const replay = allReplays.find((entry) => entry.id === id);
  if (!replay) return null;

  const executionIndex = buildExecutionLogIndex();
  const executionEntry = executionIndex.get(replay.executionId);
  const scenarioEntry = executionEntry?.get(replay.scenarioId);
  const logs = Array.isArray(scenarioEntry?.logs) ? scenarioEntry.logs : [];

  const typedEntries = extractTypedEntriesFromLogs(logs);
  const playbackSteps = Array.isArray(replay.steps) && replay.steps.length > 0
    ? replay.steps
    : extractPlaybackSteps(logs, replay);

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
  return qaMeshService.queueMeshRun({ scenarioIds, executionOrigin: 'qa_waves_real' });
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

function getExecutionStatus(executionId) {
  if (!executionId || !String(executionId).trim()) return null;

  const cleanId = String(executionId).trim();

  // Primeiro tenta resolver em memória (fila de execução),
  // pois o arquivo de histórico pode ainda não existir nos primeiros segundos.
  const queuedExecution = qaMeshService.getQueuedExecutionStatus(cleanId);
  if (queuedExecution) {
    const rawStatus = String(queuedExecution.status || '').toLowerCase();
    const status = rawStatus === 'completed'
      ? 'success'
      : (rawStatus === 'failed' ? 'failed' : 'processing');

    const startedAt = queuedExecution.startedAt || queuedExecution.createdAt || null;
    const finishedAt = queuedExecution.finishedAt || null;
    const durationMs = startedAt
      ? (finishedAt
        ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
        : Math.max(0, Date.now() - new Date(startedAt).getTime()))
      : 0;

    const progress = Number.isFinite(queuedExecution.progress)
      ? Math.max(0, Math.min(100, Number(queuedExecution.progress)))
      : 0;

    const results = Array.isArray(queuedExecution.results) ? queuedExecution.results : [];

    const currentScenarioId = queuedExecution.currentScenarioId || null;
    const currentStepLabel = typeof queuedExecution.currentStep === 'string'
      ? queuedExecution.currentStep.trim()
      : '';

    return {
      executionId: cleanId,
      status,
      progress,
      startedAt,
      finishedAt,
      durationMs,
      summary: queuedExecution.summary || {
        total: results.length || 0,
        attempted: results.length || 0,
        executed: results.length || 0,
        passed: 0,
        failed: rawStatus === 'failed' ? 1 : 0,
        skipped: 0,
        goNoGo: rawStatus === 'failed' ? 'NO_GO' : 'UNKNOWN',
        executionCoverage: 0,
        executionQuality: 'pending',
      },
      currentStep: (currentScenarioId || currentStepLabel)
        ? {
          scenarioId: currentScenarioId,
          scenarioName: currentScenarioId,
          label: currentStepLabel || null,
          status,
          startedAt,
          finishedAt,
        }
        : null,
      results,
    };
  }

  // Procura o arquivo de histórico com esse executionId
  for (const historyDir of HISTORY_DIR_CANDIDATES) {
    if (!fs.existsSync(historyDir)) continue;
    
    const filePath = path.join(historyDir, `${cleanId}.json`);
    // Também tenta procurar em {historyDir}/{executionId}/summary.json para meshEvidence
    let dataPath = filePath;
    if (!fs.existsSync(dataPath)) {
      dataPath = path.join(historyDir, cleanId, 'summary.json');
    }
    if (!fs.existsSync(dataPath)) continue;

    try {
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      const summary = data.summary || {};
      const results = Array.isArray(data.results) ? data.results : [];

      const startedAt = data.startedAt || summary.timestamp;
      const finishedAt = data.finishedAt;
      const durationMs = finishedAt
        ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
        : Date.now() - new Date(startedAt).getTime();

      // Determina o status
      let status = 'processing';
      if (finishedAt) {
        status = summary.goNoGo === 'GO' ? 'success' : 'failed';
      }

      // Calcula o progresso
      const totalScenarios = summary.total || summary.attempted || results.length || 1;
      const executed = summary.executed || summary.passed || summary.failed || 0;
      const progress = Math.round((executed / Math.max(1, totalScenarios)) * 100);

      // Extrai informações de qual step está em execução
      let currentStep = null;
      if (results.length > 0) {
        const lastResult = results[results.length - 1];
        currentStep = {
          scenarioId: lastResult.id || lastResult.scenarioId,
          scenarioName: lastResult.flow || lastResult.name || 'Cenario',
          status: normalizeStatus(lastResult.status),
          startedAt: lastResult.startedAt,
          finishedAt: lastResult.finishedAt,
        };
      }

      return {
        executionId: cleanId,
        status,
        progress,
        startedAt,
        finishedAt,
        durationMs,
        summary: {
          total: totalScenarios,
          attempted: summary.attempted || executed,
          executed,
          passed: summary.passed || 0,
          failed: summary.failed || 0,
          skipped: summary.skipped || 0,
          goNoGo: summary.goNoGo || 'UNKNOWN',
          executionCoverage: summary.executionCoverage || 0,
          executionQuality: summary.executionQuality || 'unknown',
        },
        currentStep,
        results: results.map((r) => ({
          scenarioId: r.id || r.scenarioId,
          status: normalizeStatus(r.status),
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          durationMs: r.durationMs || 0,
        })),
      };
    } catch (_error) {
      // Ignora erro de parsing e tenta próximo diretório
    }
  }

  return null;
}

module.exports = {
  listWaves,
  listJourneys,
  saveJourney,
  deleteJourney,
  listJourneyStatus,
  listStepStatus,
  listReplays,
  getReplayById,
  queueWaveExecution,
  reexecuteReplay,
  getExecutionStatus,
  collectScenarioLatestStats,
};
