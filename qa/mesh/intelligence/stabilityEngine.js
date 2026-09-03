'use strict';

/**
 * stabilityEngine — engine rico de snapshot de estabilidade do QA Mesh.
 *
 * RESTAURAÇÃO (2026-09-03): este engine é a versão rica que existia antes do
 * commit 5044127a (2026-05-03), que o substituiu por uma versão minimalista e
 * deixou qa/mesh/intelligence/stabilitySnapshot.json STALE (score 71.25,
 * verticais beauty/fitness "blocked", sem bakery). Base: `git show
 * 5044127a^:qa/mesh/intelligence/stabilityEngine.js`.
 *
 * Diferença em relação à versão histórica: as verticais NÃO são mais
 * hardcoded — são lidas de config/verticals.json (fonte canônica, chaves de
 * `domains` com kind==="vertical", incl. bakery/padaria), com fallback para a
 * lista antiga caso o config não exista. Aliases do config (ex.: "padaria")
 * também resolvem em classifyVertical.
 *
 * Contrato: generateStabilitySnapshot({ execution }) retorna
 * { snapshot, outputPath } e GRAVA o snapshot rico
 * (global/domains/channels/verticals/failures/releaseGate/checkpoints) em
 * qa/mesh/intelligence/stabilitySnapshot.json — consumido por
 * api/services/qaMeshService.js (GET /qa/stability) e pela StabilityPage.
 * Chamado por qa-mesh/meshRunner.js ao fim de cada execução do mesh.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const MESH_HISTORY_DIR = path.join(ROOT, 'qa-mesh', 'meshHistory');
const CHECKPOINT_WAVES_DIR = path.join(ROOT, 'qa', 'checkpoints', 'waves');
const CHECKPOINT_STATE_DIR = path.join(ROOT, 'qa', 'checkpoints', 'state');
// Override por env permite hermetizar testes (mesmo padrão de
// QA_MESH_HISTORY_CHAIN_PATH/QA_MESH_BASELINE_PATH em qa-mesh/__tests__/meshRunner.test.js),
// evitando que execuções sintéticas de teste sobrescrevam o snapshot real.
const SNAPSHOT_PATH = process.env.QA_MESH_STABILITY_SNAPSHOT_PATH
  || path.join(ROOT, 'qa', 'mesh', 'intelligence', 'stabilitySnapshot.json');
const VERTICALS_CONFIG_PATH = path.join(ROOT, 'config', 'verticals.json');

// Fallback histórico (pré-config/verticals.json), usado só se o config canônico
// não puder ser lido. A fonte de verdade é config/verticals.json.
const FALLBACK_VERTICALS = ['beauty', 'fitness', 'food', 'services', 'clinic', 'market'];
const CHANNELS = ['whatsapp', 'chat', 'pbx', 'api'];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizePct(value) {
  return Number(clamp(value, 0, 100).toFixed(2));
}

/**
 * loadVerticalRegistry — lê config/verticals.json e retorna
 * [{ id, aliases }] para as chaves de `domains` com kind === "vertical".
 * Fallback para FALLBACK_VERTICALS se o config não existir/estiver inválido.
 */
function loadVerticalRegistry() {
  const config = safeReadJson(VERTICALS_CONFIG_PATH, null);
  const domains = config && typeof config === 'object' ? config.domains : null;
  if (!domains || typeof domains !== 'object') {
    return FALLBACK_VERTICALS.map((id) => ({ id, aliases: [] }));
  }
  const verticals = Object.entries(domains)
    .filter(([, meta]) => meta && meta.kind === 'vertical')
    .map(([id, meta]) => ({
      id,
      aliases: Array.isArray(meta.aliases) ? meta.aliases.map((a) => String(a).toLowerCase()) : [],
    }));
  return verticals.length > 0 ? verticals : FALLBACK_VERTICALS.map((id) => ({ id, aliases: [] }));
}

function loadHistory(limit = 20) {
  return safeReadDir(MESH_HISTORY_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((file) => safeReadJson(path.join(MESH_HISTORY_DIR, file), null))
    .filter(Boolean);
}

function loadWaves() {
  return safeReadDir(CHECKPOINT_WAVES_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => safeReadJson(path.join(CHECKPOINT_WAVES_DIR, file), null))
    .filter(Boolean);
}

function collectFailures(execution) {
  const failures = [];
  for (const item of execution?.results || []) {
    if (item.status === 'passed' || item.status === 'passed_via_fallback') continue;
    failures.push(item);
  }
  return failures;
}

function classifyVertical(domain, verticalRegistry) {
  const registry = verticalRegistry || loadVerticalRegistry();
  const d = String(domain || '').toLowerCase();
  if (!d) return null;
  for (const { id, aliases } of registry) {
    if (d === id || d.includes(id)) return id;
    if (aliases.some((alias) => alias && d.includes(alias))) return id;
  }
  return null;
}

function classifyChannel(domain, scenarioId = '') {
  const source = `${domain || ''} ${scenarioId || ''}`.toLowerCase();
  if (source.includes('pbx') || source.includes('voice')) return 'pbx';
  if (source.includes('whatsapp')) return 'whatsapp';
  if (source.includes('chat') || source.includes('omnichannel') || source.includes('inbox')) return 'chat';
  return 'api';
}

function mapGateStatus(value) {
  if (value === true) return 'pass';
  if (value === false) return 'fail';
  return 'unknown';
}

function buildReleaseGate(latestWave) {
  const validation = latestWave?.validation || {};
  const artifactIntegrity = latestWave ? ((latestWave.status === 'passed' || latestWave.status === 'partial') ? 'pass' : 'fail') : 'unknown';
  return {
    backendBuild: mapGateStatus(validation.buildBackend),
    frontendBuild: mapGateStatus(validation.buildFrontend),
    technicalQA: mapGateStatus(validation.qaTechnical),
    businessQA: mapGateStatus(validation.qaBusiness),
    criticalReplay: mapGateStatus(validation.replay),
    artifactIntegrity,
  };
}

function buildDomainMetrics(execution) {
  const map = new Map();
  for (const result of execution?.results || []) {
    const domain = result.domain || 'core';
    const item = map.get(domain) || {
      name: domain,
      score: 0,
      passRate: 0,
      regressions: 0,
      recurringFailures: 0,
      avgRuntimeMs: 0,
      replayConsistency: 0,
      criticality: 'medium',
      _total: 0,
      _passed: 0,
      _runtime: 0,
      _criticalFail: 0,
    };

    item._total += 1;
    item._runtime += Number(result.durationMs || 0);
    const passed = result.status === 'passed' || result.status === 'passed_via_fallback';
    if (passed) item._passed += 1;
    if (!passed) item.regressions += 1;
    if (!passed && String(result.criticality || '').toLowerCase() === 'blocking') {
      item._criticalFail += 1;
      item.criticality = 'high';
    }
    map.set(domain, item);
  }

  const domains = Array.from(map.values()).map((item) => {
    const passRate = item._total > 0 ? (item._passed / item._total) * 100 : 0;
    const replayConsistency = passRate;
    const score = (passRate * 0.7) + ((100 - Math.min(100, item.regressions * 10)) * 0.3);
    return {
      name: item.name,
      score: normalizePct(score),
      passRate: normalizePct(passRate),
      regressions: item.regressions,
      recurringFailures: item.regressions,
      avgRuntimeMs: item._total > 0 ? Math.round(item._runtime / item._total) : 0,
      replayConsistency: normalizePct(replayConsistency),
      criticality: item._criticalFail > 0 ? 'high' : item.criticality,
    };
  });

  return domains.sort((a, b) => a.score - b.score);
}

function buildVerticalMetrics(execution, verticalRegistry) {
  const registry = verticalRegistry || loadVerticalRegistry();
  const map = new Map(registry.map(({ id }) => [id, {
    name: id,
    scenarios: 0,
    criticalScenarios: 0,
    passed: 0,
    score: 0,
    passRate: 0,
    lastCriticalReplay: null,
    readiness: 'blocked',
  }]));

  for (const result of execution?.results || []) {
    const vertical = classifyVertical(result.domain, registry);
    if (!vertical) continue;
    const item = map.get(vertical);
    item.scenarios += 1;
    if (String(result.criticality || '').toLowerCase() === 'blocking') item.criticalScenarios += 1;
    if (result.status === 'passed' || result.status === 'passed_via_fallback') item.passed += 1;
    if (String(result.criticality || '').toLowerCase() === 'blocking') item.lastCriticalReplay = result.finishedAt || item.lastCriticalReplay;
  }

  return Array.from(map.values()).map((item) => {
    const passRate = item.scenarios > 0 ? (item.passed / item.scenarios) * 100 : 0;
    const readiness = passRate >= 90 ? 'ready' : passRate >= 70 ? 'attention' : 'blocked';
    return {
      ...item,
      passRate: normalizePct(passRate),
      score: normalizePct(passRate),
      readiness,
    };
  });
}

function buildChannelMetrics(execution) {
  const map = new Map(CHANNELS.map((name) => [name, {
    name,
    scenarios: 0,
    passed: 0,
    criticalFailures: 0,
    avgLatencyMs: 0,
    replayConsistency: 0,
    confidenceScore: 0,
    _latency: 0,
  }]));

  for (const result of execution?.results || []) {
    const channel = classifyChannel(result.domain, result.id);
    const item = map.get(channel);
    item.scenarios += 1;
    if (result.status === 'passed' || result.status === 'passed_via_fallback') item.passed += 1;
    if (String(result.criticality || '').toLowerCase() === 'blocking' && result.status !== 'passed') item.criticalFailures += 1;
    item._latency += Number(result.durationMs || 0);
  }

  return Array.from(map.values()).map((item) => {
    const passRate = item.scenarios > 0 ? (item.passed / item.scenarios) * 100 : 0;
    const replayConsistency = passRate;
    const avgLatencyMs = item.scenarios > 0 ? Math.round(item._latency / item.scenarios) : 0;
    const confidenceScore = normalizePct((passRate * 0.6) + ((100 - Math.min(100, item.criticalFailures * 20)) * 0.2) + ((avgLatencyMs === 0 ? 100 : Math.max(0, 100 - (avgLatencyMs / 60))) * 0.2));
    return {
      name: item.name,
      score: confidenceScore,
      passRate: normalizePct(passRate),
      criticalFailures: item.criticalFailures,
      avgLatencyMs,
      replayConsistency: normalizePct(replayConsistency),
      confidenceScore,
    };
  });
}

function buildFailureList(execution, history, verticalRegistry) {
  const current = collectFailures(execution);
  const seen = new Map();
  for (const run of history) {
    for (const item of collectFailures(run)) {
      const sig = `${item.domain || 'core'}.${item.failureType || item.status || 'failed'}.${String(item.errorMessage || item.rootCauseHint || item.id || 'unknown').toLowerCase().replace(/\s+/g, '.').slice(0, 80)}`;
      const data = seen.get(sig) || {
        signature: sig,
        module: item.domain || 'core',
        channel: classifyChannel(item.domain, item.id),
        vertical: classifyVertical(item.domain, verticalRegistry),
        count: 0,
        impact: item.criticality === 'blocking' ? 'high' : 'medium',
        trend: 'new',
        firstSeenAt: item.startedAt || null,
        lastSeenAt: item.finishedAt || null,
      };
      data.count += 1;
      data.lastSeenAt = item.finishedAt || data.lastSeenAt;
      data.firstSeenAt = data.firstSeenAt || item.startedAt || null;
      seen.set(sig, data);
    }
  }

  const currentSignatures = new Set(current.map((item) => `${item.domain || 'core'}.${item.failureType || item.status || 'failed'}.${String(item.errorMessage || item.rootCauseHint || item.id || 'unknown').toLowerCase().replace(/\s+/g, '.').slice(0, 80)}`));

  return Array.from(seen.values())
    .filter((item) => currentSignatures.has(item.signature))
    .map((item) => ({
      ...item,
      trend: item.count > 3 ? 'worsening' : item.count > 1 ? 'recurring' : 'new',
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);
}

function computeGlobalMetrics(execution, releaseGate) {
  const total = Number(execution?.summary?.total || 0);
  const passed = Number(execution?.summary?.passed || 0);
  const failed = Number(execution?.summary?.failed || 0);
  const flaky = Number(execution?.summary?.flaky || 0);
  const passRate = total > 0 ? (passed / total) * 100 : 0;
  const replayConsistency = passRate;
  const criticalTotal = (execution?.results || []).filter((item) => String(item.criticality || '').toLowerCase() === 'blocking').length;
  const criticalPassed = (execution?.results || []).filter((item) => String(item.criticality || '').toLowerCase() === 'blocking' && (item.status === 'passed' || item.status === 'passed_via_fallback')).length;
  const criticalFlowSuccess = criticalTotal > 0 ? (criticalPassed / criticalTotal) * 100 : 100;
  const flakyRate = total > 0 ? (flaky / total) * 100 : 0;

  const gateValues = Object.values(releaseGate);
  const gatePass = gateValues.filter((value) => value === 'pass').length;
  const gateKnown = gateValues.filter((value) => value !== 'unknown').length;
  const releaseGateHealth = gateKnown > 0 ? (gatePass / gateKnown) * 100 : 0;

  const stabilityScore = normalizePct(
    (passRate * 0.35) +
    (replayConsistency * 0.20) +
    ((100 - flakyRate) * 0.15) +
    (criticalFlowSuccess * 0.20) +
    (releaseGateHealth * 0.10)
  );

  const releaseReadiness = normalizePct((releaseGateHealth * 0.6) + (criticalFlowSuccess * 0.4));

  return {
    stabilityScore,
    releaseReadiness,
    flakyRate: normalizePct(flakyRate),
    replayConsistency: normalizePct(replayConsistency),
    criticalFlowSuccess: normalizePct(criticalFlowSuccess),
    passRate: normalizePct(passRate),
    testsPassed: passed,
    testsFailed: failed,
  };
}

function generateStabilitySnapshot(options = {}) {
  ensureDir(path.dirname(SNAPSHOT_PATH));
  const history = loadHistory(30);
  const execution = options.execution || history[0] || null;
  const waves = loadWaves();
  const latestWave = waves.sort((a, b) => String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')))[0] || null;
  const releaseGate = buildReleaseGate(latestWave);
  const global = computeGlobalMetrics(execution, releaseGate);
  const verticalRegistry = loadVerticalRegistry();

  const snapshot = {
    executionId: execution?.executionId || null,
    generatedAt: new Date().toISOString(),
    global: {
      stabilityScore: global.stabilityScore,
      releaseReadiness: global.releaseReadiness,
      flakyRate: global.flakyRate,
      replayConsistency: global.replayConsistency,
      criticalFlowSuccess: global.criticalFlowSuccess,
    },
    domains: buildDomainMetrics(execution),
    channels: buildChannelMetrics(execution),
    verticals: buildVerticalMetrics(execution, verticalRegistry),
    failures: buildFailureList(execution, history, verticalRegistry),
    checkpoints: {
      currentWave: safeReadJson(path.join(CHECKPOINT_STATE_DIR, 'progress.json'), {}).currentWave || null,
      progress: safeReadJson(path.join(CHECKPOINT_STATE_DIR, 'progress.json'), {
        currentWave: null,
        completedWaves: [],
        failedWaves: [],
        globalStatus: 'running',
        lastSuccessfulCheckpoint: null,
      }),
    },
    releaseGate,
  };

  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return { snapshot, outputPath: SNAPSHOT_PATH };
}

module.exports = {
  generateStabilitySnapshot,
  SNAPSHOT_PATH,
};
