const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const uiStepInference = require('./uiStepInferenceService');
const validatorInference = require('./validatorInferenceService');
const seedInference = require('./seedInferenceService');

const SCENARIOS_STORE_PATH = path.join(__dirname, '../../../qa/qa-waves/scenario-store.json');
const GENERATED_BASE_DIR = path.join(__dirname, '../../../qa/qa-waves');
const GENERATED_SEEDS_DIR = path.join(GENERATED_BASE_DIR, 'generated-seeds');
const GENERATED_VALIDATORS_DIR = path.join(GENERATED_BASE_DIR, 'generated-validators');
const GENERATED_UI_STEPS_DIR = path.join(GENERATED_BASE_DIR, 'generated-ui-steps');

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
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
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
    fs.writeFileSync(SCENARIOS_STORE_PATH, JSON.stringify(store, null, 2));
    logger.info(`[AutoScenarioGenerator] Scenario store persistido com sucesso`);
  } catch (err) {
    logger.error(`[AutoScenarioGenerator] Falha ao persistir scenario-store: ${err.message}`);
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
function generateAllScenariosForCapability(capability = {}, frontendData = {}) {
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
      const scenario = generateScenarioForCapability(capability, seedType, frontendData);
      scenarios.push(scenario);
    } catch (err) {
      logger.warn(
        `[AutoScenarioGenerator] Falha ao gerar ${seedType} para ${capability.id}: ${err.message}`
      );
    }
  }

  return scenarios;
}

function persistGeneratedArtifacts(scenario = {}) {
  if (!scenario || !scenario.id) return;

  const stamp = String(scenario.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  writeJson(path.join(GENERATED_SEEDS_DIR, `${stamp}.json`), {
    scenarioId: scenario.id,
    capabilityId: scenario.capabilityId,
    journeyId: scenario.journeyId || scenario.journey || null,
    seedType: scenario.seedType || null,
    seed: scenario.seed || {},
    generatedAt: new Date().toISOString(),
  });

  writeJson(path.join(GENERATED_VALIDATORS_DIR, `${stamp}.json`), {
    scenarioId: scenario.id,
    capabilityId: scenario.capabilityId,
    validators: Array.isArray(scenario.validators) ? scenario.validators : [],
    governanceRules: Array.isArray(scenario.governanceRules) ? scenario.governanceRules : [],
    replayRequirements: scenario.replayRequirements || {},
    generatedAt: new Date().toISOString(),
  });

  writeJson(path.join(GENERATED_UI_STEPS_DIR, `${stamp}.json`), {
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

  // Filtrar capabilities que já têm scenarios
  const store = loadScenarioStore();
  const existingCapIds = new Set(store.scenarios.map((s) => s.capabilityId));

  for (const capability of gappedCapabilities) {
    if (existingCapIds.has(capability.id)) {
      logger.debug(`[AutoScenarioGenerator] Scenario já existe para ${capability.id}`);
      continue;
    }

    const scenarios = generateAllScenariosForCapability(capability, frontendData);
    generated.push(...scenarios);
  }

  // Persistir se necessário
  if (persist && generated.length > 0) {
    const store = loadScenarioStore();
    store.scenarios.push(...generated);

    const knownJourneys = new Set((store.journeys || []).map((journey) => journey.id));
    for (const scenario of generated) {
      const journeyId = scenario.journeyId || scenario.journey;
      if (!journeyId || knownJourneys.has(journeyId)) continue;
      store.journeys = Array.isArray(store.journeys) ? store.journeys : [];
      store.journeys.push({
        id: journeyId,
        source: 'autonomous-gap-closure',
        generatedAt: new Date().toISOString(),
      });
      knownJourneys.add(journeyId);
    }

    persistScenarioStore(store);
    for (const scenario of generated) {
      persistGeneratedArtifacts(scenario);
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
