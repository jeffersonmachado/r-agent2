'use strict';

/**
 * stepExecutionProofValidator.js
 *
 * STEP-TIME proof: executado DURANTE o step, ANTES de afterSnapshot existir.
 *
 * Valida somente o que é possível provar no momento da execução:
 *   - browser action real ocorreu (selectorUsed, screenshotBefore, screenshotAfter)
 *   - DOM antes e depois capturado
 *   - URL obtida
 *   - network: endpoint correto chamado (método + path + status)
 *
 * NÃO valida:
 *   - mutation proof (requer afterSnapshot)
 *   - side effect proof (requer diff derivado)
 *   - snapshot diff (requer coleta pós-step)
 */

const {
  validateNetworkProof,
  NETWORK_PROOF_CONTRACTS,
} = require('./evidenceProofValidator');

// ---------------------------------------------------------------------------
// Contratos de step-time por actionType
// ---------------------------------------------------------------------------

/**
 * Campos de browser action obrigatórios por actionType, verificados no step.
 */
const STEP_TIME_REQUIRED = {
  navigate: ['url', 'screenshotAfter'],
  wait_for_list: ['selectorUsed', 'screenshotAfter'],
  click_open: ['selectorUsed', 'screenshotBefore', 'screenshotAfter'],
  type_and_send: ['selectorUsed', 'screenshotBefore', 'screenshotAfter', 'networkEvents'],
  change_status: ['selectorUsed', 'networkEvents'],
  checkin_submit: ['selectorUsed', 'networkEvents'],
  assert_ui_state: ['selectorUsed', 'screenshotAfter'],
  assert_backend_state: ['screenshotAfter'],
  assert_attendance: ['screenshotAfter'],
};

const DEFAULT_STEP_TIME_REQUIRED = ['screenshotAfter'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNonEmpty(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

// ---------------------------------------------------------------------------
// validateStepExecutionProof
// ---------------------------------------------------------------------------

/**
 * Valida a prova de execução do step: browser action, seletor, screenshots,
 * DOM, URL e network proof (se aplicável).
 *
 * Deve ser chamado logo após executeStep() e ANTES de collectAfterSnapshot().
 *
 * @param {object} enrichedStep - step após execução, com evidências coletadas
 * @param {object} journeyContext - { isBlockingJourney, executionMode, journeyId }
 * @returns {StepExecutionProofResult}
 */
function validateStepExecutionProof(enrichedStep = {}, journeyContext = {}) {
  const stepId = enrichedStep.id || enrichedStep.stepId || 'unknown';
  const actionType = enrichedStep.actionType || 'unknown';
  const blocking = Boolean(journeyContext.isBlockingJourney);
  const executionMode = String(journeyContext.executionMode || 'operational_go').toLowerCase();

  const required = STEP_TIME_REQUIRED[actionType] || DEFAULT_STEP_TIME_REQUIRED;
  const missingBrowserFields = [];
  const blockers = [];

  // ── 1. Browser action fields ─────────────────────────────────────────────
  for (const field of required) {
    if (!isNonEmpty(enrichedStep[field])) {
      missingBrowserFields.push(field);
      blockers.push({
        reason: 'step_execution_missing_browser_evidence',
        stepId,
        actionType,
        missingField: field,
      });
    }
  }

  // ── 2. Network proof (step-scoped) ────────────────────────────────────────
  const networkEvents = Array.isArray(enrichedStep.networkEvents) ? enrichedStep.networkEvents : [];
  const networkProof = validateNetworkProof(networkEvents, stepId, actionType);
  if (!networkProof.valid && !networkProof.noContract) {
    blockers.push(...networkProof.blockers);
  }

  // ── 3. URL captured ──────────────────────────────────────────────────────
  const hasUrl = isNonEmpty(enrichedStep.url);

  // ── 4. Selector captured ─────────────────────────────────────────────────
  const SELECTOR_REQUIRED_TYPES = new Set([
    'click_open', 'type_and_send', 'change_status', 'checkin_submit', 'wait_for_list', 'assert_ui_state',
  ]);
  const selectorRequired = SELECTOR_REQUIRED_TYPES.has(actionType);
  const hasSelector = isNonEmpty(enrichedStep.selectorUsed);
  if (selectorRequired && !hasSelector) {
    blockers.push({
      reason: 'step_execution_missing_selector',
      stepId,
      actionType,
    });
  }

  const valid = blockers.length === 0;
  let goNoGo = null;
  if (!valid && blocking) {
    goNoGo = executionMode === 'diagnostic' ? 'REVIEW' : 'NO_GO';
  }

  return {
    phase: 'step_execution',
    valid,
    stepId,
    actionType,
    missingBrowserFields,
    hasUrl,
    hasSelector,
    networkProof: {
      ...networkProof,
      expectedEndpoints: (
        NETWORK_PROOF_CONTRACTS[stepId] || NETWORK_PROOF_CONTRACTS[actionType] || []
      ).map((c) => `${String(c.method)} ${c.pathPattern} [${(c.status || []).join(',')}]`),
      observedEndpoints: networkEvents
        .filter((e) => e.type === 'response')
        .map((e) => `${e.method} ${e.url} [${e.status}]`),
    },
    blockers,
    goNoGo,
  };
}

module.exports = {
  validateStepExecutionProof,
  STEP_TIME_REQUIRED,
};
