'use strict';

const logger = require('../utils/logger');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveRuntimePath } = require('../utils/runtimePaths');
const { getRpaSeedReadDirs } = require('../../lib/rpaPathResolver');
const { belongsToTenant, normalizeTenantKey } = require('../../lib/rpaSecurity');
const { adaptAiScenario } = require('../modules/qa-waves/aiScenarioAdapter');
const { validateScenarioCompatibility } = require('../modules/qa-waves/waveScenarioSchema');
const { EXECUTABLE_SCENARIO_STATUS } = require('../modules/qa-waves/waveScenario.constants');
const { writeJsonAtomic } = require('../utils/atomicJsonFile');
const {
  inferJourney,
  resolveJourneyFromRegistry,
} = require('../../qa/qa-waves/services/journeyInferenceService');

const ROOT_DIR = path.join(__dirname, '..', '..');
// Override via env permite testes apontarem para um store temporário sem
// tocar no store real compartilhado (corrida entre workers paralelos do Jest).
const STORE_PATH = process.env.QA_WAVES_SCENARIO_STORE_PATH
  ? path.resolve(process.env.QA_WAVES_SCENARIO_STORE_PATH)
  : path.join(ROOT_DIR, 'qa', 'qa-waves', 'scenario-store.json');
const STORE_DEFAULT_VERSION = 1;

// --- Cenarios de RUNTIME (nao-canonical) -------------------------------------
// `qa/qa-waves/scenario-store.json` e um artefato GOVERN.ADO e RASTREADO: ele
// alimenta o `scenarioRegistryFingerprint` do proof chain. Cenarios criados por
// fluxos por-execucao (agent-factory cria um agente com slug timestampado a cada
// run e registra a validacao dele) NAO sao politica canonica: persisti-los no
// arquivo canonico suja a arvore e muda o fingerprint NO MEIO de um ciclo de
// selagem. Medido em 2026-10-04: o run canonico do mesh appendou
// `agent-validation-qa-agent-<ts>` no store rastreado e o passe `candidate`
// abortou com o gap CRITICO `gap-proof-stale-fingerprints`. Eles passam a viver
// no runtime root (fora do workspace, ver `docs/runtime-paths.md`) e continuam
// VISIVEIS na leitura (merge) para que a execucao real do QA Wave os resolva.
const RUNTIME_STORE_PATH_ENV = 'QA_WAVES_RUNTIME_SCENARIO_STORE_PATH';
const RUNTIME_ONLY_SCENARIO = Symbol.for('ragent2.qaWaves.runtimeOnlyScenario');

function markRuntimeOnlyScenario(scenario) {
  if (scenario && typeof scenario === 'object') {
    Object.defineProperty(scenario, RUNTIME_ONLY_SCENARIO, {
      value: true, enumerable: false, configurable: true, writable: true,
    });
  }
  return scenario;
}

function isRuntimeOnlyScenario(scenario) {
  return Boolean(scenario && typeof scenario === 'object' && scenario[RUNTIME_ONLY_SCENARIO]);
}

function resolveRuntimeScenarioStorePath() {
  const override = String(process.env[RUNTIME_STORE_PATH_ENV] || '').trim();
  if (override) return path.resolve(override);
  try {
    return path.join(resolveRuntimePath('qa-waves'), 'runtime-scenario-store.json');
  } catch (error) {
    logger.warn(`[qaWavesScenarioService] Runtime root indisponivel: ${error.message}`);
    return path.join(os.tmpdir(), 'ragent2-runtime', 'qa-waves', 'runtime-scenario-store.json');
  }
}

function emptyStoreDocument() {
  return {
    version: STORE_DEFAULT_VERSION,
    scenarios: [],
    history: {},
    updatedAt: nowIso(),
    format: 'object',
  };
}

function readRuntimeScenarioStore() {
  const targetPath = resolveRuntimeScenarioStorePath();
  try {
    if (!fs.existsSync(targetPath)) return emptyStoreDocument();
    return normalizeStoreDocument(JSON.parse(fs.readFileSync(targetPath, 'utf8')));
  } catch (error) {
    logger.warn(`[qaWavesScenarioService] Runtime store ilegivel (${targetPath}): ${error.message}`);
    return emptyStoreDocument();
  }
}

function scenarioHistoryKey(scenario) {
  return `${normalizeTenantKey(scenario && scenario.tenantId)}::${String((scenario && scenario.id) || '')}`;
}

/**
 * Filtra o mapa de historico pelas chaves informadas (`tenantId::scenarioId`).
 * Usado para impedir que o historico de um cenario de runtime vaze para o
 * arquivo canonico rastreado.
 */
function selectHistoryByKeys(history, keys) {
  const source = history && typeof history === 'object' ? history : {};
  const selected = {};
  for (const [key, value] of Object.entries(source)) {
    if (keys.has(key)) selected[key] = value;
  }
  return selected;
}

/**
 * Persiste APENAS os cenarios de runtime no store externo (fora do workspace),
 * fazendo upsert pelas chaves e carregando o historico correspondente.
 */
function writeRuntimeScenarioStore(store, runtimeScenarios) {
  if (!Array.isArray(runtimeScenarios) || runtimeScenarios.length === 0) return;
  const targetPath = resolveRuntimeScenarioStorePath();
  const existing = readRuntimeScenarioStore();
  const keys = new Set(runtimeScenarios.map(scenarioHistoryKey));
  const kept = existing.scenarios.filter((item) => !keys.has(scenarioHistoryKey(item)));
  const history = { ...existing.history };
  for (const key of keys) {
    if (store && store.history && store.history[key]) history[key] = store.history[key];
  }
  ensureDir(path.dirname(targetPath));
  writeJsonAtomic(targetPath, {
    version: existing.version || STORE_DEFAULT_VERSION,
    scenarios: [...kept, ...runtimeScenarios],
    history,
    updatedAt: nowIso(),
  });
}

/**
 * Mescla os cenarios de runtime na leitura. O canonico VENCE em conflito de
 * chave (`tenantId::id`), de modo que um cenario canonico nunca e sobrescrito
 * por residuo de runtime.
 */
function mergeRuntimeScenarios(store) {
  const runtime = readRuntimeScenarioStore();
  if (runtime.scenarios.length === 0) return store;
  const seen = new Set(store.scenarios.map(scenarioHistoryKey));
  const scenarios = [...store.scenarios];
  for (const scenario of runtime.scenarios) {
    const key = scenarioHistoryKey(scenario);
    if (seen.has(key)) continue;
    seen.add(key);
    scenarios.push(markRuntimeOnlyScenario({ ...scenario }));
  }
  const history = { ...store.history };
  for (const [key, entry] of Object.entries(runtime.history)) {
    if (!history[key]) history[key] = entry;
  }
  return { ...store, scenarios, history };
}

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
    writeJsonAtomic(STORE_PATH, {
      version: STORE_DEFAULT_VERSION,
      scenarios: [],
      history: {},
      updatedAt: nowIso(),
    });
  }

  // A escrita é atômica (temp + rename), mas dois processos podem escrever
  // concorrentemente e um ler o arquivo no meio do rename de outro → JSON.parse
  // falha. Re-tenta a leitura antes de cair no fallback VAZIO, que causava
  // sobrescrita destrutiva do store (397 cenários → 1) quando um job em
  // background materializava draft IA durante outra execução.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const content = fs.readFileSync(STORE_PATH, 'utf8');
      return normalizeStoreDocument(JSON.parse(content));
    } catch (error) {
      if (attempt < 3) {
        // A outra escrita (temp + rename) é rápida; sleep síncrono curto
        // para o rename concluir antes de re-ler.
        const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
        Atomics.wait(sleepBuffer, 0, 0, attempt * 15);
        continue;
      }
      logger.error(`Erro ao ler store (após ${attempt} tentativas): ${error.message}`);
    }
  }

  return {
    version: STORE_DEFAULT_VERSION,
    scenarios: [],
    history: {},
    updatedAt: nowIso(),
    format: 'object',
  };
}

function saveStore(store) {
  // Particiona ANTES de normalizar: o flag de runtime e um simbolo
  // nao-enumeravel e nao pode vazar para o arquivo canonico rastreado.
  const scenarios = Array.isArray(store && store.scenarios) ? store.scenarios : [];
  const runtimeScenarios = scenarios.filter(isRuntimeOnlyScenario);
  const canonicalScenarios = scenarios.filter((item) => !isRuntimeOnlyScenario(item));

  // O `history` tambem e particionado: sem isso, o registro de alteracao de um
  // cenario de RUNTIME era gravado no arquivo canonico RASTREADO, deixando a
  // arvore suja a cada run do mesh (o preflight do selo exige worktree limpo).
  const canonicalKeys = new Set(canonicalScenarios.map(scenarioHistoryKey));
  const normalized = normalizeStoreDocument({
    ...store,
    scenarios: canonicalScenarios,
    history: selectHistoryByKeys(store && store.history, canonicalKeys),
  });
  normalized.updatedAt = nowIso();

  if (normalized.format === 'array') {
    writeJsonAtomic(STORE_PATH, normalized.scenarios);
  } else {
    writeJsonAtomic(STORE_PATH, {
      version: normalized.version,
      scenarios: normalized.scenarios,
      history: normalized.history,
      updatedAt: normalized.updatedAt,
    });
  }

  writeRuntimeScenarioStore(store, runtimeScenarios);
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

function loadRpaSeedsIndex(tenantId = 'system') {
  const scopedTenantId = normalizeTenantKey(tenantId);
  try {
    const index = new Map();

    for (const seedDir of getRpaSeedReadDirs(scopedTenantId)) {
      if (!fs.existsSync(seedDir)) continue;
      const files = fs.readdirSync(seedDir).filter((name) => name.endsWith('.json'));
      for (const fileName of files) {
        try {
          const filePath = path.join(seedDir, fileName);
          const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (!belongsToTenant(raw, scopedTenantId)) continue;
          const seedId = String(raw?.id || fileName.replace(/\.json$/i, '')).trim();
          if (!seedId || index.has(seedId)) continue;
          index.set(seedId, { ...raw, __fileName: fileName });
        } catch (_) {
          // Ignora seed inválida para não quebrar listagem de cenários.
        }
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
  // journeyId explicito que nao existe no registry (ex.: placeholder do
  // adapter) nao e uma jornada real: descarta e deixa a IA escolher entre
  // as jornadas candidatas da vertical.
  const explicitJourneyId = String(input.journeyId || input.journey || '').trim();
  if (explicitJourneyId && input.preserveExplicitJourney === true) {
    return {
      journeyId: explicitJourneyId,
      journey: explicitJourneyId,
      journeySteps: Array.isArray(input.journeySteps) ? clone(input.journeySteps) : [],
      journeySource: String(input.journeySource || '').trim() || 'manual_review',
      baseTemplateId: input.baseTemplateId || 'customer_lifecycle_v1',
    };
  }
  const resolvedInRegistry = explicitJourneyId
    ? resolveJourneyFromRegistry({ ...input, journeyId: explicitJourneyId })
    : null;
  const journeyInput = resolvedInRegistry
    ? input
    : { ...input, journeyId: '', journey: '' };

  const journey = await inferJourney({
    vertical: journeyInput.vertical,
    journeyId: journeyInput.journeyId || journeyInput.journey,
    journey: journeyInput.journey,
    journeySource: journeyInput.journeySource,
    scenarioName: journeyInput.name || journeyInput.title || journeyInput.goal,
    description: journeyInput.description,
    tenantId: journeyInput.tenantId,
    baseTemplateId: journeyInput.baseTemplateId,
  });

  const inputSource = String(input.journeySource || '').trim();
  return {
    journeyId: journey.journeyId,
    journey: journey.journeyId,
    journeySteps: Array.isArray(input.journeySteps) && input.journeySteps.length > 0
      ? clone(input.journeySteps)
      : clone(journey.steps || []),
    journeySource: inputSource && inputSource !== 'unresolved'
      ? inputSource
      : (journey.journeySource || 'inferred'),
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
  // Lookup estrito no registry (sem scoring por tokens). Quando nao ha
  // journeyId explicito, o cenario fica 'unresolved': a resolucao semantica
  // via IA acontece no caminho async (generateScenarioWithAI).
  const explicitJourneyId = String(input.journeyId || input.journey || '').trim();
  const registryJourney = resolveJourneyFromRegistry({
    vertical: input.vertical,
    journeyId: explicitJourneyId,
    journeySource: input.journeySource,
    baseTemplateId: input.baseTemplateId,
  });
  const resolvedJourneyId = explicitJourneyId || (registryJourney ? registryJourney.journeyId : '');
  const resolvedJourneySteps = Array.isArray(input.journeySteps) && input.journeySteps.length > 0
    ? clone(input.journeySteps)
    : clone((registryJourney && registryJourney.steps) || []);
  const normalized = {
    ...clone(input),
    id: String(input.id || '').trim(),
    tenantId: normalizeTenantKey(input.tenantId || input.tenant_id || 'system'),
    journeyId: resolvedJourneyId,
    journey: resolvedJourneyId,
    journeySteps: resolvedJourneySteps,
    journeySource: String(input.journeySource || '').trim()
      || (registryJourney ? registryJourney.journeySource : (resolvedJourneyId ? 'manual' : 'unresolved')),
    baseTemplateId: String(input.baseTemplateId || (registryJourney && registryJourney.baseTemplateId) || 'customer_lifecycle_v1').trim(),
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
    // `normalizeScenarioRecord` RECONSTRÓI o objeto: sem repor o flag, um cenário
    // de runtime perderia a marcação no dedupe e migraria para o arquivo canônico.
    if (isRuntimeOnlyScenario(item)) markRuntimeOnlyScenario(normalized);

    const storageKey = `${normalized.tenantId}\u0000${normalized.id}`;
    const existing = deduped.get(storageKey);
    if (!existing) {
      deduped.set(storageKey, normalized);
      continue;
    }

    const existingVersion = Number.parseInt(String(existing.version || 'v0').replace(/^v/i, ''), 10) || 0;
    const candidateVersion = Number.parseInt(String(normalized.version || 'v0').replace(/^v/i, ''), 10) || 0;
    if (candidateVersion >= existingVersion) deduped.set(storageKey, normalized);
  }

  if (invalidScenarios.length > 0) {
    logger.warn('[qaWavesScenarioService] Ignorando cenarios invalidos no store durante deduplicacao', invalidScenarios);
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
  // Merge DEPOIS do dedupe: `dedupeStoreScenarios` re-normaliza os objetos e
  // descartaria o flag de runtime se ele fosse aplicado antes.
  return mergeRuntimeScenarios(store);
}

function upsertScenarioStore(scenario, options = {}) {
  const store = loadScenarioStore();
  const normalized = normalizeScenarioRecord(scenario);
  const index = store.scenarios.findIndex((item) => item.id === normalized.id
    && belongsToTenant(item, normalized.tenantId));
  const runtimeOnly = options.nonCanonical === true
    || (scenario && scenario.nonCanonical === true)
    || (index >= 0 && isRuntimeOnlyScenario(store.scenarios[index]));

  let record;
  if (index >= 0) {
    const previous = store.scenarios[index];
    record = {
      ...previous,
      ...normalized,
      createdAt: previous.createdAt || normalized.createdAt,
      updatedAt: nowIso(),
    };
    store.scenarios[index] = record;
  } else {
    record = normalized;
    store.scenarios.push(record);
  }
  if (runtimeOnly) markRuntimeOnlyScenario(record);

  const historyKey = `${normalized.tenantId}::${normalized.id}`;
  if (!Array.isArray(store.history[historyKey])) store.history[historyKey] = [];
  store.history[historyKey].push({
    version: normalized.version || (index >= 0 ? store.scenarios[index].version : 'v1'),
    changedBy: options.changedBy || 'system',
    changedAt: nowIso(),
    changes: Array.isArray(options.changes) ? options.changes : ['scenario upserted'],
  });

  dedupeStoreScenarios(store);
  saveStore(store);
  return clone(store.scenarios.find((item) => item.id === normalized.id
    && belongsToTenant(item, normalized.tenantId)));
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
  const scopedTenantId = normalizeTenantKey(filters.tenantId || 'system');
  const store = loadScenarioStore();
  const rpaSeedsIndex = loadRpaSeedsIndex(scopedTenantId);
  const byId = new Map();
  for (const item of store.scenarios.filter((candidate) => belongsToTenant(candidate, scopedTenantId))) {
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
    history: Object.fromEntries(Object.entries(store.history || {}).filter(([key]) => (
      key.startsWith(`${scopedTenantId}::`) || (scopedTenantId === 'system' && !key.includes('::'))
    ))),
  };
}

function collectDeclaredPlatformScenarioIds(scenario) {
  const explicit = Array.isArray(scenario?.platformScenarioIds)
    ? scenario.platformScenarioIds.filter(Boolean)
    : [];

  const platform = Array.isArray(scenario?.platform?.platformScenarioIds)
    ? scenario.platform.platformScenarioIds.filter(Boolean)
    : [];

  const suggested = Array.isArray(scenario?.suggestedPlatformScenarioIds)
    ? scenario.suggestedPlatformScenarioIds.filter(Boolean)
    : [];

  return Array.from(new Set([...explicit, ...platform, ...suggested]));
}

// Retorna os platformScenarioIds declarados (explícitos, platform.* ou suggested),
// sem erro — persistência/inferência preservam IDs; a checagem mandatória de
// vínculo de execução acontece apenas em runScenarioExecution.
function tryInferPlatformScenarioIds(scenario) {
  return collectDeclaredPlatformScenarioIds(scenario);
}

function inferScenario(input = {}) {
  const tenantId = normalizeTenantKey(input.tenantId || 'system');
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
    adapted.scenario.tenantId = tenantId;
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

  // Lookup estrito no registry. O adapter pode preencher um placeholder
  // ('default_journey') que nao existe no registry: nesse caso a jornada
  // fica 'unresolved' e o caminho async (generateScenarioWithAI) resolve
  // via IA. Sem fallback heuristico por tokens.
  const registryJourney = resolveJourneyFromRegistry({
    vertical,
    journeyId: adapted.scenario.journeyId || adapted.scenario.journey || journey,
    journeySource: adapted.scenario.journeySource,
    baseTemplateId: adapted.scenario.baseTemplateId,
  });

  if (registryJourney) {
    adapted.scenario = {
      ...adapted.scenario,
      journeyId: adapted.scenario.journeyId || registryJourney.journeyId,
      journey: adapted.scenario.journey || registryJourney.journeyId,
      journeySteps: Array.isArray(adapted.scenario.journeySteps) && adapted.scenario.journeySteps.length > 0
        ? adapted.scenario.journeySteps
        : registryJourney.steps,
      journeySource: adapted.scenario.journeySource || registryJourney.journeySource,
      baseTemplateId: adapted.scenario.baseTemplateId || registryJourney.baseTemplateId,
    };
  } else {
    // Mantem o journeyId original (mesmo que seja placeholder do adapter):
    // o store exige journeyId nao vazio. A marca 'unresolved' sinaliza que
    // a jornada ainda nao foi confirmada no registry — o caminho async
    // (generateScenarioWithAI) resolve via IA.
    adapted.scenario = {
      ...adapted.scenario,
      journeySteps: Array.isArray(adapted.scenario.journeySteps) ? adapted.scenario.journeySteps : [],
      journeySource: 'unresolved',
      baseTemplateId: adapted.scenario.baseTemplateId || 'customer_lifecycle_v1',
    };
  }

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

function getLatestScenarioById(scenarioId, tenantId = 'system') {
  const listed = listLatestScenarios({ tenantId });
  const existing = listed.items.find((item) => item.id === scenarioId) || null;
  if (existing) return existing;

  return null;
}

function validateScenarioPayload(payload = {}) {
  const requestedTenantId = payload.tenantId || payload.scenario?.tenantId || 'system';
  const scenario = {
    ...(payload.scenario || payload),
    tenantId: normalizeTenantKey(requestedTenantId),
  };
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
    normalizedScenario: normalizeScenarioRecord({
      ...adapted.scenario,
      tenantId: scenario.tenantId,
    }),
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
  const scopedTenantId = normalized.tenantId;
  const scenarioId = normalized.id;
  const previousVersions = store.scenarios
    .filter((item) => item.id === scenarioId && belongsToTenant(item, scopedTenantId))
    .map((item) => item.version);
  const runtimeOnly = payload.nonCanonical === true
    || store.scenarios.some((item) => item.id === scenarioId
      && belongsToTenant(item, scopedTenantId)
      && isRuntimeOnlyScenario(item));

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
  if (runtimeOnly) markRuntimeOnlyScenario(saved);
  const historyKey = `${scopedTenantId}::${scenarioId}`;
  if (!Array.isArray(store.history[historyKey])) store.history[historyKey] = [];
  store.history[historyKey].push({
    version: effectiveVersion,
    changedBy: payload.changedBy || (saved.source === 'manual' ? 'manual' : 'ai_inferred'),
    changedAt: saved.updatedAt,
    changes: Array.isArray(payload.changes) ? payload.changes : ['scenario atualizado'],
    reviewId: payload.reviewId || null,
  });

  saveStore(store);
  return {
    scenario: saved,
    history: store.history[historyKey],
  };
}

function generateSeeds(payload = {}) {
  const scopedTenantId = normalizeTenantKey(payload.tenantId || 'system');
  const scenarioId = String(payload.scenarioId || '');
  if (!scenarioId) {
    const error = new Error('scenarioId obrigatorio');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const scenario = getLatestScenarioById(scenarioId, scopedTenantId);
  if (!scenario) {
    const error = new Error('Scenario nao encontrado');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const seeds = buildGeneratedSeeds(scenario, payload.count || 5);
  const store = ensureStore();
  const index = store.scenarios.findIndex((item) => item.id === scenario.id
    && item.version === scenario.version
    && belongsToTenant(item, scopedTenantId));
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
  const scopedTenantId = normalizeTenantKey(payload.tenantId || 'system');
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

  const listed = listLatestScenarios({ tenantId: scopedTenantId });
  const scenarios = scenarioIds
    .map((scenarioId) => listed.items.find((item) => item.id === scenarioId)
      || getLatestScenarioById(scenarioId, scopedTenantId))
    .filter(Boolean);
  if (scenarios.length === 0) {
    const error = new Error('Nenhum scenario encontrado para execucao');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const isDevMode = payloadAllowsDevExecution(payload);

  // Partição: cenários executáveis vs bloqueados por recurso não disponível
  // no ambiente (sem platformScenarioIds ou pipeline-only). Em vez de abortar
  // toda a onda, os bloqueados são reportados como falha com motivo claro.
  const runnableEntries = [];   // { scenario, platformScenarioIds }
  const blockedScenarios = [];  // { scenario, code, message }

  for (const scenario of scenarios) {
    // FASE 15 — draft_ai NUNCA executa como evidência: rascunho gerado por IA
    // exige aprovação explícita (approved/active/regression). A regra vale
    // inclusive em devMode/allowNonExecutableStatus — não há bypass.
    if (String(scenario.status || '').toLowerCase() === 'draft_ai') {
      const error = new Error(`Cenario draft_ai nao executavel como evidencia: ${scenario.id} — aprovacao obrigatoria`);
      error.code = 'SCENARIO_NOT_APPROVED';
      error.details = {
        scenarioId: scenario.id,
        status: scenario.status,
        requiredStatus: EXECUTABLE_SCENARIO_STATUS,
      };
      throw error;
    }

    const validation = validateScenarioCompatibility(scenario);
    // A ausência de platformScenarioIds deixa de ser erro fatal: vira bloqueio
    // por recurso de ambiente (reportado, não aborta a onda).
    const nonEnvErrors = (validation.errors || [])
      .filter((item) => item && item.code !== 'missing_platform_scenario_ids');
    if (!validation.valid && nonEnvErrors.length > 0) {
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

    // Recurso de ambiente: vínculo com cenário de plataforma. Sem vínculo não
    // há o que executar; com vínculo, o cenário RODA — se depender de recurso
    // indisponível (ex.: WhatsApp não configurado), a execução falha com o
    // motivo real, sem bloqueio por pipeline.
    const declared = collectDeclaredPlatformScenarioIds(scenario);
    if (declared.length === 0) {
      blockedScenarios.push({
        scenario,
        code: 'MISSING_PLATFORM_SCENARIO_IDS',
        message: `Cenário "${scenario.id}" sem platformScenarioIds — não há vínculo de execução.`,
      });
      continue;
    }
    runnableEntries.push({ scenario, platformScenarioIds: declared });
  }

  const replayEnabled = payload.replay !== false
    && runnableEntries.every(({ scenario }) => scenario.validations?.requireReplay !== false);
  if (!replayEnabled) {
    const error = new Error('Replay deve estar habilitado para executar Waves RPA');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const blockedSummary = blockedScenarios.map(({ scenario, code, message }) => ({
    scenarioId: scenario.id,
    vertical: scenario.vertical,
    journey: scenario.journeyId || scenario.journey,
    code,
    message,
  }));

  if (runnableEntries.length === 0) {
    return {
      status: 'blocked',
      executionId: null,
      replayId: null,
      replayIds: [],
      blocked: blockedSummary,
      message: 'Nenhum cenário executável localmente: todos dependem de recursos não disponíveis no ambiente.',
    };
  }

  const runnableScenarios = runnableEntries.map(({ scenario }) => scenario);
  const governanceFindings = evaluateGovernanceBeforeRun({ scenarios: runnableScenarios, replayEnabled });
  const blocking = governanceFindings.find((finding) => finding.level === 'NO_GO' && finding.code === 'invalid_step');
  if (blocking) {
    const error = new Error('Governanca bloqueou execucao por step invalido');
    error.code = 'BAD_REQUEST';
    error.details = governanceFindings;
    throw error;
  }

  const selectedSeedIds = Array.isArray(payload.seedIds) ? payload.seedIds : [];
  const expanded = [];
  for (const { scenario, platformScenarioIds } of runnableEntries) {
    const seeds = Array.isArray(scenario.seeds) ? scenario.seeds : [];
    const filtered = selectedSeedIds.length > 0
      ? seeds.filter((seed) => selectedSeedIds.includes(seed.id))
      : seeds.filter((seed) => isSeedExecutableForEvidence(seed));

    if (filtered.length === 0) {
      expanded.push({ scenario, seed: null, platformScenarioIds });
      continue;
    }

    filtered.forEach((seed) => expanded.push({ scenario, seed, platformScenarioIds }));
  }

  const platformScenarioIds = Array.from(new Set(
    expanded.flatMap((entry) => entry.platformScenarioIds)
  ));

  if (platformScenarioIds.length === 0) {
    const error = new Error('Nenhum cenario compativel com a plataforma para execucao na QA Mesh');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const { executePreparedWaveScenarios } = require('./qaWavesExecutionService');
  return executePreparedWaveScenarios({
    expanded: expanded.map(({ scenario, seed }) => ({ scenario, seed })),
    platformScenarioIds,
    governanceFindings,
    tenantId: scopedTenantId,
    blockedScenarios,
  }).then((result) => ({
    ...result,
    blocked: blockedSummary,
  }));
}

function payloadAllowsDevExecution(payload = {}) {
  if (payload.devMode === true || payload.allowNonExecutableStatus === true) return true;
  return process.env.NODE_ENV !== 'production';
}

/**
 * FASE 15 — seeds em rascunho de IA (`draft_ai`) ou desabilitadas não podem
 * ser executadas como evidência. Seeds legadas sem status explícito seguem
 * elegíveis (compatibilidade); apenas status declarados como não-aprovados
 * são excluídos.
 */
function isSeedExecutableForEvidence(seed) {
  const status = String(seed?.status || '').toLowerCase();
  return status !== 'disabled' && status !== 'draft_ai';
}

function deleteScenario(scenarioId, tenantId = 'system') {
  const scopedTenantId = normalizeTenantKey(tenantId);
  if (!scenarioId) throw Object.assign(new Error('scenarioId é obrigatório'), { code: 'BAD_REQUEST' });
  const store = loadScenarioStore();
  const index = store.scenarios.findIndex((s) => s.id === scenarioId
    && belongsToTenant(s, scopedTenantId));
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
  isSeedExecutableForEvidence,
};
