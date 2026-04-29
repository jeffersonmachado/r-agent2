'use strict';

/**
 * QA Waves Intelligence Service
 *
 * Responsabilidades:
 * - Analisar jornadas existentes e detectar gaps de cobertura
 * - Gerar cenários draft por IA adaptados ao RAP
 * - Gerar seeds diversificadas por IA
 * - Classificar criticidade de cenários
 * - Propor ligação com mesh scenarios existentes
 * - Calcular cobertura por vertical / jornada / etapa
 * - Governança de waves (GO / NO_GO)
 *
 * Modelo de status para cenários gerados por IA:
 *   draft_ai → approved | rejected
 *   approved → active | deprecated
 *
 * Cenários draft_ai NUNCA são executados automaticamente.
 */

const fs = require('fs');
const path = require('path');
const { generateAiResponse } = require('./aiProviderService');
const qaMeshService = require('./qaMeshService');
const {
  loadScenarioStore,
  upsertScenarioStore,
  normalizeScenarioRecord,
} = require('./qaWavesScenarioService');
const { normalizeAiOutput } = require('../modules/qa-waves/aiScenarioAdapter');
const { getAllReplayReadDirs } = require('../../lib/rpaPathResolver');

const ROOT_DIR = path.join(__dirname, '..', '..');
const COVERAGE_MAP_PATH = path.join(ROOT_DIR, 'qa', 'qa-waves', 'coverage-map.json');
const DRAFTS_STORE_PATH = path.join(ROOT_DIR, 'qa', 'qa-waves', 'ai-drafts.json');
const GOVERNANCE_REPORT_PATH = path.join(ROOT_DIR, 'qa', 'qa-waves', 'governance-report.json');

// ─── Utilidades ──────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function safeWriteJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

// ─── Coverage Map ─────────────────────────────────────────────────────────────

/**
 * Lê o mapa de cobertura.
 */
function loadCoverageMap() {
  return safeReadJson(COVERAGE_MAP_PATH, { verticals: [] });
}

/**
 * Persiste o mapa de cobertura.
 */
function saveCoverageMap(map) {
  safeWriteJson(COVERAGE_MAP_PATH, map);
}

/**
 * Retorna o coverage map para uma vertical específica, criando entrada vazia se não existir.
 */
function getCoverageMapForVertical(vertical) {
  const map = loadCoverageMap();
  const entry = (map.verticals || []).find((v) => v.vertical === vertical);
  return entry || { vertical, journeys: [] };
}

// ─── Replay Index ─────────────────────────────────────────────────────────────

const REPLAY_FRESHNESS_DAYS = 7;

/**
 * Lê todos os arquivos de replay disponíveis e retorna um índice
 * {scenarioId -> { latestAt, hasFailure, count }}
 */
function buildReplayIndex() {
  const index = {};
  const dirs = getAllReplayReadDirs().filter((d) => fs.existsSync(d));
  const now = Date.now();
  const freshnessMs = REPLAY_FRESHNESS_DAYS * 24 * 60 * 60 * 1000;

  for (const dir of dirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
        const scenarioId = raw.scenarioId || raw.recordingId || null;
        if (!scenarioId) continue;

        const finishedAt = raw.finishedAt || raw.endTime || null;
        const finishedMs = finishedAt ? new Date(finishedAt).getTime() : 0;
        const status = String(raw.status || raw.result || '').toLowerCase();
        const isFailed = status === 'failed' || status === 'failure' || status === 'error';
        const isFresh = finishedMs > 0 && now - finishedMs < freshnessMs;

        if (!index[scenarioId]) {
          index[scenarioId] = { latestAt: finishedAt, hasFailure: false, hasFresh: false, count: 0 };
        }
        const rec = index[scenarioId];
        rec.count += 1;
        if (!rec.latestAt || finishedMs > new Date(rec.latestAt).getTime()) {
          rec.latestAt = finishedAt;
        }
        if (isFailed) rec.hasFailure = true;
        if (isFresh) rec.hasFresh = true;
      } catch (_) {
        // arquivo ilegível, ignora
      }
    }
  }

  return index;
}

// ─── Gap Analyzer ─────────────────────────────────────────────────────────────

/**
 * Analisa gaps de cobertura para uma vertical/jornada específica.
 *
 * @param {{ vertical: string, journey?: string }} opts
 * @param {object[]} existingScenarios - cenários já salvos (de qaWavesScenarioService)
 * @returns {{
 *   vertical: string,
 *   journey: string|null,
 *   coverage: number,
 *   missingScenarios: string[],
 *   weakScenarios: Array<{id:string, reason:string}>,
 *   missingSeeds: string[],
 *   missingValidators: string[],
 *   recommendedActions: string[],
 *   replayStats: object,
 *   stageBreakdown: object[]
 * }}
 */
function analyzeCoverageGaps({ vertical, journey = null }, existingScenarios = [], prebuiltReplayIndex = null) {
  // scenario-store é a fonte primária de cenários requeridos
  const storeData = loadScenarioStore();
  const storeScenarios = storeData.scenarios || storeData || [];
  const replayIndex = prebuiltReplayIndex || buildReplayIndex();

  // Filtra pelo vertical; usa waveId como fallback quando vertical não está preenchido
  let relevantScenarios = storeScenarios.filter(
    (s) => s.vertical === vertical || (s.waveId && String(s.waveId).startsWith(vertical)),
  );
  if (journey) {
    relevantScenarios = relevantScenarios.filter(
      (s) => s.journeyId === journey || s.journey === journey,
    );
  }

  // Mescla com cenários fornecidos explicitamente (overrides pontuais)
  const overrideById = new Map(existingScenarios.map((s) => [s.id || s.scenarioId, s]));
  const allRelevant = relevantScenarios.map((s) => overrideById.get(s.id) || s);
  // Adiciona qualquer cenário extra não presente no store (e.g. drafts passados manualmente)
  for (const extra of existingScenarios) {
    const extraId = extra.id || extra.scenarioId;
    if (extraId && !allRelevant.find((r) => r.id === extraId)) {
      allRelevant.push(extra);
    }
  }

  const missingScenarios = [];
  const weakScenarios = [];
  const missingSeeds = [];
  const missingValidators = [];
  const recommendedActions = [];
  const stageBreakdown = [];

  const totalRequired = allRelevant.length;
  let totalCovered = 0;

  // Agrupa por jornada para o stageBreakdown
  const byJourney = {};
  for (const s of allRelevant) {
    const jid = s.journeyId || s.journey || 'unknown';
    if (!byJourney[jid]) byJourney[jid] = [];
    byJourney[jid].push(s);
  }

  for (const [journeyId, scenarios] of Object.entries(byJourney)) {
    const stageReport = {
      journeyId,
      stageId: journeyId,
      stageName: journeyId,
      required: [],
      covered: [],
      missing: [],
      weak: [],
    };

    for (const scenario of scenarios) {
      const reqScenarioId = scenario.id || scenario.scenarioId;
      stageReport.required.push(reqScenarioId);

      const replay = replayIndex[reqScenarioId] || null;

      if (!replay) {
        missingScenarios.push(reqScenarioId);
        stageReport.missing.push(reqScenarioId);
        recommendedActions.push(`Executar cenário para gerar replay: ${reqScenarioId}`);
      } else {
        totalCovered++;
        stageReport.covered.push(reqScenarioId);
      }

      const seeds = Array.isArray(scenario?.seeds) ? scenario.seeds : [];
      const semanticSteps = Array.isArray(scenario?.semanticSteps) ? scenario.semanticSteps : [];
      const validators = Array.isArray(scenario?.validators) ? scenario.validators : [];

      const weakReasons = [];

      if (seeds.length === 0) {
        missingSeeds.push(reqScenarioId);
        weakReasons.push('sem seeds');
        recommendedActions.push(`Gerar seeds para: ${reqScenarioId}`);
      }

      if (validators.length === 0 && semanticSteps.length === 0) {
        missingValidators.push(reqScenarioId);
        weakReasons.push('sem validadores/steps');
        recommendedActions.push(`Adicionar validadores semânticos em: ${reqScenarioId}`);
      }

      if (replay) {
        if (replay.hasFailure) {
          weakReasons.push('replay com falha recente');
          recommendedActions.push(`Investigar falha em replay: ${reqScenarioId}`);
        }
        if (!replay.hasFresh) {
          weakReasons.push('replay desatualizado (>7 dias)');
          recommendedActions.push(`Revalidar cenário: ${reqScenarioId}`);
        }
      }

      if (weakReasons.length > 0) {
        weakScenarios.push({ id: reqScenarioId, reasons: weakReasons });
        stageReport.weak.push({ id: reqScenarioId, reasons: weakReasons });
      }
    }

    stageBreakdown.push(stageReport);
  }

  const coverage = totalRequired > 0 ? Math.round((totalCovered / totalRequired) * 100) / 100 : 0;

  return {
    vertical,
    journey,
    coverage,
    totalRequired,
    totalCovered,
    missingScenarios: [...new Set(missingScenarios)],
    weakScenarios,
    missingSeeds: [...new Set(missingSeeds)],
    missingValidators: [...new Set(missingValidators)],
    recommendedActions: [...new Set(recommendedActions)],
    replayStats: buildReplayIndexSummary(replayIndex),
    stageBreakdown,
    analyzedAt: nowIso(),
  };
}

function buildReplayIndexSummary(index) {
  const ids = Object.keys(index);
  return {
    totalScenarios: ids.length,
    withFreshReplay: ids.filter((id) => index[id].hasFresh).length,
    withFailure: ids.filter((id) => index[id].hasFailure).length,
    withoutReplay: 0, // calculado no analyzer
  };
}

// ─── AI Scenario Generation ───────────────────────────────────────────────────

/**
 * Gera um rascunho de cenário por IA.
 * NUNCA é executado automaticamente — entra como draft_ai.
 *
 * @param {{ vertical: string, journey: string, stage: string, gap: string, context?: object }} opts
 * @returns {Promise<object>} scenario draft
 */
async function generateScenarioDraft({ vertical, journey, stage, gap, context = {} }) {
  const prompt = buildScenarioDraftPrompt({ vertical, journey, stage, gap, context });

  let scenarioJson = null;

  try {
    const aiResponse = await generateAiResponse(
      `${SCENARIO_SYSTEM_PROMPT}\n\n${prompt}`,
      'system',
      { source: 'qa_waves_intelligence', caller: 'generateScenarioDraft' },
    );

    scenarioJson = extractJsonFromAiResponse(aiResponse?.text || '');
  } catch (_) {
    // fallback estrutural quando IA não está disponível
  }

  if (!scenarioJson || typeof scenarioJson !== 'object') {
    scenarioJson = buildFallbackScenarioDraft({ vertical, journey, stage, gap });
  }

  const now = nowIso();
  const draft = {
    id: scenarioJson.id || makeId(`${vertical}_${stage}`),
    waveId: scenarioJson.waveId || `${vertical}-${journey}`,
    title: scenarioJson.title || `[IA] ${gap}`,
    vertical,
    journey,
    stage,
    gap,
    semanticSteps: Array.isArray(scenarioJson.semanticSteps) ? scenarioJson.semanticSteps : [],
    seeds: Array.isArray(scenarioJson.seeds) ? scenarioJson.seeds : [],
    validators: Array.isArray(scenarioJson.validators) ? scenarioJson.validators : [],
    platformScenarioIds: Array.isArray(scenarioJson.platformScenarioIds) ? scenarioJson.platformScenarioIds : [],
    criticality: scenarioJson.criticality || 'medium',
    // Status obrigatório: draft_ai — não executa sem aprovação manual
    status: 'draft_ai',
    source: 'ai_generated',
    reviewedBy: null,
    reviewedAt: null,
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    createdAt: now,
    updatedAt: now,
    aiModel: 'intelligence_engine_v1',
  };

  // Persiste nos drafts
  persistDraft(draft);

  return draft;
}

const SCENARIO_SYSTEM_PROMPT = `
Você é o RAP Intelligence Engine — gerador de cenários de QA para plataformas de atendimento.
Gere cenários ESPECÍFICOS para o contexto da jornada indicada, nunca genéricos.
Retorne APENAS JSON válido no formato especificado.
Nunca inclua explicações fora do JSON.
`.trim();

function buildScenarioDraftPrompt({ vertical, journey, stage, gap, context }) {
  return `
Vertical: ${vertical}
Jornada: ${journey}
Etapa: ${stage}
Gap identificado: ${gap}
Contexto adicional: ${JSON.stringify(context)}

Gere um cenário de QA Wave no formato JSON:
{
  "id": "<vertical>_<etapa>_<descricao_curta>",
  "waveId": "<vertical>-<jornada>",
  "title": "<título específico>",
  "criticality": "low|medium|high|critical",
  "semanticSteps": [
    { "type": "<tipo_do_step_catalog>", "expected": "<comportamento_esperado>", "adapter": "<adapter_opcional>" }
  ],
  "seeds": [],
  "validators": [
    { "type": "semantic_intent", "expected": "<intent>" }
  ],
  "platformScenarioIds": []
}

Tipos válidos de step: send_message, validate_intent, provide_data, validate_response,
check_availability, select_slot, create_booking, create_payment, validate_backend,
validate_sla, validate_context, validate_fallback, validate_flow_transition,
validate_access_release, wait_for_event, trigger_channel_event.
`.trim();
}

function buildFallbackScenarioDraft({ vertical, journey, stage, gap }) {
  const id = `${vertical}_${stage}_${String(gap).toLowerCase().replace(/\s+/g, '_').slice(0, 30)}`;
  return {
    id,
    waveId: `${vertical}-${journey}`,
    title: `[Rascunho] ${gap}`,
    criticality: 'medium',
    semanticSteps: [
      { type: 'send_message', expected: 'mensagem_inicial' },
      { type: 'validate_intent', expected: gap },
      { type: 'validate_response', expected: 'resposta_adequada' },
    ],
    seeds: [],
    validators: [{ type: 'semantic_intent', expected: gap }],
    platformScenarioIds: [],
  };
}

function extractJsonFromAiResponse(text) {
  try {
    // Tenta extrair bloco JSON de uma resposta markdown ou plain text
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]+?)```/) || text.match(/(\{[\s\S]+\})/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    return JSON.parse(text.trim());
  } catch (_) {
    return null;
  }
}

// ─── AI Seed Generation ───────────────────────────────────────────────────────

/**
 * Gera seeds diversificadas por IA para um cenário.
 *
 * @param {{ scenarioId: string, quantity?: number, scenarioContext?: object }} opts
 * @returns {Promise<object[]>}
 */
async function generateSeedsForScenario({ scenarioId, quantity = 5, scenarioContext = {} }) {
  const prompt = buildSeedGenerationPrompt({ scenarioId, quantity, scenarioContext });

  let seeds = null;

  try {
    const aiResponse = await generateAiResponse(
      `${SEED_SYSTEM_PROMPT}\n\n${prompt}`,
      'system',
      { source: 'qa_waves_intelligence', caller: 'generateSeedsForScenario' },
    );

    const raw = extractJsonFromAiResponse(aiResponse?.text || '');
    if (Array.isArray(raw)) seeds = raw;
    else if (raw?.seeds && Array.isArray(raw.seeds)) seeds = raw.seeds;
  } catch (_) {
    // fallback
  }

  if (!Array.isArray(seeds) || seeds.length === 0) {
    seeds = buildFallbackSeeds({ scenarioId, quantity });
  }

  const now = nowIso();
  return seeds.map((seed, i) => ({
    id: seed.id || makeId(`seed_${scenarioId}_${i}`),
    scenarioId,
    profile: seed.profile || 'cliente_generico',
    channel: seed.channel || 'whatsapp',
    input: seed.input || '',
    expectedIntent: seed.expectedIntent || '',
    constraints: seed.constraints || {},
    expectedOutcome: seed.expectedOutcome || '',
    // Seeds geradas por IA entram como draft
    status: 'draft_ai',
    source: 'ai_generated',
    createdAt: now,
    updatedAt: now,
  }));
}

const SEED_SYSTEM_PROMPT = `
Você é o RAP Intelligence Engine — gerador de seeds de teste para QA Waves.
Gere seeds VARIADAS e REALISTAS para o cenário indicado.
Cubra: perfis diferentes, canais, horários, intenções, restrições, erros propositais, contextos anteriores.
Retorne APENAS um array JSON de seeds.
`.trim();

function buildSeedGenerationPrompt({ scenarioId, quantity, scenarioContext }) {
  return `
Cenário: ${scenarioId}
Contexto: ${JSON.stringify(scenarioContext)}
Quantidade desejada: ${quantity}

Gere ${quantity} seeds no formato:
[
  {
    "id": "seed_<descricao>",
    "profile": "cliente_novo|cliente_ativo|sensivel_preco|urgente|indeciso",
    "channel": "whatsapp|chat|pbx|api",
    "input": "<texto de entrada do cliente>",
    "expectedIntent": "<intent esperado>",
    "constraints": { "<campo>": "<valor>" },
    "expectedOutcome": "<resultado esperado>"
  }
]

Varie obrigatoriamente: perfil, canal, horário, intenção, restrição, erro proposital,
contexto anterior e dados de negócio.
`.trim();
}

function buildFallbackSeeds({ scenarioId, quantity }) {
  const profiles = ['cliente_novo', 'cliente_ativo', 'sensivel_preco', 'urgente', 'indeciso'];
  const channels = ['whatsapp', 'chat', 'pbx', 'api'];
  const seeds = [];
  for (let i = 0; i < quantity; i++) {
    seeds.push({
      id: `seed_${scenarioId}_${i + 1}`,
      profile: profiles[i % profiles.length],
      channel: channels[i % channels.length],
      input: `Variação de entrada ${i + 1} para ${scenarioId}`,
      expectedIntent: scenarioId,
      constraints: {},
      expectedOutcome: 'resposta_adequada',
    });
  }
  return seeds;
}

// ─── Draft Management ─────────────────────────────────────────────────────────

function loadDrafts() {
  return safeReadJson(DRAFTS_STORE_PATH, { drafts: [], updatedAt: null });
}

function persistDraft(draft) {
  const store = loadDrafts();
  const existing = store.drafts.findIndex((d) => d.id === draft.id);
  if (existing >= 0) {
    store.drafts[existing] = draft;
  } else {
    store.drafts.push(draft);
  }
  store.updatedAt = nowIso();
  safeWriteJson(DRAFTS_STORE_PATH, store);
}

function listDrafts({ status = null, vertical = null, journey = null } = {}) {
  const store = loadDrafts();
  let drafts = store.drafts || [];

  if (status) drafts = drafts.filter((d) => d.status === status);
  if (vertical) drafts = drafts.filter((d) => d.vertical === vertical);
  if (journey) drafts = drafts.filter((d) => d.journey === journey);

  return drafts;
}

function findDraft(store, draftId) {
  return (store.drafts || []).find((draft) => draft.id === draftId) || null;
}

function toScenarioValidators(draft) {
  if (Array.isArray(draft?.validators) && draft.validators.length > 0) {
    return draft.validators;
  }

  return (Array.isArray(draft?.semanticSteps) ? draft.semanticSteps : [])
    .filter((step) => String(step?.type || '').startsWith('validate_'))
    .map((step) => ({
      id: step.id || null,
      type: step.type,
      expected: step.expected || null,
    }));
}

function toScenarioSeeds(draft) {
  const now = nowIso();
  return (Array.isArray(draft?.seeds) ? draft.seeds : []).map((seed, index) => ({
    ...seed,
    id: seed.id || makeId(`seed_${draft.id}_${index + 1}`),
    scenarioId: draft.id,
    source: seed.source || 'ai_generated',
    status: seed.status === 'draft_ai' ? 'approved' : (seed.status || 'approved'),
    createdAt: seed.createdAt || now,
    updatedAt: now,
  }));
}

function convertDraftToScenario(draft) {
  const normalizedAiScenario = normalizeAiOutput({
    id: draft.id,
    waveId: draft.waveId,
    vertical: draft.vertical,
    journey: draft.journey,
    name: draft.title || draft.id,
    description: `Cenário materializado a partir de draft IA: ${draft.gap || draft.id}`,
    source: 'ai_inferred',
    status: 'active',
    channels: ['whatsapp', 'chat', 'api'],
    risk: draft.criticality || 'medium',
    priority: draft.criticality || 'medium',
    steps: Array.isArray(draft.semanticSteps) ? draft.semanticSteps : [],
    seeds: toScenarioSeeds(draft),
    validations: {
      requireReplay: true,
      requireBackendValidation: true,
      fallbackAllowed: false,
      slaMs: 15000,
    },
    platform: {
      platformScenarioIds: Array.isArray(draft.platformScenarioIds) ? draft.platformScenarioIds : [],
    },
    tags: {
      waveId: draft.waveId,
      journey: draft.journey,
      source: 'ai_generated',
      vertical: draft.vertical,
      stage: draft.stage || null,
      gap: draft.gap || null,
    },
    createdAt: draft.createdAt,
  }, {
    vertical: draft.vertical,
    journey: draft.journey,
    goal: draft.title || draft.id,
    channels: ['whatsapp', 'chat', 'api'],
  });

  return normalizeScenarioRecord({
    ...normalizedAiScenario,
    validators: toScenarioValidators(draft),
    semanticSteps: normalizedAiScenario.steps,
    executionStatus: 'queued',
    status: 'active',
    approvedAt: draft.approvedAt || nowIso(),
    reviewedBy: draft.reviewedBy || null,
  });
}

function validateMeshMapping(scenario) {
  const registry = qaMeshService.getRegistry();
  const allowedIds = new Set((registry || []).map((item) => item.id));
  const platformScenarioIds = Array.isArray(scenario?.platformScenarioIds)
    ? scenario.platformScenarioIds
    : [];

  for (const platformScenarioId of platformScenarioIds) {
    if (!allowedIds.has(platformScenarioId)) {
      const error = new Error(`Mesh scenario not found: ${platformScenarioId}`);
      error.code = 'BAD_REQUEST';
      throw error;
    }
  }

  return true;
}

function validateCoverageAlignment(existingScenarios = null) {
  const storeData = loadScenarioStore();
  const scenarios = Array.isArray(existingScenarios)
    ? existingScenarios
    : (storeData.scenarios || storeData || []);

  // Valida integridade dos cenários do store: todos devem ter id, journeyId e vertical
  const invalidScenarios = [];
  for (const s of scenarios) {
    const missing = [];
    if (!s.id) missing.push('id');
    if (!s.journeyId && !s.journey) missing.push('journeyId');
    if (!s.vertical) missing.push('vertical');
    if (missing.length > 0) {
      invalidScenarios.push({ scenarioId: s.id || '?', missingFields: missing });
    }
  }

  return {
    valid: invalidScenarios.length === 0,
    missingScenarios: [], // mantido por compatibilidade — já não deriva de coverage-map
    invalidScenarios,
    totalChecked: scenarios.length,
    checkedAt: nowIso(),
  };
}

/**
 * Aprova um cenário draft_ai.
 * Apenas cenários aprovados podem ser executados.
 */
function approveDraft(draftId, { approvedBy = 'unknown' } = {}) {
  const store = loadDrafts();
  const draft = findDraft(store, draftId);
  if (!draft) {
    const err = new Error(`Draft não encontrado: ${draftId}`);
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (draft.status !== 'draft_ai') {
    const err = new Error(`Draft não está em status draft_ai: ${draft.status}`);
    err.code = 'BAD_REQUEST';
    throw err;
  }

  draft.status = 'approved';
  draft.reviewedBy = approvedBy;
  draft.reviewedAt = nowIso();
  draft.approvedAt = nowIso();
  draft.updatedAt = nowIso();

  const scenario = convertDraftToScenario(draft);
  validateMeshMapping(scenario);
  const savedScenario = upsertScenarioStore(scenario, {
    changedBy: approvedBy,
    changes: ['draft_ai aprovado e materializado como cenário real'],
  });

  store.updatedAt = nowIso();
  safeWriteJson(DRAFTS_STORE_PATH, store);

  return savedScenario;
}

/**
 * Rejeita um cenário draft_ai.
 */
function rejectDraft(draftId, { rejectedBy = 'unknown', reason = '' } = {}) {
  const store = loadDrafts();
  const draft = store.drafts.find((d) => d.id === draftId);
  if (!draft) {
    const err = new Error(`Draft não encontrado: ${draftId}`);
    err.code = 'NOT_FOUND';
    throw err;
  }

  draft.status = 'rejected';
  draft.reviewedBy = rejectedBy;
  draft.reviewedAt = nowIso();
  draft.rejectedAt = nowIso();
  draft.rejectionReason = reason || 'Rejeitado manualmente';
  draft.updatedAt = nowIso();

  store.updatedAt = nowIso();
  safeWriteJson(DRAFTS_STORE_PATH, store);

  return draft;
}

// ─── Coverage Summary ─────────────────────────────────────────────────────────

/**
 * Retorna resumo de cobertura derivado do scenario-store (fonte primária).
 * Cobertura = cenários com pelo menos um replay fresco / total de cenários no store.
 */
function getCoverageSummary(existingScenarios = null) {
  const storeData = loadScenarioStore();
  const scenarios = Array.isArray(existingScenarios)
    ? existingScenarios
    : (storeData.scenarios || storeData || []).map((s) => normalizeScenarioRecord(s));

  const replayIndex = buildReplayIndex();
  const results = [];

  // Agrupa por vertical → jornada
  const byVertical = {};
  for (const s of scenarios) {
    const v = s.vertical || 'unknown';
    const jid = s.journeyId || s.journey || 'unknown';
    if (!byVertical[v]) byVertical[v] = {};
    if (!byVertical[v][jid]) byVertical[v][jid] = [];
    byVertical[v][jid].push(s);
  }

  for (const [vertical, byJourney] of Object.entries(byVertical)) {
    const journeySummaries = [];
    let vertTotalRequired = 0;
    let vertTotalCovered = 0;

    for (const [journeyId, jScenarios] of Object.entries(byJourney)) {
      const totalRequired = jScenarios.length;
      const totalCovered = jScenarios.filter((s) => replayIndex[s.id]?.hasFresh).length;

      vertTotalRequired += totalRequired;
      vertTotalCovered += totalCovered;
      journeySummaries.push({
        journeyId,
        journeyName: journeyId,
        coverage: totalRequired > 0 ? Math.round((totalCovered / totalRequired) * 100) / 100 : 0,
        totalRequired,
        totalCovered,
        missingCount: Math.max(0, totalRequired - totalCovered),
        weakCount: jScenarios.filter((s) => !Array.isArray(s.seeds) || s.seeds.length === 0).length,
      });
    }

    results.push({
      vertical,
      coverage: vertTotalRequired > 0 ? Math.round((vertTotalCovered / vertTotalRequired) * 100) / 100 : 0,
      totalRequired: vertTotalRequired,
      totalCovered: vertTotalCovered,
      journeys: journeySummaries,
    });
  }

  return {
    verticals: results,
    alignment: validateCoverageAlignment(scenarios),
    generatedAt: nowIso(),
  };
}

// ─── Governance ───────────────────────────────────────────────────────────────

const GOVERNANCE_DEFAULTS = {
  minCoverage: 0.7,
  minQuality: 0.8,
  maxCriticalFailures: 0,
  replayRequired: true,
};

/**
 * Avalia se uma wave pode ir para produção (GO / NO_GO).
 *
 * @param {{ waveId: string, scenarios: object[], meshExecution?: object }} opts
 * @returns {{ waveId, status, coverage, quality, criticalFailures, reasons, details }}
 */
function evaluateWaveGovernance({ waveId, scenarios = [], meshExecution = null, policy = {} }) {
  const rules = { ...GOVERNANCE_DEFAULTS, ...policy };
  const replayIndex = buildReplayIndex();

  let totalScenarios = 0;
  let coveredScenarios = 0;
  let criticalFailures = 0;
  let qualityScore = 0;
  const reasons = [];
  const details = [];

  for (const scenario of scenarios) {
    const id = scenario.id || scenario.scenarioId;
    if (!id) continue;
    totalScenarios++;

    const replay = replayIndex[id] || null;
    const seeds = Array.isArray(scenario.seeds) ? scenario.seeds : [];
    const validators = Array.isArray(scenario.validators) ? scenario.validators : [];
    const criticality = scenario.criticality || 'medium';
    const isCritical = criticality === 'critical';

    let scenarioQuality = 1.0;

    // Cobertura: precisa ter replay ou estar aprovado e executado
    if (!replay) {
      if (rules.replayRequired) {
        reasons.push(`Cenário sem replay: ${id}`);
        scenarioQuality -= 0.3;
      }
    } else {
      coveredScenarios++;
      if (replay.hasFailure) {
        if (isCritical) {
          criticalFailures++;
          reasons.push(`Falha crítica no replay: ${id}`);
        } else {
          reasons.push(`Falha em replay não-crítico: ${id}`);
        }
        scenarioQuality -= 0.5;
      }
      if (!replay.hasFresh) {
        reasons.push(`Replay desatualizado: ${id}`);
        scenarioQuality -= 0.2;
      }
    }

    // Qualidade: seeds e validadores
    if (seeds.length === 0) {
      scenarioQuality -= 0.1;
      reasons.push(`Sem seeds: ${id}`);
    }
    if (validators.length === 0) {
      scenarioQuality -= 0.1;
      reasons.push(`Sem validadores: ${id}`);
    }

    qualityScore += Math.max(0, scenarioQuality);
    details.push({ id, replay: !!replay, hasFresh: replay?.hasFresh || false, hasFailure: replay?.hasFailure || false, criticality, quality: Math.max(0, scenarioQuality) });
  }

  const coverage = totalScenarios > 0 ? coveredScenarios / totalScenarios : 0;
  const quality = totalScenarios > 0 ? qualityScore / totalScenarios : 0;

  const goNoGo = coverage >= rules.minCoverage
    && quality >= rules.minQuality
    && criticalFailures <= rules.maxCriticalFailures;

  const report = {
    waveId,
    status: goNoGo ? 'GO' : 'NO_GO',
    coverage: Math.round(coverage * 100) / 100,
    quality: Math.round(quality * 100) / 100,
    criticalFailures,
    totalScenarios,
    coveredScenarios,
    reasons: [...new Set(reasons)],
    details,
    policy: rules,
    evaluatedAt: nowIso(),
  };

  // Persiste relatório de governança
  try {
    const existing = safeReadJson(GOVERNANCE_REPORT_PATH, { reports: [] });
    if (!Array.isArray(existing.reports)) existing.reports = [];
    const idx = existing.reports.findIndex((r) => r.waveId === waveId);
    if (idx >= 0) existing.reports[idx] = report;
    else existing.reports.push(report);
    existing.updatedAt = nowIso();
    safeWriteJson(GOVERNANCE_REPORT_PATH, existing);
  } catch (_) {
    // Não bloqueia resposta se falhar ao persistir
  }

  return report;
}

/**
 * Lista todos os relatórios de governança.
 */
function listGovernanceReports() {
  const store = safeReadJson(GOVERNANCE_REPORT_PATH, { reports: [] });
  return store.reports || [];
}

/**
 * Sugere ligações entre cenários wave existentes e mesh scenarios.
 */
function suggestMeshLinks(waveScenarios = [], meshRegistry = []) {
  const suggestions = [];

  for (const wave of waveScenarios) {
    const waveTitle = String(wave.title || wave.id || '').toLowerCase();
    for (const mesh of meshRegistry) {
      const meshTitle = String(mesh.name || mesh.id || '').toLowerCase();
      const waveWords = new Set(waveTitle.split(/\W+/).filter((w) => w.length > 3));
      const meshWords = meshTitle.split(/\W+/).filter((w) => w.length > 3);
      const overlap = meshWords.filter((w) => waveWords.has(w));

      if (overlap.length >= 2) {
        suggestions.push({
          waveScenarioId: wave.id || wave.scenarioId,
          meshScenarioId: mesh.id,
          confidence: Math.min(1, overlap.length / 5),
          matchedTerms: overlap,
        });
      }
    }
  }

  return suggestions;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Coverage
  loadCoverageMap,
  saveCoverageMap,
  getCoverageMapForVertical,
  getCoverageSummary,
  validateCoverageAlignment,
  validateMeshMapping,

  // Gap Analysis
  analyzeCoverageGaps,
  buildReplayIndex,

  // AI Generation (draft_ai status — requer aprovação manual)
  generateScenarioDraft,
  generateSeedsForScenario,

  // Draft Management
  listDrafts,
  approveDraft,
  rejectDraft,
  persistDraft,
  convertDraftToScenario,

  // Governance
  evaluateWaveGovernance,
  listGovernanceReports,

  // Mesh Integration
  suggestMeshLinks,
};
