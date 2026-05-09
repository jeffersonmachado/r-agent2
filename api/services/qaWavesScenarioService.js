'use strict';

const fs = require('fs');
const path = require('path');
const { getRpaReplayDir } = require('../../lib/rpaPathResolver');
const { adaptAiScenario } = require('../modules/qa-waves/aiScenarioAdapter');
const { validateScenarioCompatibility } = require('../modules/qa-waves/waveScenarioSchema');
const { EXECUTABLE_SCENARIO_STATUS } = require('../modules/qa-waves/waveScenario.constants');
const { isInPipeline } = require('../../pipeline/guard');
const {
  inferJourney,
  inferJourneyHeuristically,
} = require('../../qa/qa-waves/services/journeyInferenceService');

const ROOT_DIR = path.join(__dirname, '..', '..');
const STORE_PATH = path.join(ROOT_DIR, 'qa', 'qa-waves', 'scenario-store.json');
const RPA_SEEDS_DIR = path.join(ROOT_DIR, 'rpa', 'seeds');
const STORE_DEFAULT_VERSION = 1;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeStoreDocument(document) {
  if (Array.isArray(document)) {
    return {
      version: STORE_DEFAULT_VERSION,
      scenarios: document,
      history: {},
      updatedAt: nowIso(),
      format: 'array',
    };
  }

  if (document && typeof document === 'object') {
    return {
      version: Number.isFinite(Number(document.version)) ? Number(document.version) : STORE_DEFAULT_VERSION,
      scenarios: Array.isArray(document.scenarios) ? document.scenarios : [],
      history: document.history && typeof document.history === 'object' ? document.history : {},
      updatedAt: document.updatedAt || nowIso(),
      format: 'object',
    };
  }

  return {
    version: STORE_DEFAULT_VERSION,
    scenarios: [],
    history: {},
    updatedAt: nowIso(),
    format: 'object',
  };
}

function ensureStore() {
  ensureDir(path.dirname(STORE_PATH));

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, `${JSON.stringify({
      version: STORE_DEFAULT_VERSION,
      scenarios: [],
      history: {},
      updatedAt: nowIso(),
    }, null, 2)}\n`, 'utf8');
  }

  try {
    const content = fs.readFileSync(STORE_PATH, 'utf8');
    return normalizeStoreDocument(JSON.parse(content));
  } catch (error) {
    console.error(`Erro ao ler store: ${error.message}`);
    return {
      version: STORE_DEFAULT_VERSION,
      scenarios: [],
      history: {},
      updatedAt: nowIso(),
      format: 'object',
    };
  }
}

function saveStore(store) {
  const normalized = normalizeStoreDocument(store);
  normalized.updatedAt = nowIso();

  if (normalized.format === 'array') {
    fs.writeFileSync(STORE_PATH, `${JSON.stringify(normalized.scenarios, null, 2)}\n`, 'utf8');
    return;
  }

  fs.writeFileSync(STORE_PATH, `${JSON.stringify({
    version: normalized.version,
    scenarios: normalized.scenarios,
    history: normalized.history,
    updatedAt: normalized.updatedAt,
  }, null, 2)}\n`, 'utf8');
}

function toPlatformScenarioIds(scenario) {
  const rootIds = Array.isArray(scenario?.platformScenarioIds) ? scenario.platformScenarioIds : [];
  const nestedIds = Array.isArray(scenario?.platform?.platformScenarioIds)
    ? scenario.platform.platformScenarioIds
    : [];
  return Array.from(new Set([...rootIds, ...nestedIds].filter(Boolean)));
}

function toSemanticSteps(scenario) {
  if (Array.isArray(scenario?.semanticSteps) && scenario.semanticSteps.length > 0) {
    return clone(scenario.semanticSteps);
  }
  if (Array.isArray(scenario?.steps)) {
    return clone(scenario.steps);
  }
  return [];
}

function loadRpaSeedsIndex() {
  try {
    if (!fs.existsSync(RPA_SEEDS_DIR)) return new Map();
    const files = fs.readdirSync(RPA_SEEDS_DIR).filter((name) => name.endsWith('.json'));
    const index = new Map();

    for (const fileName of files) {
      try {
        const filePath = path.join(RPA_SEEDS_DIR, fileName);
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const seedId = String(raw?.id || fileName.replace(/\.json$/i, '')).trim();
        if (!seedId) continue;
        index.set(seedId, { ...raw, __fileName: fileName });
      } catch (_) {
        // Ignora seed inválida para não quebrar listagem de cenários.
      }
    }

    return index;
  } catch (_) {
    return new Map();
  }
}

function hydrateScenarioSeedsFromRpa(scenario, rpaSeedsIndex) {
  const currentSeeds = Array.isArray(scenario?.seeds) ? scenario.seeds : [];
  if (currentSeeds.length > 0) return scenario;

  const candidateIds = Array.from(new Set([
    String(scenario?.id || '').trim(),
    ...toPlatformScenarioIds(scenario),
  ].filter(Boolean)));

  const hydratedSeeds = [];
  for (const candidateId of candidateIds) {
    const seedFile = rpaSeedsIndex.get(candidateId);
    if (!seedFile) continue;
    hydratedSeeds.push({
      id: String(seedFile.id || candidateId),
      scenarioId: String(scenario.id || candidateId),
      source: 'from_replay',
      status: 'approved',
      persona: {
        type: String(seedFile?.metadata?.journey || scenario?.journeyId || 'rpa_seed'),
        behavior: 'recorded',
        urgency: 'medium',
      },
      inputVariants: [String(seedFile?.name || candidateId)],
      data: seedFile?.data || {},
      file: seedFile.__fileName,
      createdAt: scenario?.createdAt || nowIso(),
      updatedAt: scenario?.updatedAt || nowIso(),
    });
  }

  if (hydratedSeeds.length === 0) return scenario;
  return {
    ...scenario,
    seeds: hydratedSeeds,
  };
}

async function resolveJourneyMetadata(input = {}) {
  const journey = await inferJourney({
    vertical: input.vertical,
    journeyId: input.journeyId || input.journey,
    journey: input.journey,
    journeySource: input.journeySource,
    scenarioName: input.name || input.title || input.goal,
    description: input.description,
    tenantId: input.tenantId,
    baseTemplateId: input.baseTemplateId,
    useAi: input.useAi,
  });

  return {
    journeyId: journey.journeyId,
    journey: journey.journeyId,
    journeySteps: Array.isArray(input.journeySteps) && input.journeySteps.length > 0
      ? clone(input.journeySteps)
      : clone(journey.steps || []),
    journeySource: input.journeySource || journey.journeySource || 'inferred',
    baseTemplateId: input.baseTemplateId || journey.baseTemplateId || 'customer_lifecycle_v1',
  };
}

function normalizeScenarioRecord(input = {}) {
  const now = nowIso();
  const semanticSteps = toSemanticSteps(input);
  const explicitPlatformScenarioIds = toPlatformScenarioIds(input);
  const platformScenarioIds = explicitPlatformScenarioIds.length > 0
    ? explicitPlatformScenarioIds
    : tryInferPlatformScenarioIds(input);
  const inferredJourney = inferJourneyHeuristically({
    vertical: input.vertical,
    journeyId: input.journeyId || input.journey,
    journey: input.journey,
    journeySource: input.journeySource,
    scenarioName: input.name || input.title || input.goal,
    description: input.description,
    baseTemplateId: input.baseTemplateId,
    useAi: false,
  });
  const resolvedJourneyId = String(input.journeyId || input.journey || inferredJourney.journeyId || '').trim();
  const resolvedJourneySteps = Array.isArray(input.journeySteps) && input.journeySteps.length > 0
    ? clone(input.journeySteps)
    : clone(inferredJourney.steps || []);
  const normalized = {
    ...clone(input),
    id: String(input.id || '').trim(),
    journeyId: resolvedJourneyId,
    journey: resolvedJourneyId,
    journeySteps: resolvedJourneySteps,
    journeySource: String(input.journeySource || '').trim() || inferredJourney.journeySource || (resolvedJourneyId ? 'manual' : 'inferred'),
    baseTemplateId: String(input.baseTemplateId || inferredJourney.baseTemplateId || 'customer_lifecycle_v1').trim(),
    waveId: String(input.waveId || '').trim(),
    platformScenarioIds,
    semanticSteps,
    steps: semanticSteps,
    seeds: Array.isArray(input.seeds) ? clone(input.seeds) : [],
    validators: Array.isArray(input.validators) ? clone(input.validators) : [],
    executionStatus: input.executionStatus || 'queued',
    status: input.status || 'draft',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    platform: {
      ...(input.platform || {}),
      platformScenarioIds,
    },
  };

  if (!normalized.id) {
    const error = new Error('Scenario id obrigatorio');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  if (!normalized.waveId) {
    const error = new Error(`Scenario waveId obrigatorio: ${normalized.id}`);
    error.code = 'BAD_REQUEST';
    throw error;
  }

  if (!normalized.journeyId) {
    const error = new Error(`Scenario journeyId obrigatorio: ${normalized.id}`);
    error.code = 'BAD_REQUEST';
    throw error;
  }

  return normalized;
}

function dedupeStoreScenarios(store) {
  const deduped = new Map();
  const invalidScenarios = [];
  for (const item of Array.isArray(store?.scenarios) ? store.scenarios : []) {
    let normalized;
    try {
      normalized = normalizeScenarioRecord(item);
    } catch (error) {
      invalidScenarios.push({
        id: String(item?.id || '').trim() || null,
        message: error.message,
      });
      continue;
    }

    const existing = deduped.get(normalized.id);
    if (!existing) {
      deduped.set(normalized.id, normalized);
      continue;
    }

    const existingVersion = Number.parseInt(String(existing.version || 'v0').replace(/^v/i, ''), 10) || 0;
    const candidateVersion = Number.parseInt(String(normalized.version || 'v0').replace(/^v/i, ''), 10) || 0;
    if (candidateVersion >= existingVersion) deduped.set(normalized.id, normalized);
  }

  if (invalidScenarios.length > 0) {
    console.warn('[qaWavesScenarioService] Ignorando cenarios invalidos no store durante deduplicacao', invalidScenarios);
  }

  store.scenarios = Array.from(deduped.values());
  return store;
}

function loadScenarioStore() {
  const store = ensureStore();
  const beforeCount = Array.isArray(store.scenarios) ? store.scenarios.length : 0;
  dedupeStoreScenarios(store);
  if (store.scenarios.length !== beforeCount) {
    saveStore(store);
  }
  return store;
}

function upsertScenarioStore(scenario, options = {}) {
  const store = loadScenarioStore();
  const normalized = normalizeScenarioRecord(scenario);
  const index = store.scenarios.findIndex((item) => item.id === normalized.id);

  if (index >= 0) {
    const previous = store.scenarios[index];
    store.scenarios[index] = {
      ...previous,
      ...normalized,
      createdAt: previous.createdAt || normalized.createdAt,
      updatedAt: nowIso(),
    };
  } else {
    store.scenarios.push(normalized);
  }

  if (!Array.isArray(store.history[normalized.id])) store.history[normalized.id] = [];
  store.history[normalized.id].push({
    version: normalized.version || (index >= 0 ? store.scenarios[index].version : 'v1'),
    changedBy: options.changedBy || 'system',
    changedAt: nowIso(),
    changes: Array.isArray(options.changes) ? options.changes : ['scenario upserted'],
  });

  dedupeStoreScenarios(store);
  saveStore(store);
  return clone(store.scenarios.find((item) => item.id === normalized.id));
}

function nextVersion(currentVersions = []) {
  const max = currentVersions.reduce((acc, version) => {
    const current = Number.parseInt(String(version || 'v0').replace(/^v/i, ''), 10);
    return Number.isFinite(current) ? Math.max(acc, current) : acc;
  }, 0);
  return `v${max + 1}`;
}

function toSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'scenario';
}

function inferLegacyScenarioId({ vertical, journey, goal }) {
  const normalizedVertical = String(vertical || '').toLowerCase();
  const normalizedJourney = String(journey || '').toLowerCase();
  const normalizedGoal = String(goal || '').toLowerCase();

  if (
    normalizedVertical === 'fitness'
    && ['cliente_novo', 'fitness_new_customer'].includes(normalizedJourney)
    && /aula experimental|trial class/.test(normalizedGoal)
  ) {
    return 'fitness_trial_class';
  }

  return null;
}

function buildGenericExampleSeeds(scenarioId) {
  const createdAt = nowIso();
  const personas = [
    { type: 'cliente_direto',     behavior: 'objetivo',      urgency: 'medium' },
    { type: 'cliente_indeciso',   behavior: 'exploratorio',  urgency: 'low'    },
    { type: 'sensivel_preco',     behavior: 'negociador',    urgency: 'low'    },
    { type: 'edge_case_horario',  behavior: 'fora_da_janela',urgency: 'high'   },
    { type: 'edge_case_privacidade', behavior: 'resistente_dados', urgency: 'medium' },
  ];
  return personas.map((persona, i) => ({
    id: `seed_${String(i + 1).padStart(3, '0')}`,
    scenarioId,
    source: 'ai_generated',
    status: i < 3 ? 'approved' : 'reviewed',
    persona,
    inputVariants: [`Mensagem de entrada ${i + 1}`],
    data: { customer: { name: `Cliente ${i + 1}`, phone: `+551199111000${i + 1}` } },
    expected: { intent: 'unknown', shouldValidate: true },
    createdAt,
    updatedAt: createdAt,
  }));
}

function buildGenericExampleScenario(vertical, journey, goal, channels) {
  const createdAt = nowIso();
  const slug = inferLegacyScenarioId({ vertical, journey, goal }) || toSlug(`${vertical}_${journey}_${goal || 'scenario'}`);
  const journeySteps = [];
  return {
    id: slug,
    waveId: `${vertical}-${journey}`,
    vertical,
    journeyId: journey,
    journey,
    journeySteps,
    journeySource: 'inferred',
    baseTemplateId: 'customer_lifecycle_v1',
    name: goal || 'Cenario de exemplo',
    description: `Cenario semantico gerado para ${vertical} / ${journey}`,
    source: 'ai_inferred',
    status: 'draft',
    executionStatus: 'queued',
    version: 'v1',
    channels: Array.isArray(channels) && channels.length ? channels : ['api'],
    risk: 'medium',
    priority: 'medium',
    preconditions: [{ type: 'tenant_ready', description: 'Tenant ativo' }],
    steps: [
      {
        id: 'step_001_send_message',
        order: 1,
        type: 'send_message',
        adapter: (Array.isArray(channels) && channels[0]) || 'api',
        channel: (Array.isArray(channels) && channels[0]) || 'api',
        input: { variants: [goal || 'Mensagem inicial'] },
        enabled: true,
      },
      {
        id: 'step_002_validate_intent',
        order: 2,
        type: 'validate_intent',
        adapter: 'aiIntentService',
        expected: { intent: 'unknown', confidenceMin: 0.6 },
        enabled: true,
      },
      {
        id: 'step_003_validate_response',
        order: 3,
        type: 'validate_response',
        adapter: 'ragService',
        expected: { semantic: goal || 'resposta valida' },
        enabled: true,
      },
      {
        id: 'step_004_validate_sla',
        order: 4,
        type: 'validate_sla',
        adapter: 'meshValidator',
        data: { maxMs: 15000 },
        enabled: true,
      },
    ],
    seeds: buildGenericExampleSeeds(slug),
    validations: {
      slaMs: 15000,
      requireBackendValidation: false,
      requireReplay: true,
    },
    tags: { waveId: `${vertical}-${journey}`, journey, source: 'ai_inferred', vertical },
    platform: { platformScenarioIds: [] },
    platformScenarioIds: [],
    createdAt,
    updatedAt: createdAt,
  };
}



function listLatestScenarios(filters = {}) {
  const store = loadScenarioStore();
  const rpaSeedsIndex = loadRpaSeedsIndex();
  const byId = new Map();
  for (const item of store.scenarios) {
    const current = byId.get(item.id);
    if (!current) {
      byId.set(item.id, item);
      continue;
    }
    const currentVersion = Number.parseInt(String(current.version || 'v0').replace(/^v/i, ''), 10) || 0;
    const candidateVersion = Number.parseInt(String(item.version || 'v0').replace(/^v/i, ''), 10) || 0;
    if (candidateVersion >= currentVersion) byId.set(item.id, item);
  }

  let items = Array.from(byId.values()).map((item) => hydrateScenarioSeedsFromRpa(item, rpaSeedsIndex));
  if (filters.waveId) items = items.filter((item) => item.waveId === filters.waveId);
  if (filters.journey) items = items.filter((item) => item.journeyId === filters.journey || item.journey === filters.journey);
  if (filters.journeyId) items = items.filter((item) => item.journeyId === filters.journeyId);
  if (filters.status) items = items.filter((item) => item.status === filters.status);
  if (filters.source) items = items.filter((item) => item.source === filters.source);

  return {
    items,
    history: store.history,
  };
}

function getMeshRegistryPipelineRequiredIds() {
  try {
    const registryPath = path.join(__dirname, '../../qa-mesh/meshRegistry.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    return new Set(
      registry.filter((s) => s.requiresOfficialPipeline === true).map((s) => s.id)
    );
  } catch (_) {
    return new Set();
  }
}

function filterLocalRunnable(scenarioIds) {
  if (isInPipeline()) return scenarioIds;
  const pipelineRequired = getMeshRegistryPipelineRequiredIds();
  const runnable = scenarioIds.filter((id) => !pipelineRequired.has(id));
  return runnable;
}

// Versão "soft" — retorna [] sem erro se não houver platformScenarioIds (usado em geração de exemplos)
function tryInferPlatformScenarioIds(scenario) {
  const explicit = Array.isArray(scenario?.platformScenarioIds)
    ? scenario.platformScenarioIds.filter(Boolean)
    : [];

  const platform = Array.isArray(scenario?.platform?.platformScenarioIds)
    ? scenario.platform.platformScenarioIds.filter(Boolean)
    : [];

  const suggested = Array.isArray(scenario?.suggestedPlatformScenarioIds)
    ? scenario.suggestedPlatformScenarioIds.filter(Boolean)
    : [];

  const merged = Array.from(new Set([...explicit, ...platform, ...suggested]));
  if (merged.length > 0) {
    return filterLocalRunnable(merged);
  }

  return []; // Sem IDs = retorna vazio (será validado no schema)
}

// Versão "hard" — lança erro mandatório se não houver platformScenarioIds (usado na execução)
function inferPlatformScenarioIds(scenario) {
  const result = tryInferPlatformScenarioIds(scenario);
  if (result.length > 0) return result;

  // Sem platformScenarioIds → erro mandatório. Cenários devem declarar explicitamente qual(is) adapters usar.
  const context = isInPipeline() ? 'pipeline' : 'local';
  const error = new Error(
    `Cenário "${scenario?.id}" requer platformScenarioIds explícito para execução (contexto: ${context}). ` +
    `Configure no Waves ou deixe para a plataforma fornecer.`
  );
  error.code = 'MISSING_PLATFORM_SCENARIO_IDS';
  throw error;
}

function inferScenario(input = {}) {
  const vertical = String(input.vertical || '').toLowerCase();
  const journey = String(input.journey || input.journeyId || '').toLowerCase();

  const aiOutput = input.aiOutput || buildGenericExampleScenario(vertical, journey, input.goal, input.channels);

  const adapted = adaptAiScenario(aiOutput, {
    vertical,
    journey,
    goal: input.goal,
    channels: input.channels,
  });

  if (adapted.scenario) {
    const platformScenarioIds = tryInferPlatformScenarioIds(adapted.scenario);
    adapted.scenario.platformScenarioIds = platformScenarioIds;
    adapted.scenario.platform = {
      ...(adapted.scenario.platform || {}),
      platformScenarioIds,
    };
  }

  if (input.constraints?.generateSeeds === true && (!adapted.scenario.seeds || adapted.scenario.seeds.length === 0)) {
    adapted.scenario.seeds = buildGenericExampleSeeds(adapted.scenario.id).map((seed) => ({
      ...seed,
      scenarioId: adapted.scenario.id,
    }));
  }

  const journeyMetadata = require('../../qa/qa-waves/services/journeyInferenceService').inferJourneyHeuristically({
    vertical,
    journeyId: adapted.scenario.journeyId || adapted.scenario.journey || journey,
    journey: adapted.scenario.journey,
    scenarioName: adapted.scenario.name || adapted.scenario.title || input.goal,
    description: adapted.scenario.description,
    journeySource: adapted.scenario.journeySource,
    baseTemplateId: adapted.scenario.baseTemplateId,
    useAi: false,
  });

  adapted.scenario = {
    ...adapted.scenario,
    journeyId: adapted.scenario.journeyId || journeyMetadata.journeyId,
    journey: adapted.scenario.journey || journeyMetadata.journeyId,
    journeySteps: Array.isArray(adapted.scenario.journeySteps) && adapted.scenario.journeySteps.length > 0
      ? adapted.scenario.journeySteps
      : journeyMetadata.steps,
    journeySource: adapted.scenario.journeySource || journeyMetadata.journeySource,
    baseTemplateId: adapted.scenario.baseTemplateId || journeyMetadata.baseTemplateId,
  };

  return adapted;
}

async function generateScenarioWithAI(input = {}) {
  const inferred = inferScenario({
    ...input,
    constraints: {
      ...(input.constraints || {}),
      generateSeeds: true,
    },
  });

  const journeyMetadata = await resolveJourneyMetadata({
    ...inferred.scenario,
    ...input,
    useAi: input.useAi !== false,
  });

  const scenario = normalizeScenarioRecord({
    ...inferred.scenario,
    ...journeyMetadata,
    status: inferred.scenario.status || 'draft_ai',
  });

  return {
    scenario,
    validation: validateScenarioPayload(scenario),
  };
}

function buildGeneratedSeeds(scenario, count = 5) {
  const now = nowIso();
  const base = buildGenericExampleSeeds(scenario.id);
  const capped = Math.max(1, Math.min(20, Number(count) || 5));
  const seeds = [];

  for (let i = 0; i < capped; i += 1) {
    const template = base[i % base.length];
    seeds.push({
      ...clone(template),
      id: `${template.id}_${String(i + 1).padStart(2, '0')}`,
      scenarioId: scenario.id,
      createdAt: now,
      updatedAt: now,
    });
  }

  return seeds;
}

function getLatestScenarioById(scenarioId) {
  const listed = listLatestScenarios();
  const existing = listed.items.find((item) => item.id === scenarioId) || null;
  if (existing) return existing;

  return null;
}

function validateScenarioPayload(payload = {}) {
  const scenario = payload.scenario || payload;
  const adapted = adaptAiScenario(scenario, {
    vertical: scenario?.vertical,
    journey: scenario?.journey,
    goal: scenario?.name,
    channels: scenario?.channels,
  });

  return {
    valid: adapted.validation.valid,
    errors: adapted.validation.errors,
    warnings: adapted.validation.warnings,
    normalizedScenario: normalizeScenarioRecord(adapted.scenario),
  };
}

function saveScenario(payload = {}) {
  const validation = validateScenarioPayload(payload);
  if (!validation.valid) {
    const error = new Error('Scenario invalido para salvar');
    error.code = 'BAD_REQUEST';
    error.details = validation;
    throw error;
  }

  const store = loadScenarioStore();
  const normalized = validation.normalizedScenario;
  const scenarioId = normalized.id;
  const previousVersions = store.scenarios
    .filter((item) => item.id === scenarioId)
    .map((item) => item.version);

  const version = nextVersion(previousVersions);
  const effectiveVersion = previousVersions.length === 0
    ? nextVersion([normalized.version || 'v1'])
    : version;
  const saved = {
    ...normalized,
    version: effectiveVersion,
    updatedAt: nowIso(),
    createdAt: normalized.createdAt || nowIso(),
    platform: {
      ...(normalized.platform || {}),
      platformScenarioIds: tryInferPlatformScenarioIds(normalized),
    },
  };

  store.scenarios.push(saved);
  if (!Array.isArray(store.history[scenarioId])) store.history[scenarioId] = [];
  store.history[scenarioId].push({
    version: effectiveVersion,
    changedBy: payload.changedBy || (saved.source === 'manual' ? 'manual' : 'ai_inferred'),
    changedAt: saved.updatedAt,
    changes: Array.isArray(payload.changes) ? payload.changes : ['scenario atualizado'],
  });

  saveStore(store);
  return {
    scenario: saved,
    history: store.history[scenarioId],
  };
}

function generateSeeds(payload = {}) {
  const scenarioId = String(payload.scenarioId || '');
  if (!scenarioId) {
    const error = new Error('scenarioId obrigatorio');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const scenario = getLatestScenarioById(scenarioId);
  if (!scenario) {
    const error = new Error('Scenario nao encontrado');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const seeds = buildGeneratedSeeds(scenario, payload.count || 5);
  const store = ensureStore();
  const index = store.scenarios.findIndex((item) => item.id === scenario.id && item.version === scenario.version);
  if (index >= 0) {
    store.scenarios[index] = {
      ...store.scenarios[index],
      seeds,
      updatedAt: nowIso(),
    };
    saveStore(store);
  }

  return { seeds };
}

function evaluateGovernanceBeforeRun({ scenarios, replayEnabled }) {
  const findings = [];

  for (const scenario of scenarios) {
    if (scenario.status === 'approved' && !replayEnabled) {
      findings.push({
        level: 'NO_GO',
        code: 'approved_without_replay',
        message: `Cenario aprovado ${scenario.id} sem replay habilitado`,
      });
    }

    const validation = validateScenarioCompatibility(scenario);
    if (!validation.valid) {
      findings.push({
        level: 'NO_GO',
        code: 'invalid_step',
        message: `Cenario ${scenario.id} possui step invalido`,
        errors: validation.errors,
      });
    }

    if (scenario.status === 'draft') {
      findings.push({
        level: 'WARNING',
        code: 'draft_execution',
        message: `Cenario ${scenario.id} em draft: falhas nao bloqueiam release automaticamente`,
      });
    }
  }

  return findings;
}

function runScenarioExecution(payload = {}) {
  const mode = String(payload.mode || 'real').toLowerCase();
  if (mode !== 'real') {
    const error = new Error('Somente modo real e permitido para /dev/qa-waves/run');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const scenarioIds = Array.isArray(payload.scenarioIds) ? payload.scenarioIds.filter(Boolean) : [];
  if (scenarioIds.length === 0) {
    const error = new Error('scenarioIds obrigatorio');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const listed = listLatestScenarios();
  const scenarios = scenarioIds
    .map((scenarioId) => listed.items.find((item) => item.id === scenarioId) || getLatestScenarioById(scenarioId))
    .filter(Boolean);
  if (scenarios.length === 0) {
    const error = new Error('Nenhum scenario encontrado para execucao');
    error.code = 'NOT_FOUND';
    throw error;
  }

  for (const scenario of scenarios) {
    const isDevMode = payloadAllowsDevExecution(payload);
    const validation = validateScenarioCompatibility(scenario);
    if (!validation.valid) {
      const error = new Error(`Scenario invalido: ${scenario.id}`);
      error.code = 'BAD_REQUEST';
      error.details = validation;
      throw error;
    }

    if (!isDevMode && !EXECUTABLE_SCENARIO_STATUS.includes(String(scenario.status || '').toLowerCase())) {
      const error = new Error(`Scenario com status nao executavel: ${scenario.id}`);
      error.code = 'BAD_REQUEST';
      error.details = {
        scenarioId: scenario.id,
        status: scenario.status,
        allowedStatus: EXECUTABLE_SCENARIO_STATUS,
      };
      throw error;
    }
  }

  const replayEnabled = payload.replay !== false && scenarios.every((item) => item.validations?.requireReplay !== false);
  if (!replayEnabled) {
    const error = new Error('Replay deve estar habilitado para executar Waves RPA');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const governanceFindings = evaluateGovernanceBeforeRun({ scenarios, replayEnabled });
  const blocking = governanceFindings.find((finding) => finding.level === 'NO_GO' && finding.code === 'invalid_step');
  if (blocking) {
    const error = new Error('Governanca bloqueou execucao por step invalido');
    error.code = 'BAD_REQUEST';
    error.details = governanceFindings;
    throw error;
  }

  const selectedSeedIds = Array.isArray(payload.seedIds) ? payload.seedIds : [];
  const expanded = [];
  for (const scenario of scenarios) {
    const seeds = Array.isArray(scenario.seeds) ? scenario.seeds : [];
    const filtered = selectedSeedIds.length > 0
      ? seeds.filter((seed) => selectedSeedIds.includes(seed.id))
      : seeds.filter((seed) => seed.status !== 'disabled');

    if (filtered.length === 0) {
      expanded.push({ scenario, seed: null });
      continue;
    }

    filtered.forEach((seed) => expanded.push({ scenario, seed }));
  }

  const platformScenarioIds = Array.from(new Set(
    scenarios.flatMap((scenario) => inferPlatformScenarioIds(scenario))
  ));

  if (platformScenarioIds.length === 0) {
    const error = new Error('Nenhum cenario compativel com a plataforma para execucao na QA Mesh');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const { executePreparedWaveScenarios } = require('./qaWavesExecutionService');
  return executePreparedWaveScenarios({
    expanded,
    platformScenarioIds,
    governanceFindings,
    tenantId: payload.tenantId || null,
  });
}

function payloadAllowsDevExecution(payload = {}) {
  if (payload.devMode === true || payload.allowNonExecutableStatus === true) return true;
  return process.env.NODE_ENV !== 'production';
}

function deleteScenario(scenarioId) {
  if (!scenarioId) throw Object.assign(new Error('scenarioId é obrigatório'), { code: 'BAD_REQUEST' });
  const store = loadScenarioStore();
  const index = store.scenarios.findIndex((s) => s.id === scenarioId);
  if (index < 0) throw Object.assign(new Error(`Cenário não encontrado: ${scenarioId}`), { code: 'NOT_FOUND' });
  const [removed] = store.scenarios.splice(index, 1);
  saveStore(store);
  return { deleted: true, scenarioId: removed.id };
}

module.exports = {
  inferScenario,
  generateScenarioWithAI,
  generateSeeds,
  validateScenarioPayload,
  saveScenario,
  listLatestScenarios,
  runScenarioExecution,
  loadScenarioStore,
  upsertScenarioStore,
  normalizeScenarioRecord,
  deleteScenario,
};
