const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const uiStepInference = require('./uiStepInferenceService');
const validatorInference = require('./validatorInferenceService');
const seedInference = require('./seedInferenceService');
const { getTenantRuntimeRpaDir } = require('../../../lib/rpaPathResolver');
const { belongsToTenant, normalizeTenantKey } = require('../../../lib/rpaSecurity');
const { writeJsonAtomic } = require('../../utils/atomicJsonFile');

const SCENARIOS_STORE_PATH = path.join(__dirname, '../../../qa/qa-waves/scenario-store.json');

/**
 * Carrega scenario store existente
 */
function loadScenarioStore() {
  try {
    if (fs.existsSync(SCENARIOS_STORE_PATH)) {
      const raw = fs.readFileSync(SCENARIOS_STORE_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    logger.warn(`[AutoScenarioGenerator] Falha ao carregar scenario-store: ${err.message}`);
  }
  return { scenarios: [], journeys: [] };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  writeJsonAtomic(filePath, payload);
}

/**
 * Persiste scenario store atualizado
 */
function persistScenarioStore(store) {
  try {
    const dir = path.dirname(SCENARIOS_STORE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    writeJsonAtomic(SCENARIOS_STORE_PATH, store);
    logger.info(`[AutoScenarioGenerator] Scenario store persistido com sucesso`);
  } catch (err) {
    logger.error(`[AutoScenarioGenerator] Falha ao persistir scenario-store: ${err.message}`);
    throw err;
  }
}

/**
 * Gera ID único para cenário
 */
function generateScenarioId(capabilityName, seedType) {
  const timestamp = Date.now();
  const base = `${capabilityName.replace(/[^a-z0-9]/gi, '_')}_${seedType}`;
  return `${base}_${timestamp}`;
}

/**
 * Gera scenario completo para uma capability + seed type
 * Integra UI steps, validators e seeds
 */
function generateScenarioForCapability(
  capability = {},
  seedType = 'happy_path',
  frontendData = {},
  options = {}
) {
  const capId = capability.id || capability.name || 'unknown';
  const capName = capability.name || capId;
  const journeyId = capability.journeyId || capability.journey || options.journeyId || capName;
  const tenantId = normalizeTenantKey(options.tenantId, { defaultValue: 'system' });

  // 1. Gerar UI steps
  const uiSteps = uiStepInference.inferUIStepsForCapability(capability, frontendData);

  // 2. Gerar validators
  const validators = validatorInference.inferValidatorsForCapability(capability);

  // 3. Gerar seeds baseado no tipo
  const allSeeds = seedInference.generateSeedsForCapability(capability);
  const seedData = allSeeds.find((s) => s.type === seedType) || allSeeds[0];

  // 4. Montar scenario completo
  const scenarioId = generateScenarioId(capId, seedType);
  const scenario = {
    id: scenarioId,
    tenantId,
    name: `Auto: ${capName} (${seedType})`,
    version: '1.0',
    capabilityId: capId,
    capabilityName: capName,
    seedType,
    journey: journeyId,
    journeyId,
    vertical: capability.vertical || 'operations',
    steps: uiSteps,
    validators: validators,
    seed: seedData?.data || {},
    governanceRules: [
      { rule: 'require_real_execution', enabled: true },
      { rule: 'require_real_replay', enabled: true },
      { rule: 'forbid_fake_selectors', enabled: true },
      { rule: 'require_operational_consequence', enabled: true },
    ],
    replayRequirements: {
      requireHumanUser: true,
      requireRealModule: true,
      requireScreenshots: true,
      requireStateChange: true,
      requireOperationalConsequence: true,
      requireJourneyPath: true,
    },
    tags: ['auto-generated', `seed-${seedType}`, 'preflight-inferred'],
    metadata: {
      generatedAt: new Date().toISOString(),
      source: 'autoScenarioGenerator',
      capabilityVertical: capability.vertical,
      capabilityDomain: capability.domain,
      inferenceConfidence: 0.8,
    },
  };

  return scenario;
}

/**
 * Gera todos os seed types para uma capability
 */
function generateAllScenariosForCapability(capability = {}, frontendData = {}, options = {}) {
  const scenarios = [];

  // Prioridade: happy_path primeiro, depois edge cases, depois failures
  const seedTypes = [
    'happy_path',
    'empty_input',
    'invalid_format',
    'special_chars',
    'permission_denied',
    'timeout_condition',
  ];

  for (const seedType of seedTypes) {
    try {
      const scenario = generateScenarioForCapability(capability, seedType, frontendData, options);
      scenarios.push(scenario);
    } catch (err) {
      logger.warn(
        `[AutoScenarioGenerator] Falha ao gerar ${seedType} para ${capability.id}: ${err.message}`
      );
    }
  }

  return scenarios;
}

function persistGeneratedArtifacts(scenario = {}, options = {}) {
  if (!scenario || !scenario.id) return;

  const tenantId = normalizeTenantKey(options.tenantId || scenario.tenantId, { defaultValue: 'system' });
  const generatedBaseDir = getTenantRuntimeRpaDir(tenantId, 'qa-waves-generated');
  const generatedSeedsDir = path.join(generatedBaseDir, 'seeds');
  const generatedValidatorsDir = path.join(generatedBaseDir, 'validators');
  const generatedUiStepsDir = path.join(generatedBaseDir, 'ui-steps');
  const stamp = String(scenario.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  writeJson(path.join(generatedSeedsDir, `${stamp}.json`), {
    tenantId,
    scenarioId: scenario.id,
    capabilityId: scenario.capabilityId,
    journeyId: scenario.journeyId || scenario.journey || null,
    seedType: scenario.seedType || null,
    seed: scenario.seed || {},
    generatedAt: new Date().toISOString(),
  });

  writeJson(path.join(generatedValidatorsDir, `${stamp}.json`), {
    tenantId,
    scenarioId: scenario.id,
    capabilityId: scenario.capabilityId,
    validators: Array.isArray(scenario.validators) ? scenario.validators : [],
    governanceRules: Array.isArray(scenario.governanceRules) ? scenario.governanceRules : [],
    replayRequirements: scenario.replayRequirements || {},
    generatedAt: new Date().toISOString(),
  });

  writeJson(path.join(generatedUiStepsDir, `${stamp}.json`), {
    tenantId,
    scenarioId: scenario.id,
    capabilityId: scenario.capabilityId,
    journeyId: scenario.journeyId || scenario.journey || null,
    uiSteps: Array.isArray(scenario.steps) ? scenario.steps : [],
    generatedAt: new Date().toISOString(),
  });
}

/**
 * Gera scenarios para conjunto de capabilities com gaps
 * Típico uso: quando gapDetectionEngine detecta capabilities sem replay/e2e
 */
function generateScenariosForGaps(gappedCapabilities = [], frontendData = {}, options = {}) {
  const generated = [];
  const persist = options.persist !== false;
  const tenantId = normalizeTenantKey(options.tenantId, { defaultValue: 'system' });

  // Filtrar capabilities que já têm scenarios
  const store = loadScenarioStore();
  const existingCapIds = new Set(
    (store.scenarios || [])
      .filter((scenario) => belongsToTenant(scenario, tenantId))
      .map((scenario) => scenario.capabilityId),
  );

  for (const capability of gappedCapabilities) {
    if (existingCapIds.has(capability.id)) {
      logger.debug(`[AutoScenarioGenerator] Scenario já existe para ${capability.id}`);
      continue;
    }

    const scenarios = generateAllScenariosForCapability(capability, frontendData, { tenantId });
    generated.push(...scenarios);
  }

  // Persistir se necessário
  if (persist && generated.length > 0) {
    const store = loadScenarioStore();
    store.scenarios.push(...generated);

    const knownJourneys = new Set(
      (store.journeys || [])
        .filter((journey) => belongsToTenant(journey, tenantId))
        .map((journey) => journey.id),
    );
    for (const scenario of generated) {
      const journeyId = scenario.journeyId || scenario.journey;
      if (!journeyId || knownJourneys.has(journeyId)) continue;
      store.journeys = Array.isArray(store.journeys) ? store.journeys : [];
      store.journeys.push({
        id: journeyId,
        tenantId,
        source: 'autonomous-gap-closure',
        generatedAt: new Date().toISOString(),
      });
      knownJourneys.add(journeyId);
    }

    persistScenarioStore(store);
    for (const scenario of generated) {
      persistGeneratedArtifacts(scenario, { tenantId });
    }
  }

  return generated;
}

/**
 * Valida se scenario gerado é executável
 */
function validateGeneratedScenario(scenario = {}) {
  const errors = [];

  if (!scenario.id) errors.push('scenario id obrigatório');
  if (!scenario.steps || scenario.steps.length === 0) errors.push('steps obrigatório (não-vazio)');
  if (!scenario.validators || scenario.validators.length === 0) errors.push('validators obrigatório');

  // Validar steps
  for (const step of scenario.steps || []) {
    if (!step.type) errors.push(`step sem type`);
    if (!step.selector && step.type !== 'screenshot') errors.push(`step ${step.type} sem selector`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Retorna resumo de scenarios gerados
 */
function summarizeGeneratedScenarios(scenarios = []) {
  const byType = {};
  for (const scenario of scenarios) {
    const type = scenario.seedType || 'unknown';
    byType[type] = (byType[type] || 0) + 1;
  }

  return {
    totalGenerated: scenarios.length,
    byType,
    withSteps: scenarios.filter((s) => s.steps && s.steps.length > 0).length,
    withValidators: scenarios.filter((s) => s.validators && s.validators.length > 0).length,
  };
}

module.exports = {
  generateScenarioForCapability,
  generateAllScenariosForCapability,
  generateScenariosForGaps,
  validateGeneratedScenario,
  summarizeGeneratedScenarios,
  loadScenarioStore,
  persistScenarioStore,
  persistGeneratedArtifacts,
};
