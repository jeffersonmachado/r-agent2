'use strict';

/**
 * Vertical Review Service
 *
 * Orquestra a "revisão da vertical" acionável por QA (botão na UI).
 * O agente de IA NÃO precisa mais fazer isso manualmente: este serviço
 * executa o mesmo fluxo de inferência que antes era feito à mão.
 *
 * Fluxo:
 *   1. Discovery (systemDiscoveryEngine) — capabilities da vertical
 *   2. Inferência de jornadas (journeyInferenceService)
 *   3. Gaps de negócio (contratos × cobertura)
 *   4. Gaps de cobertura (cenários sem replay / fracos)
 *   5. Unificação dos gaps em uma lista acionável
 *   6. Geração opcional de drafts de cenário por IA (status draft_ai)
 *
 * O retorno é um report autocontido que a UI exibe; nada é executado
 * automaticamente (drafts entram como draft_ai e exigem aprovação).
 */

const path = require('path');
const { discoverSystem } = require('./qa/systemDiscoveryEngine');
const { inferJourneys } = require('./qa/journeyInferenceService');
const qaWavesIntelligenceService = require('./qaWavesIntelligenceService');
const { listLatestScenarios } = require('./qaWavesScenarioService');
const { normalizeTenantKey } = require('../../lib/rpaSecurity');

const ROOT_DIR = path.join(__dirname, '..', '..');

// Lazy: evita ciclo de dependência e custo de carga no require inicial.
function getScenarioService() {
  return require('./qaWavesScenarioService');
}

function getExecutableStatuses() {
  try {
    return require('../modules/qa-waves/waveScenario.constants').EXECUTABLE_SCENARIO_STATUS;
  } catch (_) {
    return ['approved', 'active', 'regression'];
  }
}

function nowIso() {
  return new Date().toISOString();
}

function makeReviewId() {
  return `vr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeVertical(vertical) {
  return String(vertical || '').trim().toLowerCase();
}

function listVerticalScenarios(vertical, tenantId = 'system') {
  const scopedTenantId = normalizeTenantKey(tenantId);
  let items = [];
  try {
    const result = listLatestScenarios({ tenantId: scopedTenantId });
    items = Array.isArray(result?.items) ? result.items : (Array.isArray(result) ? result : []);
  } catch (_) {
    items = [];
  }
  return items.filter((item) => normalizeVertical(item.vertical) === vertical);
}

/**
 * Encontra cenários executáveis da vertical para gravar a jornada em RPA/replay.
 * Um cenário só é candidato a gravação se: status executável (approved/active/
 * regression), possui seeds de browser e declara platformScenarioIds.
 */
function findRecordableScenarios(vertical, tenantId = 'system') {
  const executable = new Set(getExecutableStatuses());
  return listVerticalScenarios(vertical, tenantId).filter((scenario) => {
    const status = String(scenario?.status || '').toLowerCase();
    if (!executable.has(status)) return false;
    if (!Array.isArray(scenario?.seeds) || scenario.seeds.length === 0) return false;
    const declared = [
      ...(Array.isArray(scenario?.platformScenarioIds) ? scenario.platformScenarioIds : []),
      ...(Array.isArray(scenario?.platform?.platformScenarioIds) ? scenario.platform.platformScenarioIds : []),
    ].filter(Boolean);
    return declared.length > 0;
  });
}

/**
 * Índice de replays frescos (últimos 7 dias) por scenarioId, reusando o índice
 * do intelligence service. Usado para NÃO regravar jornadas já gravadas.
 */
function getFreshReplayIndex(tenantId = 'system') {
  try {
    return qaWavesIntelligenceService.buildReplayIndex(tenantId) || {};
  } catch (_) {
    return {};
  }
}

/**
 * Grava a jornada da vertical em RPA/replay: enfileira a execução dos cenários
 * executáveis (approved + seeds de browser) que AINDA NÃO têm replay fresco.
 * A execução assíncrona do QA Mesh grava os replays em `qa_wave_replay_*`.
 *
 * O mesh serializa uma onda por vez, então enfileira UMA jornada por chamada e
 * para; re-executar a revisão grava a próxima pendente.
 *
 * @returns {Promise<{requested: number, queued: Array, skipped: Array, failed: Array}>}
 */
async function recordVerticalJourney({ vertical, tenantId, maxRecordings = 3 }) {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const scenarioService = getScenarioService();
  const replayIndex = getFreshReplayIndex(scopedTenantId);
  const candidates = findRecordableScenarios(vertical, scopedTenantId)
    .filter((scenario) => {
      const stat = replayIndex[scenario.id];
      // Sem replay ou replay sem frescor → candidato a gravação.
      return !stat || !stat.hasFresh;
    })
    .slice(0, Math.max(1, Number(maxRecordings) || 1));

  const queued = [];
  const skipped = [];
  const failed = [];

  for (const scenario of candidates) {
    try {
      const result = await scenarioService.runScenarioExecution({
        scenarioIds: [scenario.id],
        mode: 'real',
        tenantId: scopedTenantId,
      });
      queued.push({
        scenarioId: scenario.id,
        journeyId: scenario.journeyId || scenario.journey || null,
        executionId: result?.executionId || null,
        replayId: result?.replayId || null,
        replayIds: Array.isArray(result?.replayIds) ? result.replayIds : [],
      });
      // Uma onda por vez (serialização do mesh): para aqui; a próxima
      // chamada de revisão grava a próxima jornada pendente.
      break;
    } catch (err) {
      if (err?.code === 'EXECUTION_ALREADY_RUNNING') {
        skipped.push({
          scenarioId: scenario.id,
          reason: String(err?.message || err),
          code: err.code,
        });
        break;
      }
      failed.push({
        scenarioId: scenario.id,
        reason: String(err?.message || err),
        code: err?.code || null,
      });
    }
  }

  return { requested: candidates.length, queued, skipped, failed };
}

/**
 * Unifica gaps de várias fontes em uma lista acionável e sem duplicatas.
 */
function buildUnifiedGaps({ vertical, businessGaps, coverageGaps, journeyInference }) {
  const gaps = [];
  const seen = new Set();

  function push(gap) {
    const key = `${gap.type}:${gap.journeyId || ''}:${gap.gap}`;
    if (seen.has(key)) return;
    seen.add(key);
    gaps.push(gap);
  }

  // 1. Capabilities sem cenário QA (business gaps por jornada)
  for (const entry of (businessGaps?.verticals || [])) {
    for (const capGap of (entry.gaps?.capabilityGaps || [])) {
      push({
        type: 'capability_gap',
        vertical,
        journeyId: entry.journeyId,
        stage: 'coverage',
        gap: `Capacidade sem cenário QA: ${capGap}`,
        context: { capability: capGap, journey: entry.journeyId },
      });
    }
    if (!entry.contract?.exists) {
      push({
        type: 'missing_contract',
        vertical,
        journeyId: entry.journeyId,
        stage: 'contract',
        gap: `Jornada sem contrato formal: ${entry.journeyId}`,
        context: { journey: entry.journeyId },
      });
    }
  }

  // 2. Cenários sem replay
  for (const id of (coverageGaps?.missingScenarios || [])) {
    push({
      type: 'missing_scenario',
      vertical,
      journeyId: 'unknown',
      stage: 'execution',
      gap: `Cenário sem replay: ${id}`,
      context: { scenarioId: id },
    });
  }

  // 3. Cenários fracos (sem seeds / validadores / replay antigo)
  for (const weak of (coverageGaps?.weakScenarios || [])) {
    push({
      type: 'weak_scenario',
      vertical,
      journeyId: 'unknown',
      stage: 'enrichment',
      gap: `Cenário fraco ${weak.id}: ${(weak.reasons || []).join(', ')}`,
      context: { scenarioId: weak.id, reasons: weak.reasons || [] },
    });
  }

  // 4. Jornadas inferidas com capabilities ausentes
  for (const journey of (journeyInference?.journeys || [])) {
    for (const cap of (journey.missingCapabilities || [])) {
      push({
        type: 'journey_capability_gap',
        vertical,
        journeyId: journey.journeyId,
        stage: 'journey',
        gap: `Jornada ${journey.journeyId} exige capability ausente: ${cap}`,
        context: { journey: journey.journeyId, capability: cap },
      });
    }
  }

  return gaps;
}

/**
 * Revisa uma vertical de ponta a ponta.
 *
 * @param {object} options
 * @param {string} options.vertical - vertical alvo (ex.: 'fitness')
 * @param {boolean} [options.autoGenerateDrafts=true] - gera drafts por IA para os gaps
 * @param {number} [options.maxDrafts=5] - limite de drafts a gerar
 * @param {boolean} [options.persistDiscovery=false] - persiste o registry de capabilities
 * @param {boolean} [options.recordJourney=false] - grava a jornada em RPA/replay somente com opt-in explícito
 * @param {number} [options.maxRecordings=3] - limite de cenários a gravar
 * @param {string} [options.tenantId] - tenant da gravação
 * @returns {Promise<object>} report da revisão
 */
async function reviewVertical(options = {}) {
  const startedAt = Date.now();
  const vertical = normalizeVertical(options.vertical) || 'fitness';
  const autoGenerateDrafts = options.autoGenerateDrafts !== false;
  const maxDrafts = Math.max(0, Math.min(Number(options.maxDrafts) || 0, 20));
  const persistDiscovery = options.persistDiscovery === true;
  // Revisão é análise por padrão. Executar/gravar exige opt-in explícito.
  const recordJourney = options.recordJourney === true;
  const tenantId = normalizeTenantKey(options.tenantId || 'system');
  const maxRecordings = Math.max(1, Math.min(Number(options.maxRecordings) || 3, 10));

  // 1. Discovery (por padrão NÃO persiste — revisão é read-only sobre o registry)
  let discovery = {};
  let capabilities = [];
  try {
    const result = discoverSystem({ rootDir: ROOT_DIR, persist: persistDiscovery });
    discovery = result.discovery || {};
    capabilities = result.capabilities || [];
  } catch (err) {
    capabilities = [];
  }

  const verticalCapabilities = capabilities.filter(
    (cap) => normalizeVertical(cap?.domain) === vertical,
  );

  // 2. Inferência de jornadas
  let journeyInference = { journeys: [] };
  try {
    journeyInference = inferJourneys({ discovery, capabilities, persist: false });
  } catch (_) {
    journeyInference = { journeys: [] };
  }

  // 3. Gaps de negócio
  let businessGaps = { verticals: [], summary: {} };
  try {
    businessGaps = qaWavesIntelligenceService.getBusinessGaps({ vertical, journey: null, tenantId });
  } catch (_) {
    businessGaps = { verticals: [], summary: {} };
  }

  // 4. Gaps de cobertura
  let coverageGaps = null;
  try {
    const existingScenarios = listVerticalScenarios(vertical, tenantId);
    coverageGaps = qaWavesIntelligenceService.analyzeCoverageGaps({ vertical, tenantId }, existingScenarios);
  } catch (_) {
    coverageGaps = null;
  }

  // 5. Gaps unificados
  const gaps = buildUnifiedGaps({ vertical, businessGaps, coverageGaps, journeyInference });

  // 6. Geração de drafts por IA (opcional, status draft_ai)
  const drafts = [];
  if (autoGenerateDrafts) {
    for (const gap of gaps.slice(0, maxDrafts)) {
      try {
        const draft = await qaWavesIntelligenceService.generateScenarioDraft({
          vertical,
          journey: gap.journeyId || 'unknown',
          stage: gap.stage || 'review',
          gap: gap.gap,
          context: gap.context || {},
          tenantId,
        });
        drafts.push({
          id: draft.id,
          status: draft.status,
          title: draft.title || draft.id,
          journey: draft.journey,
          stage: draft.stage,
        });
      } catch (err) {
        drafts.push({
          id: null,
          status: 'failed',
          title: gap.gap,
          journey: gap.journeyId || 'unknown',
          error: String(err?.message || err),
        });
      }
    }
  }

  // 7. Gravação da jornada em RPA/replay (opcional) — enfileira a execução
  // dos cenários executáveis (approved + seeds de browser) no QA Mesh, que
  // grava os replays `qa_wave_replay_*` para revisão/treinamento/mentoria.
  let recordedJourney = null;
  if (recordJourney) {
    try {
      recordedJourney = await recordVerticalJourney({ vertical, tenantId, maxRecordings });
    } catch (err) {
      recordedJourney = { requested: 0, queued: [], failed: [{ scenarioId: null, reason: String(err?.message || err) }] };
    }
  }

  return {
    reviewId: makeReviewId(),
    tenantId,
    vertical,
    generatedAt: nowIso(),
    durationMs: Date.now() - startedAt,
    discovery: {
      totalCapabilities: capabilities.length,
      verticalCapabilities: verticalCapabilities.length,
      capabilities: verticalCapabilities.map((cap) => cap.id),
    },
    journeyInference: {
      candidates: (journeyInference.journeys || []).map((j) => ({
        journeyId: j.journeyId,
        confidence: j.confidence,
        missingCapabilities: j.missingCapabilities || [],
      })),
    },
    businessGaps: businessGaps.summary || {},
    coverage: coverageGaps ? {
      coverage: coverageGaps.coverage,
      totalRequired: coverageGaps.totalRequired,
      totalCovered: coverageGaps.totalCovered,
      missingScenarios: coverageGaps.missingScenarios || [],
      weakScenarios: coverageGaps.weakScenarios || [],
    } : null,
    gaps,
    gapCount: gaps.length,
    draftsGenerated: drafts.length,
    drafts,
    recordedJourney,
    recommendedActions: coverageGaps?.recommendedActions || [],
  };
}

module.exports = {
  reviewVertical,
  buildUnifiedGaps,
  listVerticalScenarios,
  findRecordableScenarios,
  recordVerticalJourney,
};
