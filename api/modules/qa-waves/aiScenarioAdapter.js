'use strict';

const {
  ALLOWED_STEP_TYPES,
  FORBIDDEN_STEP_TYPES,
  ALLOWED_ADAPTERS,
  ALLOWED_CHANNELS,
} = require('./waveScenario.constants');
const { validateScenarioCompatibility } = require('./waveScenarioSchema');

const STEP_DEFAULT_ADAPTER = {
  validate_intent: 'aiIntentService',
  validate_response: 'semanticValidator',
  check_availability: 'schedulingService',
  select_slot: 'schedulingService',
  create_booking: 'schedulingService',
  create_payment: 'paymentService',
  validate_backend: 'api',
  validate_sla: 'meshValidator',
  validate_context: 'ragService',
  validate_flow_transition: 'flowEngine',
  validate_access_release: 'accessControlService',
  wait_for_event: 'eventMesh',
  trigger_channel_event: 'api',
};

function toSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'scenario';
}

function normalizeStep(step, index, channels) {
  const channel = ALLOWED_CHANNELS.includes(step?.channel) ? step.channel : channels[0] || 'api';
  const type = String(step?.type || 'validate_response');

  const adapter = (() => {
    if (step?.adapter && ALLOWED_ADAPTERS.includes(step.adapter)) return step.adapter;
    if (type === 'send_message' || type === 'provide_data' || type === 'trigger_channel_event') return channel;
    return STEP_DEFAULT_ADAPTER[type] || 'api';
  })();

  return {
    id: step?.id || `step_${String(index + 1).padStart(3, '0')}`,
    order: index + 1,
    type,
    name: step?.name || null,
    description: step?.description || null,
    adapter,
    channel,
    input: step?.input || undefined,
    expected: step?.expected || undefined,
    data: step?.data || undefined,
    timeoutMs: Number.isFinite(Number(step?.timeoutMs)) ? Number(step.timeoutMs) : 15000,
    enabled: step?.enabled !== false,
  };
}

function enrichDefaults(scenarioInput, context = {}) {
  const now = new Date().toISOString();
  const vertical = String(scenarioInput.vertical || context.vertical || 'core').toLowerCase();
  const journey = String(scenarioInput.journey || context.journey || 'default_journey').toLowerCase();
  const channels = Array.isArray(scenarioInput.channels) && scenarioInput.channels.length > 0
    ? scenarioInput.channels.filter((channel) => ALLOWED_CHANNELS.includes(channel))
    : ['api'];

  const id = scenarioInput.id || toSlug(`${vertical}_${journey}_${scenarioInput.name || context.goal || 'scenario'}`);

  const normalizedSteps = (scenarioInput.steps || []).map((step, index) => normalizeStep(step, index, channels));

  return {
    id,
    waveId: scenarioInput.waveId || `${vertical}-${journey}`,
    vertical,
    journey,
    name: scenarioInput.name || context.goal || 'Cenario inferido por IA',
    description: scenarioInput.description || `Cenario semantico para ${vertical}/${journey}`,
    source: scenarioInput.source || 'ai_inferred',
    status: scenarioInput.status || 'draft',
    version: scenarioInput.version || 'v1',
    channels,
    risk: scenarioInput.risk || 'medium',
    priority: scenarioInput.priority || 'medium',
    preconditions: Array.isArray(scenarioInput.preconditions) ? scenarioInput.preconditions : [],
    steps: normalizedSteps,
    seeds: Array.isArray(scenarioInput.seeds) ? scenarioInput.seeds : [],
    validations: {
      slaMs: Number.isFinite(Number(scenarioInput.validations?.slaMs)) ? Number(scenarioInput.validations.slaMs) : 15000,
      requireBackendValidation: scenarioInput.validations?.requireBackendValidation !== false,
      requireReplay: scenarioInput.validations?.requireReplay !== false,
      ...(scenarioInput.validations || {}),
    },
    tags: {
      vertical,
      journey,
      source: scenarioInput.source || 'ai_inferred',
      ...(scenarioInput.tags || {}),
    },
    platform: {
      platformScenarioIds: Array.isArray(scenarioInput?.platform?.platformScenarioIds)
        ? scenarioInput.platform.platformScenarioIds.filter(Boolean)
        : [],
      ...(scenarioInput.platform || {}),
    },
    createdAt: scenarioInput.createdAt || now,
    updatedAt: now,
  };
}

function validateAllowedStepTypes(scenario) {
  const errors = [];
  for (const step of scenario.steps || []) {
    if (!ALLOWED_STEP_TYPES.includes(step.type)) {
      errors.push({ code: 'invalid_step_type', stepId: step.id, message: `Step type nao permitido: ${step.type}` });
    }
    if (FORBIDDEN_STEP_TYPES.includes(step.type)) {
      errors.push({ code: 'forbidden_step_type', stepId: step.id, message: `Step type proibido: ${step.type}` });
    }
  }
  return errors;
}

function mapAdapters(scenario) {
  const mapped = { ...scenario, steps: [...(scenario.steps || [])] };
  mapped.steps = mapped.steps.map((step) => {
    const cloned = { ...step };
    if (!ALLOWED_ADAPTERS.includes(cloned.adapter)) {
      if (cloned.type === 'send_message' || cloned.type === 'provide_data' || cloned.type === 'trigger_channel_event') {
        cloned.adapter = cloned.channel || scenario.channels?.[0] || 'api';
      } else {
        cloned.adapter = STEP_DEFAULT_ADAPTER[cloned.type] || 'api';
      }
    }
    return cloned;
  });
  return mapped;
}

function normalizeAiOutput(aiOutput, context = {}) {
  if (!aiOutput || typeof aiOutput !== 'object') {
    return enrichDefaults({
      id: toSlug(`${context.vertical || 'core'}_${context.journey || 'default'}_${context.goal || 'scenario'}`),
      name: context.goal || 'Cenario inferido por IA',
      vertical: context.vertical,
      journey: context.journey,
      channels: context.channels,
      steps: [],
    }, context);
  }
  return enrichDefaults(aiOutput, context);
}

function validatePlatformCompatibility(scenario) {
  return validateScenarioCompatibility(scenario);
}

function adaptAiScenario(aiOutput, context = {}) {
  const normalized = normalizeAiOutput(aiOutput, context);
  const stepTypeErrors = validateAllowedStepTypes(normalized);
  const mapped = mapAdapters(normalized);
  const validation = validatePlatformCompatibility(mapped);

  const errors = [...stepTypeErrors, ...(validation.errors || [])];
  return {
    scenario: mapped,
    validation: {
      valid: errors.length === 0,
      errors,
      warnings: validation.warnings || [],
    },
  };
}

module.exports = {
  adaptAiScenario,
  normalizeAiOutput,
  mapAdapters,
  validateAllowedStepTypes,
  validatePlatformCompatibility,
  enrichDefaults,
};
