/**
 * Canonical process model contracts.
 * This is the single source of truth for canonical process typing.
 */

export const CANONICAL_NODE_TYPES = Object.freeze({
  START: 'start',
  END: 'end',
  TASK_SERVICE: 'task.service',
  TASK_AI: 'task.ai',
  TASK_SCRIPT: 'task.script',
  TASK_USER: 'task.user',
  TASK_MESSAGE_SEND: 'task.message.send',
  TASK_MESSAGE_RECEIVE: 'task.message.receive',
  GATEWAY_EXCLUSIVE: 'gateway.exclusive',
  WAIT_TIMER: 'wait.timer',
  CALL_SUBPROCESS: 'call.subprocess',
  FALLBACK: 'fallback',
  VARIABLE_SET: 'variable.set',
  UTILITY_TRANSFORM: 'utility.transform',
  UTILITY_TIME: 'utility.time',
  UTILITY_UUID: 'utility.uuid',
  UTILITY_RANDOM: 'utility.random',
});

export const TERMINAL_NODE_TYPES = new Set([
  CANONICAL_NODE_TYPES.END,
  CANONICAL_NODE_TYPES.FALLBACK,
]);

export const CANONICAL_NODE_TYPE_SET = new Set(Object.values(CANONICAL_NODE_TYPES));

export const ISSUE_SEVERITY = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning',
  SUGGESTION: 'suggestion',
});

export function isCanonicalNodeType(type) {
  return CANONICAL_NODE_TYPE_SET.has(String(type || '').trim());
}

export function createCanonicalIssue({
  code,
  message,
  severity = ISSUE_SEVERITY.ERROR,
  nodeIds = [],
  details = {},
}) {
  return {
    code: String(code || 'canonical_issue').trim(),
    message: String(message || 'Canonical issue').trim(),
    severity,
    nodeIds: Array.isArray(nodeIds) ? nodeIds.filter(Boolean).map((id) => String(id)) : [],
    details: details && typeof details === 'object' ? details : {},
  };
}

export function createCanonicalValidationReport() {
  return {
    valid: true,
    errors: [],
    warnings: [],
    suggestions: [],
    summary: {
      errorCount: 0,
      warningCount: 0,
      suggestionCount: 0,
    },
  };
}
