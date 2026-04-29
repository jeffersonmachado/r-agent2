'use strict';

const fs = require('fs');
const path = require('path');
const qaMeshService = require('./qaMeshService');
const { executePreparedWaveScenarios } = require('./qaWavesExecutionService');
const { getRpaReplayDir } = require('../../lib/rpaPathResolver');
const { adaptAiScenario } = require('../modules/qa-waves/aiScenarioAdapter');
const { validateScenarioCompatibility } = require('../modules/qa-waves/waveScenarioSchema');
const { isInPipeline } = require('../../pipeline/guard');

// Cenário de smoke local disponível quando não estamos no pipeline oficial
const LOCAL_SMOKE_SCENARIO_ID = 'qa-core-auth-login';

const ROOT_DIR = path.join(__dirname, '..', '..');
const STORE_PATH = path.join(ROOT_DIR, 'qa', 'qa-waves', 'scenario-store.json');
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

function normalizeScenarioRecord(input = {}) {
  const now = nowIso();
  const semanticSteps = toSemanticSteps(input);
  const platformScenarioIds = toPlatformScenarioIds(input);
  const normalized = {
    ...clone(input),
    id: String(input.id || '').trim(),
    journeyId: String(input.journeyId || input.journey || '').trim(),
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
  for (const item of Array.isArray(store?.scenarios) ? store.scenarios : []) {
    const normalized = normalizeScenarioRecord(item);
    const existing = deduped.get(normalized.id);
    if (!existing) {
      deduped.set(normalized.id, normalized);
      continue;
    }

    const existingVersion = Number.parseInt(String(existing.version || 'v0').replace(/^v/i, ''), 10) || 0;
    const candidateVersion = Number.parseInt(String(normalized.version || 'v0').replace(/^v/i, ''), 10) || 0;
    if (candidateVersion >= existingVersion) deduped.set(normalized.id, normalized);
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

function buildFitnessExampleSeeds(scenarioId) {
  const createdAt = nowIso();
  return [
    {
      id: 'seed_001',
      scenarioId,
      source: 'ai_generated',
      status: 'approved',
      persona: { type: 'cliente_direto', behavior: 'objetivo', urgency: 'medium' },
      inputVariants: ['Quero fazer uma aula experimental'],
      data: {
        customer: { name: 'Ana Souza', phone: '+5511991110001', goal: 'emagrecimento', preferredTime: '18:00' },
        fitness: { classType: 'funcional' },
      },
      expected: { intent: 'trial_interest', shouldCreateBooking: true },
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: 'seed_002',
      scenarioId,
      source: 'ai_generated',
      status: 'approved',
      persona: { type: 'cliente_indeciso', behavior: 'exploratorio', urgency: 'low' },
      inputVariants: ['Estou pesquisando academias, posso conhecer?'],
      data: {
        customer: { name: 'Carlos Lima', phone: '+5511991110002', goal: 'saude', preferredTime: '19:00' },
        fitness: { classType: 'musculacao' },
      },
      expected: { intent: 'trial_interest', shouldCreateLead: true, shouldCreateBooking: true },
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: 'seed_003',
      scenarioId,
      source: 'ai_generated',
      status: 'approved',
      persona: { type: 'sensivel_preco', behavior: 'negociador', priceSensitivity: 'high', urgency: 'low' },
      inputVariants: ['Tem aula teste gratis?'],
      data: {
        customer: { name: 'Mariana Costa', phone: '+5511991110003', goal: 'condicionamento', preferredTime: '07:00' },
        fitness: { classType: 'cross' },
      },
      expected: { intent: 'trial_interest', shouldCreateLead: true },
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: 'seed_004',
      scenarioId,
      source: 'ai_generated',
      status: 'reviewed',
      persona: { type: 'edge_case_horario', behavior: 'fora_da_janela', urgency: 'high' },
      inputVariants: ['Quero fazer aula hoje as 23:00'],
      data: {
        customer: { name: 'Ricardo Alves', phone: '+5511991110004', goal: 'bem_estar', preferredTime: '23:00' },
        fitness: { classType: 'funcional' },
      },
      expected: { intent: 'trial_interest', nextAction: 'offer_alternative_slot' },
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: 'seed_005',
      scenarioId,
      source: 'ai_generated',
      status: 'reviewed',
      persona: { type: 'edge_case_privacidade', behavior: 'resistente_dados', urgency: 'medium' },
      inputVariants: ['Quero conhecer, mas nao quero passar telefone'],
      data: {
        customer: { name: 'Patricia Gomes', phone: null, goal: 'saude', preferredTime: '17:00' },
        fitness: { classType: 'pilates' },
      },
      expected: { intent: 'trial_interest', nextAction: 'ask_required_contact_or_handoff' },
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

function buildFitnessExampleScenario() {
  const createdAt = nowIso();
  const id = 'fitness_trial_class';
  const scenario = {
    id,
    waveId: 'fitness-cliente-novo',
    vertical: 'fitness',
    journey: 'cliente_novo',
    name: 'Aula experimental',
    description: 'Cenario semantico de cliente novo para agendamento de aula experimental',
    source: 'ai_inferred',
    status: 'active',
    executionStatus: 'queued',
    version: 'v1',
    channels: ['whatsapp', 'chat'],
    risk: 'high',
    priority: 'high',
    preconditions: [
      { type: 'tenant_ready', description: 'Tenant fitness com agenda ativa' },
    ],
    steps: [
      {
        id: 'step_001_send_message',
        order: 1,
        type: 'send_message',
        adapter: 'whatsapp',
        channel: 'whatsapp',
        input: {
          variants: [
            'Tem aula experimental?',
            'Posso fazer uma aula teste?',
            'Quero conhecer a academia',
          ],
        },
        enabled: true,
      },
      {
        id: 'step_002_validate_intent',
        order: 2,
        type: 'validate_intent',
        adapter: 'aiIntentService',
        expected: { intent: 'trial_interest', confidenceMin: 0.7 },
        enabled: true,
      },
      {
        id: 'step_003_validate_offer_response',
        order: 3,
        type: 'validate_response',
        adapter: 'ragService',
        expected: { semantic: 'oferta de aula experimental' },
        enabled: true,
      },
      {
        id: 'step_004_provide_data',
        order: 4,
        type: 'provide_data',
        adapter: 'api',
        data: {
          name: '{{seed.customer.name}}',
          phone: '{{seed.customer.phone}}',
          goal: '{{seed.customer.goal}}',
        },
        enabled: true,
      },
      {
        id: 'step_005_check_availability',
        order: 5,
        type: 'check_availability',
        adapter: 'schedulingService',
        enabled: true,
      },
      {
        id: 'step_006_select_slot',
        order: 6,
        type: 'select_slot',
        adapter: 'schedulingService',
        data: {
          class_type: '{{seed.fitness.classType}}',
          time: '{{seed.customer.preferredTime}}',
        },
        enabled: true,
      },
      {
        id: 'step_007_validate_backend_booking',
        order: 7,
        type: 'validate_backend',
        adapter: 'api',
        expected: {
          backendEntity: 'booking',
          backendExists: true,
        },
        enabled: true,
      },
      {
        id: 'step_008_validate_confirmation',
        order: 8,
        type: 'validate_response',
        adapter: 'ragService',
        expected: { semantic: 'confirmacao de agendamento' },
        enabled: true,
      },
      {
        id: 'step_009_validate_sla',
        order: 9,
        type: 'validate_sla',
        adapter: 'meshValidator',
        data: { maxMs: 15000 },
        enabled: true,
      },
      {
        id: 'step_010_validate_fallback',
        order: 10,
        type: 'validate_fallback',
        adapter: 'flowEngine',
        expected: { fallbackTriggered: false },
        enabled: true,
      },
    ],
    semanticSteps: [
      {
        id: 'step_001_send_message',
        order: 1,
        type: 'send_message',
        adapter: 'whatsapp',
        channel: 'whatsapp',
        input: {
          variants: [
            'Tem aula experimental?',
            'Posso fazer uma aula teste?',
            'Quero conhecer a academia',
          ],
        },
        enabled: true,
      },
      {
        id: 'step_002_validate_intent',
        order: 2,
        type: 'validate_intent',
        adapter: 'aiIntentService',
        expected: { intent: 'trial_interest', confidenceMin: 0.7 },
        enabled: true,
      },
      {
        id: 'step_003_validate_offer_response',
        order: 3,
        type: 'validate_response',
        adapter: 'ragService',
        expected: { semantic: 'oferta de aula experimental' },
        enabled: true,
      },
      {
        id: 'step_004_provide_data',
        order: 4,
        type: 'provide_data',
        adapter: 'api',
        data: {
          name: '{{seed.customer.name}}',
          phone: '{{seed.customer.phone}}',
          goal: '{{seed.customer.goal}}',
        },
        enabled: true,
      },
      {
        id: 'step_005_check_availability',
        order: 5,
        type: 'check_availability',
        adapter: 'schedulingService',
        enabled: true,
      },
      {
        id: 'step_006_select_slot',
        order: 6,
        type: 'select_slot',
        adapter: 'schedulingService',
        data: {
          class_type: '{{seed.fitness.classType}}',
          time: '{{seed.customer.preferredTime}}',
        },
        enabled: true,
      },
      {
        id: 'step_007_validate_backend_booking',
        order: 7,
        type: 'validate_backend',
        adapter: 'api',
        expected: {
          backendEntity: 'booking',
          backendExists: true,
        },
        enabled: true,
      },
      {
        id: 'step_008_validate_confirmation',
        order: 8,
        type: 'validate_response',
        adapter: 'ragService',
        expected: { semantic: 'confirmacao de agendamento' },
        enabled: true,
      },
      {
        id: 'step_009_validate_sla',
        order: 9,
        type: 'validate_sla',
        adapter: 'meshValidator',
        data: { maxMs: 15000 },
        enabled: true,
      },
      {
        id: 'step_010_validate_fallback',
        order: 10,
        type: 'validate_fallback',
        adapter: 'flowEngine',
        expected: { fallbackTriggered: false },
        enabled: true,
      },
    ],
    seeds: buildFitnessExampleSeeds(id),
    validators: [
      { id: 'validator_001', type: 'semantic_intent', expected: 'trial_interest' },
      { id: 'validator_002', type: 'semantic_response', expected: 'confirmacao de agendamento' },
    ],
    validations: {
      slaMs: 15000,
      fallbackAllowed: false,
      requireBackendValidation: true,
      requireReplay: true,
    },
    tags: {
      waveId: 'fitness-cliente-novo',
      journey: 'cliente_novo',
      scenario: 'fitness_trial_class',
      source: 'ai_inferred',
      vertical: 'fitness',
    },
    platform: {
      platformScenarioIds: ['business-f1'],
    },
    platformScenarioIds: ['business-f1'],
    createdAt,
    updatedAt: createdAt,
  };

  return scenario;
}

function listLatestScenarios(filters = {}) {
  const store = loadScenarioStore();
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

  let items = Array.from(byId.values());
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
  if (runnable.length > 0) return runnable;
  // Todos os IDs explícitos requerem pipeline → usar smoke local
  return [LOCAL_SMOKE_SCENARIO_ID];
}

function inferPlatformScenarioIds(scenario) {
  // Novo modelo: apenas retorna platformScenarioIds explícitos, sem inferência automática
  // Exceção: omnichannel_studiooly_rpa pode ter suggestedPlatformScenarioIds
  
  const explicit = Array.isArray(scenario?.platformScenarioIds)
    ? scenario.platformScenarioIds.filter(Boolean)
    : [];
  
  const platform = Array.isArray(scenario?.platform?.platformScenarioIds)
    ? scenario.platform.platformScenarioIds.filter(Boolean)
    : [];
  
  const explicit_v2 = Array.isArray(scenario?.platform?.platformScenarioIds)
    ? scenario.platform.platformScenarioIds.filter(Boolean)
    : [];
  
  // Retorna apenas valores explícitos; sem inferência
  return Array.from(new Set([...explicit, ...platform, ...explicit_v2]));
}

function inferScenario(input = {}) {
  const vertical = String(input.vertical || '').toLowerCase();
  const journey = String(input.journey || '').toLowerCase();
  const goal = String(input.goal || '').toLowerCase();

  let aiOutput = input.aiOutput;
  if (!aiOutput && vertical === 'fitness' && journey.includes('cliente_novo') && goal.includes('aula')) {
    aiOutput = buildFitnessExampleScenario();
  }

  if (!aiOutput) {
    const baseName = input.goal || 'cenario_ia';
    aiOutput = {
      id: toSlug(`${vertical}_${journey}_${baseName}`),
      waveId: `${vertical}-${journey}`,
      vertical,
      journey,
      name: input.goal || 'Cenario inferido por IA',
      source: 'ai_inferred',
      status: 'draft',
      channels: Array.isArray(input.channels) ? input.channels : ['api'],
      steps: [
        { type: 'send_message', channel: (input.channels || ['api'])[0], input: { text: input.goal || 'mensagem inicial' } },
        { type: 'validate_intent', expected: { intent: 'unknown', confidenceMin: 0.6 } },
        { type: 'validate_response', expected: { semantic: input.goal || 'resposta valida' } },
      ],
      validations: { requireReplay: true, fallbackAllowed: true, requireBackendValidation: false, slaMs: 15000 },
      platform: { platformScenarioIds: inferPlatformScenarioIds({ vertical, journey }) },
    };
  }

  const adapted = adaptAiScenario(aiOutput, {
    vertical,
    journey,
    goal: input.goal,
    channels: input.channels,
  });

  if (adapted.scenario && (!adapted.scenario.platform || !Array.isArray(adapted.scenario.platform.platformScenarioIds))) {
    adapted.scenario.platform = { platformScenarioIds: inferPlatformScenarioIds(adapted.scenario) };
  }

  if (input.constraints?.generateSeeds === true && (!adapted.scenario.seeds || adapted.scenario.seeds.length === 0)) {
    adapted.scenario.seeds = buildFitnessExampleSeeds(adapted.scenario.id).map((seed) => ({
      ...seed,
      scenarioId: adapted.scenario.id,
    }));
  }

  return adapted;
}

function buildGeneratedSeeds(scenario, count = 5) {
  const now = nowIso();
  const base = buildFitnessExampleSeeds(scenario.id);
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
  return listed.items.find((item) => item.id === scenarioId) || null;
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
    normalizedScenario: adapted.scenario,
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
  const saved = {
    ...normalized,
    version,
    updatedAt: nowIso(),
    createdAt: normalized.createdAt || nowIso(),
    platform: {
      ...(normalized.platform || {}),
      platformScenarioIds: inferPlatformScenarioIds(normalized),
    },
  };

  store.scenarios.push(saved);
  if (!Array.isArray(store.history[scenarioId])) store.history[scenarioId] = [];
  store.history[scenarioId].push({
    version,
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
  const scenarios = listed.items.filter((item) => scenarioIds.includes(item.id));
  if (scenarios.length === 0) {
    const error = new Error('Nenhum scenario encontrado para execucao');
    error.code = 'NOT_FOUND';
    throw error;
  }

  for (const scenario of scenarios) {
    const validation = validateScenarioCompatibility(scenario);
    if (!validation.valid) {
      const error = new Error(`Scenario invalido: ${scenario.id}`);
      error.code = 'BAD_REQUEST';
      error.details = validation;
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

  return executePreparedWaveScenarios({
    expanded,
    platformScenarioIds,
    governanceFindings,
  });
}

module.exports = {
  inferScenario,
  generateSeeds,
  validateScenarioPayload,
  saveScenario,
  listLatestScenarios,
  runScenarioExecution,
  loadScenarioStore,
  upsertScenarioStore,
  normalizeScenarioRecord,
};
