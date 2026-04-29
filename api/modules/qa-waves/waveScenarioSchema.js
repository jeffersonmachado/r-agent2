'use strict';

const {
  ALLOWED_STEP_TYPES,
  FORBIDDEN_STEP_TYPES,
  ALLOWED_ADAPTERS,
  ALLOWED_CHANNELS,
  ALLOWED_SCENARIO_SOURCES,
  ALLOWED_SCENARIO_STATUS,
  ALLOWED_SEED_SOURCES,
  ALLOWED_RISK_PRIORITY,
  KNOWN_BACKEND_ENTITIES,
} = require('./waveScenario.constants');

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasAtLeastOneValidation(scenario) {
  const hasScenarioValidation = isRecord(scenario.validations)
    && Object.keys(scenario.validations).length > 0;
  const hasValidationStep = (scenario.steps || []).some((step) => String(step.type || '').startsWith('validate_'));
  return hasScenarioValidation || hasValidationStep;
}

function validateStep(step, scenario, index, errors, warnings) {
  if (!isRecord(step)) {
    errors.push({ code: 'invalid_step', message: `Step na posicao ${index} invalido` });
    return;
  }

  if (!ALLOWED_STEP_TYPES.includes(step.type)) {
    errors.push({ code: 'invalid_step_type', message: `Step type nao permitido: ${step.type}`, stepId: step.id });
  }

  if (FORBIDDEN_STEP_TYPES.includes(step.type)) {
    errors.push({ code: 'forbidden_step_type', message: `Step type proibido detectado: ${step.type}`, stepId: step.id });
  }

  if (!ALLOWED_ADAPTERS.includes(step.adapter)) {
    errors.push({ code: 'invalid_adapter', message: `Adapter nao suportado: ${step.adapter}`, stepId: step.id });
  }

  if (step.channel && !ALLOWED_CHANNELS.includes(step.channel)) {
    errors.push({ code: 'invalid_channel', message: `Canal nao suportado: ${step.channel}`, stepId: step.id });
  }

  if (step.channel && !(scenario.channels || []).includes(step.channel)) {
    warnings.push({ code: 'step_channel_not_declared', message: `Canal ${step.channel} do step ${step.id} nao esta declarado no cenario` });
  }

  const backendEntity = step.expected?.backendEntity || step.expected?.entity || step.expected?.backendEntityName;
  if (backendEntity && !KNOWN_BACKEND_ENTITIES.includes(String(backendEntity))) {
    errors.push({ code: 'unknown_backend_entity', message: `Entidade de backend desconhecida: ${backendEntity}`, stepId: step.id });
  }
}

function validateScenarioCompatibility(scenario) {
  const errors = [];
  const warnings = [];

  if (!isRecord(scenario)) {
    return {
      valid: false,
      errors: [{ code: 'invalid_payload', message: 'Scenario deve ser objeto' }],
      warnings,
    };
  }

  if (!scenario.id) errors.push({ code: 'required', field: 'id', message: 'id obrigatorio' });
  if (!scenario.waveId) errors.push({ code: 'required', field: 'waveId', message: 'waveId obrigatorio' });
  if (!scenario.vertical) errors.push({ code: 'required', field: 'vertical', message: 'vertical obrigatorio' });
  if (!scenario.journey) errors.push({ code: 'required', field: 'journey', message: 'journey obrigatorio' });

  if (!ALLOWED_SCENARIO_SOURCES.includes(scenario.source)) {
    errors.push({ code: 'invalid_source', field: 'source', message: `source invalido: ${scenario.source}` });
  }

  if (!ALLOWED_SCENARIO_STATUS.includes(scenario.status)) {
    errors.push({ code: 'invalid_status', field: 'status', message: `status invalido: ${scenario.status}` });
  }

  if (!ALLOWED_RISK_PRIORITY.includes(scenario.risk)) {
    errors.push({ code: 'invalid_risk', field: 'risk', message: `risk invalido: ${scenario.risk}` });
  }

  if (!ALLOWED_RISK_PRIORITY.includes(scenario.priority)) {
    errors.push({ code: 'invalid_priority', field: 'priority', message: `priority invalido: ${scenario.priority}` });
  }

  if (!Array.isArray(scenario.channels) || scenario.channels.length === 0) {
    errors.push({ code: 'required_channels', message: 'Scenario deve possuir ao menos um canal' });
  } else {
    const unsupportedChannels = scenario.channels.filter((channel) => !ALLOWED_CHANNELS.includes(channel));
    if (unsupportedChannels.length > 0) {
      errors.push({ code: 'invalid_channels', message: `Canal(is) nao suportado(s): ${unsupportedChannels.join(', ')}` });
    }
  }

  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
    errors.push({ code: 'required_steps', message: 'Scenario deve possuir ao menos um step executavel' });
  }

  const stepIds = new Set();
  let expectedOrder = 1;
  for (const [index, step] of (scenario.steps || []).entries()) {
    if (!step?.id) {
      errors.push({ code: 'missing_step_id', message: `Step na posicao ${index} sem id` });
    } else if (stepIds.has(step.id)) {
      errors.push({ code: 'duplicate_step_id', message: `Step id duplicado: ${step.id}` });
    } else {
      stepIds.add(step.id);
    }

    if (Number(step?.order) !== expectedOrder) {
      errors.push({ code: 'invalid_step_order', message: `Ordem inconsistente no step ${step?.id || index}. Esperado ${expectedOrder}` });
    }
    expectedOrder += 1;

    validateStep(step, scenario, index, errors, warnings);
  }

  const executableSteps = (scenario.steps || []).filter((step) => step && step.enabled !== false);
  if (executableSteps.length === 0) {
    errors.push({ code: 'no_executable_steps', message: 'Scenario deve possuir ao menos um step habilitado' });
  }

  if (!hasAtLeastOneValidation(scenario)) {
    errors.push({ code: 'missing_validation', message: 'Scenario deve possuir ao menos uma validacao' });
  }

  if (scenario.validations?.requireReplay === false) {
    warnings.push({ code: 'replay_disabled', message: 'Replay desabilitado; governanca recomenda replay obrigatorio' });
  }

  if (Array.isArray(scenario.seeds)) {
    for (const seed of scenario.seeds) {
      if (!ALLOWED_SEED_SOURCES.includes(seed?.source)) {
        errors.push({ code: 'invalid_seed_source', message: `Seed source invalido: ${seed?.source}`, seedId: seed?.id || null });
      }
      if (!ALLOWED_SCENARIO_STATUS.includes(seed?.status)) {
        errors.push({ code: 'invalid_seed_status', message: `Seed status invalido: ${seed?.status}`, seedId: seed?.id || null });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

module.exports = {
  validateScenarioCompatibility,
};
