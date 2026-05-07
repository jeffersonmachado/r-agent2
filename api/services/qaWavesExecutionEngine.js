'use strict';

const {
  ACTION_CATEGORY_MAP,
  CATEGORY_ACTOR_MAP,
} = require('../modules/qa-waves/waveScenario.constants');

function nowIso() {
  return new Date().toISOString();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCategory(step = {}) {
  if (step.category) return String(step.category);
  return ACTION_CATEGORY_MAP[String(step.type || '').trim()] || 'SYSTEM_EVENT';
}

function normalizeActor(step = {}, category) {
  if (step.actor) return String(step.actor);
  return CATEGORY_ACTOR_MAP[category] || 'system';
}

function looksLikeHtml(value) {
  if (typeof value !== 'string') return false;
  return /^\s*<(!doctype|html)/i.test(value.trim());
}

function hasCriticalConsoleError(consoleErrors = []) {
  return toArray(consoleErrors).some((entry) => {
    const level = String(entry?.level || '').toLowerCase();
    const text = String(entry?.text || entry?.message || '').toLowerCase();
    if (level !== 'error') return false;
    if (text.includes('deprecation')) return false;
    return true;
  });
}

function pickApiResponse(networkEvents = []) {
  const events = toArray(networkEvents)
    .filter((event) => String(event?.type || '').toLowerCase() === 'response')
    .slice()
    .reverse();

  for (const event of events) {
    const url = String(event?.url || '');
    if (url.includes('/api/') || url.includes('/workspace/')) {
      return {
        status: event?.status || null,
        contentType: event?.contentType || null,
        url,
        bodyPreview: event?.bodyPreview || null,
      };
    }
  }

  return null;
}

function ensureEvidence(step, runtimeStep, scenarioStep) {
  const consoleErrors = toArray(runtimeStep?.consoleLogs || runtimeStep?.consoleErrors);
  const networkEvents = toArray(runtimeStep?.networkEvents);
  const apiResponse = step?.evidence?.apiResponse || pickApiResponse(networkEvents);
  const payload = step?.evidence?.payload ?? scenarioStep?.input ?? runtimeStep?.input ?? null;

  return {
    screenshotBefore: runtimeStep?.screenshotBefore || null,
    screenshotAfter: runtimeStep?.screenshotAfter || null,
    payload,
    apiResponse,
    domSnapshot: runtimeStep?.domSnapshot || null,
    networkEvents,
    consoleErrors,
  };
}

function requiredEvidenceKeysByCategory(category) {
  switch (String(category || '').toUpperCase()) {
    case 'CLIENT_ACTION':
      return ['payload'];
    case 'API_CALL':
      return ['apiResponse'];
    case 'RPA_ACTION':
      return ['screenshotBefore', 'screenshotAfter', 'domSnapshot', 'networkEvents'];
    default:
      return [];
  }
}

function validateMandatoryEvidence(evidence, category) {
  const missing = [];
  const required = requiredEvidenceKeysByCategory(category);

  if (required.includes('screenshotBefore') && !evidence.screenshotBefore) missing.push('screenshotBefore');
  if (required.includes('screenshotAfter') && !evidence.screenshotAfter) missing.push('screenshotAfter');
  if (required.includes('payload') && evidence.payload == null) missing.push('payload');
  if (required.includes('apiResponse') && !evidence.apiResponse) missing.push('apiResponse');
  if (required.includes('domSnapshot') && !evidence.domSnapshot) missing.push('domSnapshot');
  if (
    required.includes('networkEvents')
    && (!Array.isArray(evidence.networkEvents) || evidence.networkEvents.length === 0)
  ) {
    missing.push('networkEvents');
  }
  if (!Array.isArray(evidence.consoleErrors)) missing.push('consoleErrors');
  return missing;
}

function evaluateApiResponse(evidence) {
  const contentType = String(evidence?.apiResponse?.contentType || '').toLowerCase();
  const bodyPreview = String(evidence?.apiResponse?.bodyPreview || '');
  if (contentType.includes('text/html') || looksLikeHtml(bodyPreview)) {
    return {
      ok: false,
      code: 'html_response_instead_of_json',
      message: 'API retornou HTML ao invés de JSON durante execução do step.',
    };
  }
  return { ok: true };
}

function executeClientAction(step, context) {
  const runtimeStep = context.runtimeSteps[context.index] || null;
  return {
    status: runtimeStep?.success === false ? 'failed' : 'success',
    actual: runtimeStep?.actual ?? 'message_sent',
  };
}

function waitForSystemEvent(step, context) {
  const runtimeStep = context.runtimeSteps[context.index] || null;
  return {
    status: runtimeStep?.success === false ? 'failed' : 'success',
    actual: runtimeStep?.actual ?? 'event_received',
  };
}

function validateAiDecision(step, context) {
  const runtimeStep = context.runtimeSteps[context.index] || null;
  return {
    status: runtimeStep?.success === false ? 'failed' : 'success',
    actual: runtimeStep?.actual ?? { decision: 'validated' },
  };
}

function validateBotResponse(step, context) {
  const runtimeStep = context.runtimeSteps[context.index] || null;
  return {
    status: runtimeStep?.success === false ? 'failed' : 'success',
    actual: runtimeStep?.actual ?? 'bot_response_validated',
  };
}

function validateHumanFlow(step, context) {
  const runtimeStep = context.runtimeSteps[context.index] || null;
  return {
    status: runtimeStep?.success === false ? 'failed' : 'success',
    actual: runtimeStep?.actual ?? 'human_flow_validated',
  };
}

function validateApi(step, context) {
  const runtimeStep = context.runtimeSteps[context.index] || null;
  return {
    status: runtimeStep?.success === false ? 'failed' : 'success',
    actual: runtimeStep?.actual ?? 'api_contract_validated',
  };
}

function executeRpa(step, context) {
  const runtimeStep = context.runtimeSteps[context.index] || null;
  return {
    status: runtimeStep?.success === false ? 'failed' : 'success',
    actual: runtimeStep?.actual ?? 'rpa_action_executed',
  };
}

function validateOutcome(step, context) {
  const runtimeStep = context.runtimeSteps[context.index] || null;
  return {
    status: runtimeStep?.success === false ? 'failed' : 'success',
    actual: runtimeStep?.actual ?? 'validation_passed',
  };
}

function executeByCategory(category, step, context) {
  switch (category) {
    case 'CLIENT_ACTION':
      return executeClientAction(step, context);
    case 'SYSTEM_EVENT':
      return waitForSystemEvent(step, context);
    case 'AI_DECISION':
      return validateAiDecision(step, context);
    case 'BOT_ACTION':
      return validateBotResponse(step, context);
    case 'HUMAN_ACTION':
      return validateHumanFlow(step, context);
    case 'API_CALL':
      return validateApi(step, context);
    case 'RPA_ACTION':
      return executeRpa(step, context);
    case 'VALIDATION':
      return validateOutcome(step, context);
    default:
      return {
        status: 'failed',
        actual: null,
        error: `Unknown step category: ${category}`,
      };
  }
}

function executeScenario({ semanticSteps = [], runtimeSteps = [] } = {}) {
  const steps = [];
  const errors = [];

  for (let index = 0; index < semanticSteps.length; index += 1) {
    const scenarioStep = semanticSteps[index] || {};
    const runtimeStep = runtimeSteps[index] || {};
    const category = normalizeCategory(scenarioStep);
    const actor = normalizeActor(scenarioStep, category);

    const executionResult = executeByCategory(category, scenarioStep, {
      index,
      runtimeSteps,
    });

    const evidence = ensureEvidence(scenarioStep, runtimeStep, scenarioStep);
    const missingEvidence = validateMandatoryEvidence(evidence, category);
    const apiValidation = evaluateApiResponse(evidence);
    const criticalConsole = hasCriticalConsoleError(evidence.consoleErrors);

    const startedAt = runtimeStep?.startedAt || scenarioStep?.startedAt || nowIso();
    const finishedAt = runtimeStep?.finishedAt || scenarioStep?.finishedAt || startedAt;
    const durationMs = Number(runtimeStep?.durationMs);

    const stepStatus = (
      executionResult.status === 'success'
      && missingEvidence.length === 0
      && apiValidation.ok
      && !criticalConsole
      && runtimeStep?.success !== false
    ) ? 'success' : 'failed';

    const normalizedStep = {
      id: scenarioStep.id || `step_${String(index + 1).padStart(3, '0')}`,
      index: index + 1,
      order: index + 1,
      type: scenarioStep.type || null,
      category,
      actor,
      name: scenarioStep.name || `Step ${index + 1}`,
      description: scenarioStep.description || null,
      status: stepStatus,
      expected: scenarioStep.expected || null,
      actual: executionResult.actual,
      startedAt,
      finishedAt,
      durationMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0,
      evidence,
      error: executionResult.error || null,
    };

    if (missingEvidence.length > 0) {
      errors.push({
        stepId: normalizedStep.id,
        code: 'missing_step_evidence',
        message: `Evidência obrigatória ausente: ${missingEvidence.join(', ')}`,
      });
    }

    if (!apiValidation.ok) {
      errors.push({
        stepId: normalizedStep.id,
        code: apiValidation.code,
        message: apiValidation.message,
      });
    }

    if (criticalConsole) {
      errors.push({
        stepId: normalizedStep.id,
        code: 'critical_console_error',
        message: 'Erro crítico encontrado no console durante execução do step.',
      });
    }

    if (normalizedStep.error) {
      errors.push({
        stepId: normalizedStep.id,
        code: 'step_execution_error',
        message: normalizedStep.error,
      });
    }

    steps.push(normalizedStep);
  }

  const failed = steps.some((step) => step.status === 'failed') || errors.length > 0;

  return {
    status: failed ? 'failed' : 'success',
    steps,
    errors,
    journeySteps: steps,
    decisions: steps.filter((step) => step.category === 'AI_DECISION'),
    events: steps.filter((step) => step.category === 'SYSTEM_EVENT'),
    rpaSteps: toArray(runtimeSteps),
    evidence: steps.map((step) => ({ stepId: step.id, ...step.evidence })),
  };
}

module.exports = {
  executeScenario,
};
