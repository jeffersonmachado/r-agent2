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
    url: runtimeStep?.url || runtimeStep?.page || runtimeStep?.route || runtimeStep?.path || runtimeStep?.input?.url || null,
    payload,
    apiResponse,
    domSnapshot: runtimeStep?.domSnapshot || null,
    networkEvents,
    consoleErrors,
    selectorUsed: runtimeStep?.selectorUsed || runtimeStep?.selector || scenarioStep?.selector || null,
    evidenceId: runtimeStep?.evidenceId || null,
    mutationLinkage: runtimeStep?.mutationLinkage || null,
    stepResult: runtimeStep?.stepResult || null,
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

/**
 * Passo CLIENT_ACTION é dirigido por UI quando declara expectativa de
 * interface (page/toast/modal) em vez de mensagem de canal. Nesse caso a
 * evidência obrigatória é o rastro de UI (url/seletor/screenshot), não um
 * payload de canal que a jornada nunca produziria.
 */
function isUiDrivenClientAction(expected) {
  if (!expected || typeof expected !== 'object') return false;
  return Boolean(expected.page || expected.toast || expected.modal);
}

function validateMandatoryEvidence(evidence, category, expected) {
  const missing = [];
  const required = requiredEvidenceKeysByCategory(category);

  if (required.includes('screenshotBefore') && !evidence.screenshotBefore) missing.push('screenshotBefore');
  if (required.includes('screenshotAfter') && !evidence.screenshotAfter) missing.push('screenshotAfter');
  if (required.includes('payload') && evidence.payload == null) {
    const uiEvidencePresent = Boolean(evidence.url || evidence.selectorUsed || evidence.screenshotBefore);
    if (!(isUiDrivenClientAction(expected) && uiEvidencePresent)) {
      missing.push('payload');
    }
  }
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
  if (!context.runtimeSteps[context.index]) {
    return {
      status: 'failed',
      actual: null,
      error: 'missing_runtime_validation_evidence',
      fallback: true,
    };
  }
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

/**
 * Normaliza um step operacional preservando TODOS os artefatos da proof chain.
 *
 * NÃO descarta: stepExecutionProof, postStateProof, proofChain, mutationLinkage,
 * networkProof, snapshotDiff, sideEffectLinkage, observedMutations,
 * observedSideEffects, proofBlockers, proofGoNoGo, scopedMutations.
 *
 * Esta função é o ponto único de normalização de steps — qualquer pipeline
 * que produza steps deve chamar esta função para garantir preservação da proof chain.
 *
 * @param {object} scenarioStep - step semântico do cenário
 * @param {object} runtimeStep  - step executado em runtime (com artefatos de prova)
 * @param {number} index        - índice 0-based do step
 * @param {object[]} runtimeSteps - todos os runtime steps (para executeByCategory)
 * @returns {object} step normalizado com proof chain preservada
 */
function normalizeReplayOperationalStep(scenarioStep = {}, runtimeStep = {}, index = 0, runtimeSteps = []) {
  const category = normalizeCategory(scenarioStep);
  const actor = normalizeActor(scenarioStep, category);

  const executionResult = executeByCategory(category, scenarioStep, {
    index,
    runtimeSteps: runtimeSteps.length > 0 ? runtimeSteps : [runtimeStep],
  });

  const evidence = ensureEvidence(scenarioStep, runtimeStep, scenarioStep);
  const missingEvidence = validateMandatoryEvidence(evidence, category, scenarioStep?.expected);
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

  return {
    id: scenarioStep.id || `step_${String(index + 1).padStart(3, '0')}`,
    index: index + 1,
    order: index + 1,
    type: scenarioStep.type || null,
    category,
    actor,
    name: scenarioStep.name || `Step ${index + 1}`,
    description: scenarioStep.description || null,
    status: stepStatus,
    actionType: runtimeStep?.actionType || runtimeStep?.action || scenarioStep?.type || null,
    url: runtimeStep?.url || runtimeStep?.page || runtimeStep?.route || runtimeStep?.path || runtimeStep?.input?.url || null,
    selectorUsed: runtimeStep?.selectorUsed || runtimeStep?.selector || scenarioStep?.selector || null,
    expected: scenarioStep.expected || null,
    actual: executionResult.actual,
    startedAt,
    finishedAt,
    timestamp: startedAt,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0,
    evidenceId: runtimeStep?.evidenceId || null,
    stepResult: runtimeStep?.stepResult || null,
    mutationLinkage: runtimeStep?.mutationLinkage || null,
    evidence,
    error: executionResult.error || null,
    // ── PROOF CHAIN PRESERVADA ──────────────────────────────────────────────
    // Estes campos NUNCA devem ser descartados durante normalização.
    // Representam a cadeia de prova operacional completa do step.
    stepExecutionProof: runtimeStep?.stepExecutionProof || null,
    postStateProof: runtimeStep?.postStateProof || null,
    proofChain: runtimeStep?.proofChain || null,
    networkProof: runtimeStep?.networkProof || runtimeStep?.stepExecutionProof?.networkProof || null,
    snapshotDiff: runtimeStep?.snapshotDiff || null,
    beforeStepSnapshot: runtimeStep?.beforeStepSnapshot || null,
    afterStepSnapshot: runtimeStep?.afterStepSnapshot || null,
    incrementalDiff: runtimeStep?.incrementalDiff || null,
    mutationExpected: runtimeStep?.mutationExpected === true,
    sideEffectLinkage: runtimeStep?.sideEffectLinkage || null,
    observedMutations: runtimeStep?.observedMutations || [],
    observedSideEffects: runtimeStep?.observedSideEffects || [],
    proofBlockers: runtimeStep?.proofBlockers || [],
    proofGoNoGo: runtimeStep?.proofGoNoGo || null,
    scopedMutations: runtimeStep?.scopedMutations || null,
    // Usado internamente para geração de erro no executeScenario
    _executionFallback: executionResult.fallback || false,
  };
}

function executeScenario({ semanticSteps = [], runtimeSteps = [] } = {}) {
  const steps = [];
  const errors = [];

  for (let index = 0; index < semanticSteps.length; index += 1) {
    const scenarioStep = semanticSteps[index] || {};
    const runtimeStep = runtimeSteps[index] || {};

    // normalizeReplayOperationalStep é o ponto único de normalização:
    // preserva toda a proof chain (stepExecutionProof, postStateProof,
    // proofChain, snapshotDiff, mutationLinkage, sideEffectLinkage, etc.)
    const normalizedStep = normalizeReplayOperationalStep(scenarioStep, runtimeStep, index, runtimeSteps);

    // Derivar condições de erro a partir dos campos do step normalizado
    const missingEvidence = validateMandatoryEvidence(normalizedStep.evidence, normalizedStep.category, normalizedStep.expected);
    const apiValidation = evaluateApiResponse(normalizedStep.evidence);
    const criticalConsole = hasCriticalConsoleError(normalizedStep.evidence.consoleErrors);

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
        code: normalizedStep._executionFallback ? 'passed_via_fallback_blocked' : 'step_execution_error',
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
  normalizeReplayOperationalStep,
};
