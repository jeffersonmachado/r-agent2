const BUG_TYPES = Object.freeze({
  SELECTOR_BROKEN: 'SELECTOR_BROKEN',
  SELECTOR_DRIFT: 'SELECTOR_DRIFT',
  ELEMENT_NOT_VISIBLE: 'ELEMENT_NOT_VISIBLE',
  ELEMENT_DISABLED: 'ELEMENT_DISABLED',
  RENDER_TIMEOUT: 'RENDER_TIMEOUT',
  NETWORK_FAILURE: 'NETWORK_FAILURE',
  BACKEND_5XX: 'BACKEND_5XX',
  BACKEND_4XX: 'BACKEND_4XX',
  AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  PERMISSION_ERROR: 'PERMISSION_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  FLOW_LOGIC_ERROR: 'FLOW_LOGIC_ERROR',
  ASSERTION_MISMATCH: 'ASSERTION_MISMATCH',
  JAVASCRIPT_RUNTIME_ERROR: 'JAVASCRIPT_RUNTIME_ERROR',
  PAGE_CRASH: 'PAGE_CRASH',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
});

const BUG_NATURES = Object.freeze({
  BUG: 'BUG',
  INSTABILITY: 'INSTABILITY',
  INFRASTRUCTURE: 'INFRASTRUCTURE',
  AUTOMATION: 'AUTOMATION',
});

const FAILURE_OWNERSHIP = Object.freeze({
  APPLICATION: 'APPLICATION',
  AUTOMATION: 'AUTOMATION',
  INFRASTRUCTURE: 'INFRASTRUCTURE',
  UNCERTAIN: 'UNCERTAIN',
});

const typeDefaults = Object.freeze({
  [BUG_TYPES.SELECTOR_BROKEN]: {
    severity: 'HIGH',
    nature: BUG_NATURES.AUTOMATION,
    probableCause: 'selector no longer matches expected element',
    confidence: 0.86,
    recoverable: true,
    suggestedRecoveryStrategies: ['REPAIR_SELECTOR', 'WAIT_FOR_VISIBLE', 'SCROLL_INTO_VIEW'],
    suggestedPermanentFixes: ['replace brittle CSS selector with data-testid or aria selector'],
  },
  [BUG_TYPES.SELECTOR_DRIFT]: {
    severity: 'MEDIUM',
    nature: BUG_NATURES.AUTOMATION,
    probableCause: 'DOM changed but target element still exists with different attributes',
    confidence: 0.82,
    recoverable: true,
    suggestedRecoveryStrategies: ['REPAIR_SELECTOR', 'WAIT_AND_RETRY'],
    suggestedPermanentFixes: ['update selector strategy to stable attributes'],
  },
  [BUG_TYPES.ELEMENT_NOT_VISIBLE]: {
    severity: 'MEDIUM',
    nature: BUG_NATURES.INSTABILITY,
    probableCause: 'element exists but is hidden, offscreen, or delayed by render',
    confidence: 0.79,
    recoverable: true,
    suggestedRecoveryStrategies: ['WAIT_FOR_VISIBLE', 'SCROLL_INTO_VIEW', 'WAIT_AND_RETRY'],
    suggestedPermanentFixes: ['add explicit precondition wait before action'],
  },
  [BUG_TYPES.ELEMENT_DISABLED]: {
    severity: 'MEDIUM',
    nature: BUG_NATURES.BUG,
    probableCause: 'business state keeps the element disabled unexpectedly',
    confidence: 0.74,
    recoverable: true,
    suggestedRecoveryStrategies: ['WAIT_AND_RETRY', 'REPAIR_STEP'],
    suggestedPermanentFixes: ['fix functional preconditions before action step'],
  },
  [BUG_TYPES.RENDER_TIMEOUT]: {
    severity: 'MEDIUM',
    nature: BUG_NATURES.INSTABILITY,
    probableCause: 'slow render or delayed async workflow',
    confidence: 0.77,
    recoverable: true,
    suggestedRecoveryStrategies: ['WAIT_AND_RETRY', 'WAIT_FOR_NETWORK_IDLE', 'REFRESH_PAGE'],
    suggestedPermanentFixes: ['increase timeout for known expensive views'],
  },
  [BUG_TYPES.NETWORK_FAILURE]: {
    severity: 'HIGH',
    nature: BUG_NATURES.INFRASTRUCTURE,
    probableCause: 'network instability, DNS, or upstream outage',
    confidence: 0.9,
    recoverable: true,
    suggestedRecoveryStrategies: ['WAIT_FOR_NETWORK_IDLE', 'WAIT_AND_RETRY'],
    suggestedPermanentFixes: ['add network resilience and endpoint health checks'],
  },
  [BUG_TYPES.BACKEND_5XX]: {
    severity: 'CRITICAL',
    nature: BUG_NATURES.BUG,
    probableCause: 'server-side exception or dependency outage',
    confidence: 0.94,
    recoverable: true,
    suggestedRecoveryStrategies: ['WAIT_AND_RETRY', 'FAIL_FAST'],
    suggestedPermanentFixes: ['fix backend exception and add contract test'],
  },
  [BUG_TYPES.BACKEND_4XX]: {
    severity: 'HIGH',
    nature: BUG_NATURES.BUG,
    probableCause: 'invalid request payload or missing resource',
    confidence: 0.84,
    recoverable: false,
    suggestedRecoveryStrategies: ['FAIL_FAST'],
    suggestedPermanentFixes: ['fix request schema or route assumptions in flow'],
  },
  [BUG_TYPES.AUTH_SESSION_EXPIRED]: {
    severity: 'HIGH',
    nature: BUG_NATURES.INSTABILITY,
    probableCause: 'expired token or invalidated session',
    confidence: 0.91,
    recoverable: true,
    suggestedRecoveryStrategies: ['RELOGIN_AND_RESUME', 'WAIT_AND_RETRY'],
    suggestedPermanentFixes: ['refresh auth token before long workflows'],
  },
  [BUG_TYPES.PERMISSION_ERROR]: {
    severity: 'HIGH',
    nature: BUG_NATURES.BUG,
    probableCause: 'role mismatch or missing permission in account setup',
    confidence: 0.86,
    recoverable: false,
    suggestedRecoveryStrategies: ['FAIL_FAST'],
    suggestedPermanentFixes: ['align test role privileges with scenario requirements'],
  },
  [BUG_TYPES.VALIDATION_ERROR]: {
    severity: 'MEDIUM',
    nature: BUG_NATURES.BUG,
    probableCause: 'input payload or form value is invalid for current validation rules',
    confidence: 0.79,
    recoverable: true,
    suggestedRecoveryStrategies: ['REPAIR_STEP', 'WAIT_AND_RETRY'],
    suggestedPermanentFixes: ['update test data generator and validation expectations'],
  },
  [BUG_TYPES.FLOW_LOGIC_ERROR]: {
    severity: 'HIGH',
    nature: BUG_NATURES.BUG,
    probableCause: 'functional flow diverged from expected business path',
    confidence: 0.73,
    recoverable: false,
    suggestedRecoveryStrategies: ['FAIL_FAST'],
    suggestedPermanentFixes: ['review flow transitions and expected states'],
  },
  [BUG_TYPES.ASSERTION_MISMATCH]: {
    severity: 'MEDIUM',
    nature: BUG_NATURES.AUTOMATION,
    probableCause: 'assertion became stale after UI or content updates',
    confidence: 0.83,
    recoverable: true,
    suggestedRecoveryStrategies: ['REPAIR_STEP', 'WAIT_AND_RETRY'],
    suggestedPermanentFixes: ['update assertion to stable domain signal'],
  },
  [BUG_TYPES.JAVASCRIPT_RUNTIME_ERROR]: {
    severity: 'CRITICAL',
    nature: BUG_NATURES.BUG,
    probableCause: 'frontend runtime exception prevented normal interaction',
    confidence: 0.93,
    recoverable: false,
    suggestedRecoveryStrategies: ['FAIL_FAST'],
    suggestedPermanentFixes: ['fix runtime exception and add regression test'],
  },
  [BUG_TYPES.PAGE_CRASH]: {
    severity: 'CRITICAL',
    nature: BUG_NATURES.INFRASTRUCTURE,
    probableCause: 'browser page crashed due to memory or rendering issue',
    confidence: 0.95,
    recoverable: true,
    suggestedRecoveryStrategies: ['REFRESH_PAGE', 'WAIT_AND_RETRY'],
    suggestedPermanentFixes: ['investigate browser crash dump and reduce page load pressure'],
  },
  [BUG_TYPES.UNKNOWN_ERROR]: {
    severity: 'HIGH',
    nature: BUG_NATURES.INSTABILITY,
    probableCause: 'unknown failure signature',
    confidence: 0.35,
    recoverable: true,
    suggestedRecoveryStrategies: ['WAIT_AND_RETRY', 'FAIL_FAST'],
    suggestedPermanentFixes: ['improve instrumentation for this error path'],
  },
});

function getMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return String(error.message || error.error || error.code || '');
}

function extractStatusCode(error, hints = {}) {
  const candidates = [
    error?.status,
    error?.statusCode,
    hints.status,
    hints.statusCode,
  ].filter((value) => Number.isFinite(Number(value)));

  if (candidates.length > 0) {
    return Number(candidates[0]);
  }

  const message = getMessage(error);
  const match = message.match(/\b(4\d\d|5\d\d)\b/);
  return match ? Number(match[1]) : null;
}

function classifyBySignals(message, action = {}, hints = {}) {
  const lower = message.toLowerCase();
  const statusCode = extractStatusCode(hints.error || {}, hints);
  const hasSelector = typeof action.selector === 'string' && action.selector.trim().length > 0;

  if (statusCode && statusCode >= 500) return BUG_TYPES.BACKEND_5XX;
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    if (statusCode === 401 || statusCode === 419) return BUG_TYPES.AUTH_SESSION_EXPIRED;
    if (statusCode === 403) return BUG_TYPES.PERMISSION_ERROR;
    return BUG_TYPES.BACKEND_4XX;
  }

  if (/session.*expired|token.*expired|unauthorized|login required/.test(lower)) {
    return BUG_TYPES.AUTH_SESSION_EXPIRED;
  }
  if (/forbidden|permission|not allowed|access denied/.test(lower)) {
    return BUG_TYPES.PERMISSION_ERROR;
  }
  if (/crash|target page.*closed|browser has been closed/.test(lower)) {
    return BUG_TYPES.PAGE_CRASH;
  }
  if (/referenceerror|typeerror|syntaxerror|javascript|pageerror/.test(lower)) {
    return BUG_TYPES.JAVASCRIPT_RUNTIME_ERROR;
  }
  if (/network|econn|dns|fetch failed|request failed|net::/i.test(lower)) {
    return BUG_TYPES.NETWORK_FAILURE;
  }
  if (/timeout|timed out|waiting for|navigation timeout/.test(lower)) {
    if (hasSelector) return BUG_TYPES.RENDER_TIMEOUT;
    return BUG_TYPES.NETWORK_FAILURE;
  }
  if (/not visible|element is not visible|intercepted/.test(lower)) {
    return BUG_TYPES.ELEMENT_NOT_VISIBLE;
  }
  if (/disabled|not enabled/.test(lower)) {
    return BUG_TYPES.ELEMENT_DISABLED;
  }
  if (/not found|no node found|failed to find|locator\(\).*resolved to 0/.test(lower)) {
    return hasSelector ? BUG_TYPES.SELECTOR_BROKEN : BUG_TYPES.UNKNOWN_ERROR;
  }
  if (/validation|invalid|required field|does not match/.test(lower)) {
    return BUG_TYPES.VALIDATION_ERROR;
  }
  if (/assert|expected .* but received|mismatch/.test(lower)) {
    return BUG_TYPES.ASSERTION_MISMATCH;
  }
  if (/unexpected route|wrong page|flow divergence|branch mismatch/.test(lower)) {
    return BUG_TYPES.FLOW_LOGIC_ERROR;
  }

  return BUG_TYPES.UNKNOWN_ERROR;
}

function classifyBug(input = {}) {
  const error = input.error || {};
  const action = input.action || {};
  const detected = input.detectedError || {};
  const message = getMessage(error) || getMessage(detected);
  const type = classifyBySignals(message, action, {
    status: input.status,
    statusCode: input.statusCode,
    error,
  });

  const defaults = typeDefaults[type] || typeDefaults[BUG_TYPES.UNKNOWN_ERROR];

  return {
    type,
    severity: defaults.severity,
    nature: defaults.nature,
    probableCause: defaults.probableCause,
    confidence: defaults.confidence,
    recoverable: defaults.recoverable,
    suggestedRecoveryStrategies: [...defaults.suggestedRecoveryStrategies],
    suggestedPermanentFixes: [...defaults.suggestedPermanentFixes],
  };
}

function determineFailureOwnership(classification = {}) {
  const type = classification.type || BUG_TYPES.UNKNOWN_ERROR;

  if (
    type === BUG_TYPES.JAVASCRIPT_RUNTIME_ERROR ||
    type === BUG_TYPES.BACKEND_5XX ||
    type === BUG_TYPES.BACKEND_4XX ||
    type === BUG_TYPES.PERMISSION_ERROR ||
    type === BUG_TYPES.VALIDATION_ERROR ||
    type === BUG_TYPES.FLOW_LOGIC_ERROR
  ) {
    return FAILURE_OWNERSHIP.APPLICATION;
  }

  if (
    type === BUG_TYPES.SELECTOR_BROKEN ||
    type === BUG_TYPES.SELECTOR_DRIFT ||
    type === BUG_TYPES.ASSERTION_MISMATCH
  ) {
    return FAILURE_OWNERSHIP.AUTOMATION;
  }

  if (
    type === BUG_TYPES.NETWORK_FAILURE ||
    type === BUG_TYPES.PAGE_CRASH ||
    type === BUG_TYPES.RENDER_TIMEOUT
  ) {
    return FAILURE_OWNERSHIP.INFRASTRUCTURE;
  }

  return FAILURE_OWNERSHIP.UNCERTAIN;
}

module.exports = {
  BUG_TYPES,
  BUG_NATURES,
  FAILURE_OWNERSHIP,
  classifyBug,
  determineFailureOwnership,
};
