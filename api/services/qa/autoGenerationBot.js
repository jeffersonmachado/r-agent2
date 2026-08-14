const logger = require('../../utils/logger');
const autoScenarioGenerator = require('./autoScenarioGenerator');
const uiStepInferenceService = require('./uiStepInferenceService');
const validatorInferenceService = require('./validatorInferenceService');
const seedInferenceService = require('./seedInferenceService');
const preflightEngine = require('./preflightEngine');
const { normalizeTenantKey } = require('../../../lib/rpaSecurity');

/**
 * AUTO-GENERATION BOT
 *
 * Aceita remediações sugeridas e executa:
 * 1. Geração de scenarios
 * 2. Geração de uiSteps
 * 3. Geração de validators
 * 4. Geração de seeds
 * 5. Preflight validation
 * 6. Persistência
 *
 * Retorna status completo com artefatos gerados
 */

/**
 * Executa geração automática de cenários para capabilities com gaps
 */
function executeScenarioGeneration(capabilities = [], frontendData = {}, options = {}) {
  const tenantId = normalizeTenantKey(options.tenantId, { defaultValue: 'system' });
  const results = {
    timestamp: new Date().toISOString(),
    tenantId,
    requested: capabilities.length,
    generated: 0,
    failed: 0,
    scenarios: [],
    errors: [],
  };

  for (const capability of capabilities) {
    try {
      const scenarios = autoScenarioGenerator.generateAllScenariosForCapability(
        capability,
        frontendData,
        { tenantId },
      );

      for (const scenario of scenarios) {
        const validation = autoScenarioGenerator.validateGeneratedScenario(scenario);
        if (validation.valid) {
          results.scenarios.push(scenario);
          results.generated++;
        } else {
          results.errors.push({
            scenario: scenario.id,
            reason: `invalid_scenario: ${validation.errors.join(', ')}`,
          });
          results.failed++;
        }
      }
    } catch (err) {
      logger.error(
        `[AutoGenerationBot] Erro ao gerar scenarios para ${capability.id}: ${err.message}`
      );
      results.errors.push({
        capability: capability.id,
        reason: err.message,
      });
      results.failed++;
    }
  }

  // Persistir scenarios
  if (results.scenarios.length > 0 && options.persist !== false) {
    try {
      const store = autoScenarioGenerator.loadScenarioStore();
      store.scenarios.push(...results.scenarios);
      autoScenarioGenerator.persistScenarioStore(store);
      results.persisted = true;
    } catch (err) {
      logger.error(`[AutoGenerationBot] Erro ao persistir scenarios: ${err.message}`);
      results.persistError = err.message;
    }
  }

  return results;
}

/**
 * Executa geração automática de uiSteps para capabilities
 */
function executeUIStepGeneration(capabilities = [], frontendData = {}, options = {}) {
  const tenantId = normalizeTenantKey(options.tenantId, { defaultValue: 'system' });
  const results = {
    timestamp: new Date().toISOString(),
    tenantId,
    requested: capabilities.length,
    generated: 0,
    stepsMap: {},
    coverage: {},
  };

  for (const capability of capabilities) {
    try {
      const steps = uiStepInferenceService.inferUIStepsForCapability(capability, frontendData);
      const coverage = uiStepInferenceService.validateUIStepsCoverage(steps);

      results.stepsMap[capability.id] = steps;
      results.coverage[capability.id] = coverage;

      if (steps.length > 0) {
        results.generated++;
      }
    } catch (err) {
      logger.warn(
        `[AutoGenerationBot] Erro ao gerar uiSteps para ${capability.id}: ${err.message}`
      );
    }
  }

  results.totalSteps = Object.values(results.stepsMap).reduce((sum, steps) => sum + steps.length, 0);
  return results;
}

/**
 * Executa geração automática de validators para capabilities
 */
function executeValidatorGeneration(capabilities = [], options = {}) {
  const tenantId = normalizeTenantKey(options.tenantId, { defaultValue: 'system' });
  const results = {
    timestamp: new Date().toISOString(),
    tenantId,
    requested: capabilities.length,
    generated: 0,
    validatorsMap: {},
    coverage: {},
  };

  for (const capability of capabilities) {
    try {
      const validators = validatorInferenceService.inferValidatorsForCapability(capability);
      const coverage = validatorInferenceService.validateValidatorsCoverage(capability, validators);
      const classified = validatorInferenceService.classifyValidatorsByCriticality(validators);

      results.validatorsMap[capability.id] = validators;
      results.coverage[capability.id] = {
        ...coverage,
        critical: classified.critical.length,
        important: classified.important.length,
        informational: classified.informational.length,
      };

      if (validators.length > 0) {
        results.generated++;
      }
    } catch (err) {
      logger.warn(
        `[AutoGenerationBot] Erro ao gerar validators para ${capability.id}: ${err.message}`
      );
    }
  }

  results.totalValidators = Object.values(results.validatorsMap).reduce(
    (sum, validators) => sum + validators.length,
    0
  );
  return results;
}

/**
 * Executa geração automática de seeds para capabilities
 */
function executeSeedGeneration(capabilities = [], options = {}) {
  const tenantId = normalizeTenantKey(options.tenantId, { defaultValue: 'system' });
  const results = {
    timestamp: new Date().toISOString(),
    tenantId,
    requested: capabilities.length,
    generated: 0,
    seedsMap: {},
    coverage: {},
  };

  for (const capability of capabilities) {
    try {
      const seeds = seedInferenceService.generateSeedsForCapability(capability);
      const classified = seedInferenceService.classifySeedsByPath(seeds);
      const prioritized = seedInferenceService.prioritizeSeeds(seeds);

      results.seedsMap[capability.id] = prioritized;
      results.coverage[capability.id] = {
        total: seeds.length,
        happyPath: classified.happy_path.length,
        edgeCases: classified.edge_cases.length,
        failurePaths: classified.failure_paths.length,
        stressPaths: classified.stress_paths.length,
      };

      if (seeds.length > 0) {
        results.generated++;
      }
    } catch (err) {
      logger.warn(
        `[AutoGenerationBot] Erro ao gerar seeds para ${capability.id}: ${err.message}`
      );
    }
  }

  results.totalSeeds = Object.values(results.seedsMap).reduce(
    (sum, seeds) => sum + seeds.length,
    0
  );
  return results;
}

/**
 * Valida preflight para capabilities antes de execução
 */
async function validatePreflightForCapabilities(capabilities = [], options = {}) {
  const tenantId = normalizeTenantKey(options.tenantId, { defaultValue: 'system' });
  const results = {
    timestamp: new Date().toISOString(),
    tenantId,
    requested: capabilities.length,
    validated: 0,
    blocker_free: 0,
    blockedCapabilities: [],
    preconditionsByCapability: {},
  };

  for (const capability of capabilities) {
    try {
      const journeyId = capability.name || capability.id;
      const validation = await preflightEngine.validateJourneyPreconditions(journeyId, {
        ...(options.context || {}),
        tenantId,
      });

      results.preconditionsByCapability[capability.id] = validation;
      results.validated++;

      if (validation.status === 'GO') {
        results.blocker_free++;
      } else {
        results.blockedCapabilities.push({
          capability: capability.id,
          missing: validation.missing,
        });
      }
    } catch (err) {
      logger.warn(
        `[AutoGenerationBot] Erro ao validar preflight para ${capability.id}: ${err.message}`
      );
    }
  }

  return results;
}

/**
 * Executa bot completo: geração de todos os artefatos
 */
async function executeFullGenerationBot(options = {}) {
  const {
    capabilities = [],
    frontendData = {},
    context = {},
    generateScenarios = true,
    generateUISteps = true,
    generateValidators = true,
    generateSeeds = true,
    validatePreflight = true,
    tenantId: tenantInput = 'system',
  } = options;
  const tenantId = normalizeTenantKey(tenantInput, { defaultValue: 'system' });

  const startTime = Date.now();
  const results = {
    timestamp: new Date().toISOString(),
    tenantId,
    duration: 0,
    status: 'in_progress',
    steps: {},
  };

  try {
    // 1. Validate preflight
    if (validatePreflight) {
      results.steps.preflight = await validatePreflightForCapabilities(capabilities, { context, tenantId });
    }

    // 2. Generate scenarios
    if (generateScenarios) {
      results.steps.scenarios = executeScenarioGeneration(capabilities, frontendData, {
        persist: true,
        tenantId,
      });
    }

    // 3. Generate UI steps
    if (generateUISteps) {
      results.steps.uiSteps = executeUIStepGeneration(capabilities, frontendData, { tenantId });
    }

    // 4. Generate validators
    if (generateValidators) {
      results.steps.validators = executeValidatorGeneration(capabilities, { tenantId });
    }

    // 5. Generate seeds
    if (generateSeeds) {
      results.steps.seeds = executeSeedGeneration(capabilities, { tenantId });
    }

    // Calcular estatísticas globais
    results.summary = {
      capabilitiesProcessed: capabilities.length,
      scenariosGenerated: results.steps.scenarios?.generated || 0,
      uiStepsGenerated: results.steps.uiSteps?.generated || 0,
      validatorsGenerated: results.steps.validators?.generated || 0,
      seedsGenerated: results.steps.seeds?.generated || 0,
      preflightBlockers: results.steps.preflight?.blockedCapabilities?.length || 0,
      totalSteps: results.steps.uiSteps?.totalSteps || 0,
      totalValidators: results.steps.validators?.totalValidators || 0,
      totalSeeds: results.steps.seeds?.totalSeeds || 0,
    };

    results.status = 'completed';
    results.duration = Date.now() - startTime;

    logger.info(`[AutoGenerationBot] Geração completa em ${results.duration}ms`);

    return results;
  } catch (err) {
    logger.error(`[AutoGenerationBot] Erro na execução: ${err.message}`);
    results.status = 'failed';
    results.error = err.message;
    results.duration = Date.now() - startTime;
    return results;
  }
}

/**
 * Gera artefatos a partir de remediações sugeridas
 * Versão simplificada que aceita a saída de autonomousGapClosureEngine
 */
function applyAutoRemediations(remediations = {}, capabilities = [], frontendData = {}, options = {}) {
  const tenantId = normalizeTenantKey(options.tenantId, { defaultValue: 'system' });
  const results = {
    timestamp: new Date().toISOString(),
    tenantId,
    appliedRemediations: [],
    generatedArtefacts: {
      scenarios: 0,
      uiSteps: 0,
      validators: 0,
      seeds: 0,
    },
    failedRemediations: [],
  };

  try {
    // 1. Apply scenario generation
    if (remediations.scenarios && remediations.scenarios.length > 0) {
      try {
        const store = autoScenarioGenerator.loadScenarioStore();
        const beforeCount = store.scenarios.length;
        const scopedScenarios = remediations.scenarios.map((scenario) => ({
          ...scenario,
          tenantId,
        }));
        store.scenarios.push(...scopedScenarios);
        autoScenarioGenerator.persistScenarioStore(store);

        results.generatedArtefacts.scenarios = store.scenarios.length - beforeCount;
        results.appliedRemediations.push('scenario_generation');
      } catch (err) {
        results.failedRemediations.push({
          remediation: 'scenario_generation',
          error: err.message,
        });
      }
    }

    // 2. Apply UI steps suggestions
    if (remediations.uiSteps && Object.keys(remediations.uiSteps.byCapability).length > 0) {
      results.generatedArtefacts.uiSteps = Object.keys(remediations.uiSteps.byCapability).length;
      results.appliedRemediations.push('ui_steps_inference');
    }

    // 3. Apply validators suggestions
    if (remediations.validators && Object.keys(remediations.validators.byCapability).length > 0) {
      results.generatedArtefacts.validators = Object.keys(remediations.validators.byCapability).length;
      results.appliedRemediations.push('validator_inference');
    }

    // 4. Apply seeds suggestions
    if (remediations.seeds && Object.keys(remediations.seeds.byCapability).length > 0) {
      results.generatedArtefacts.seeds = Object.keys(remediations.seeds.byCapability).length;
      results.appliedRemediations.push('seed_generation');
    }

    results.status = 'applied';
    return results;
  } catch (err) {
    logger.error(`[AutoGenerationBot] Erro ao aplicar remediações: ${err.message}`);
    results.status = 'failed';
    results.error = err.message;
    return results;
  }
}

module.exports = {
  executeScenarioGeneration,
  executeUIStepGeneration,
  executeValidatorGeneration,
  executeSeedGeneration,
  validatePreflightForCapabilities,
  executeFullGenerationBot,
  applyAutoRemediations,
};
