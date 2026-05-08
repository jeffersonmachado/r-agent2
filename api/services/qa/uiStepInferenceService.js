const logger = require('../../utils/logger');
const dataTestIdValidationService = require('./dataTestIdValidationService');

/**
 * Infere uiSteps automaticamente a partir de elementos da UI
 * Mapeia data-testid + ações semânticas para Steps
 */

const ACTION_PATTERNS = {
  fill: {
    matchers: ['input', 'textarea', 'text-box', 'field', 'search'],
    actions: ['reply', 'type', 'enter', 'compose', 'write'],
  },
  click: {
    matchers: ['button', 'link', 'tab', 'menu', 'toggle', 'checkbox', 'radio'],
    actions: ['click', 'open', 'select', 'send', 'submit', 'confirm', 'accept', 'release', 'start'],
  },
  select: {
    matchers: ['dropdown', 'select', 'picker', 'choice'],
    actions: ['choose', 'select', 'set', 'pick'],
  },
  screenshot: {
    matchers: ['modal', 'dialog', 'page', 'form', 'status', 'result', 'confirmation'],
    actions: ['verify', 'check', 'validate', 'see', 'view', 'visible'],
  },
};

const SEMANTIC_ACTION_MAP = {
  'ticket-reply-input': { type: 'fill', semantic: 'enter_reply' },
  'ticket-send-button': { type: 'click', semantic: 'send_message' },
  'ticket-status-dropdown': { type: 'select', semantic: 'change_status' },
  'crm-contact-search': { type: 'fill', semantic: 'search_contact' },
  'contact-selection-submit': { type: 'click', semantic: 'confirm_contact' },
  'membership-select-plan': { type: 'select', semantic: 'select_plan' },
  'checkin-device': { type: 'click', semantic: 'scan_device' },
  'turnstile-release-button': { type: 'click', semantic: 'release_access' },
  'billing-charge-confirm': { type: 'click', semantic: 'process_payment' },
  'form-submit-button': { type: 'click', semantic: 'submit_form' },
  'form-cancel-button': { type: 'click', semantic: 'cancel_form' },
  'modal-close-button': { type: 'click', semantic: 'close_modal' },
};

/**
 * Detecta tipo de ação baseado em patterns
 */
function inferActionType(testId = '') {
  const lower = testId.toLowerCase();

  // Primeiro check: mapeamento semântico direto
  if (SEMANTIC_ACTION_MAP[testId]) {
    return SEMANTIC_ACTION_MAP[testId].type;
  }

  // Segundo check: pattern matching
  for (const [actionType, pattern] of Object.entries(ACTION_PATTERNS)) {
    const hasMatchingMatcher = pattern.matchers.some((m) => lower.includes(m));
    const hasMatchingAction = pattern.actions.some((a) => lower.includes(a));

    if (hasMatchingMatcher || hasMatchingAction) {
      return actionType;
    }
  }

  return 'click'; // default
}

/**
 * Infere steps a partir de capability + frontend discovery
 * @param {object} capability - capability inferida do discovery
 * @param {object} frontendData - dados do frontend scanner (pages, components, testIds)
 * @returns {array} steps
 */
function inferUIStepsForCapability(capability = {}, frontendData = {}) {
  const steps = [];

  // Regex patterns para match entre capability e UI elements
  const capabilityName = capability.name || capability.id || '';
  const testIds = frontendData.testIds || [];
  const dataTestIdScan = frontendData.dataTestIdScan || null;

  const validation = dataTestIdValidationService.validateCapabilityDataTestIds(
    capability,
    dataTestIdScan
  );

  if (validation.status === 'NO_GO') {
    logger.warn(
      `[UIStepInference] NO_GO para ${capability.id || capability.name}: ${validation.missing.join(', ')}`
    );
    return [];
  }

  // Filter test IDs relacionados à capability
  const relatedTestIds = testIds.filter((t) => {
    const lower = capabilityName.toLowerCase();
    const tLower = t.toLowerCase();
    // Match simples: se test-id contém palavra-chave da capability
    return tLower.includes(lower) || lower.split('_').some((word) => tLower.includes(word));
  });

  // Se encontrou test-ids, gerar steps
  if (relatedTestIds.length > 0) {
    for (const testId of relatedTestIds.slice(0, 10)) {
      const actionType = inferActionType(testId);
      const semantic = SEMANTIC_ACTION_MAP[testId]?.semantic || `action_${testId}`;

      steps.push({
        type: actionType,
        selector: `[data-testid='${testId}']`,
        semantic,
        testId,
        inferred: true,
      });
    }
  }

  if (steps.length === 0) {
    logger.warn(
      `[UIStepInference] Capability ${capabilityName} sem data-testid real mapeado. Selector fictício proibido.`
    );
  }

  return steps;
}

/**
 * Gera mapa de UI steps por capability
 * @param {array} capabilities - capabilities inferidas
 * @param {object} frontendData - frontend scanner output
 * @returns {object} { capabilityId: [steps] }
 */
function generateUIStepsMap(capabilities = [], frontendData = {}) {
  const map = {};

  for (const capability of capabilities) {
    const capId = capability.id || capability.name;
    map[capId] = inferUIStepsForCapability(capability, frontendData);
  }

  return map;
}

/**
 * Valida if UI steps cobrem capability
 */
function validateUIStepsCoverage(steps = []) {
  const hasClick = steps.some((s) => s.type === 'click');
  const hasScreenshot = steps.some((s) => s.type === 'screenshot');
  const hasFill = steps.some((s) => s.type === 'fill');

  return {
    covered: steps.length > 0,
    hasUserInteraction: hasClick || hasFill,
    hasVerification: hasScreenshot,
    stepCount: steps.length,
  };
}

module.exports = {
  inferUIStepsForCapability,
  generateUIStepsMap,
  validateUIStepsCoverage,
  inferActionType,
};
