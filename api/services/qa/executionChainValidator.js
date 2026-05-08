const logger = require('../../utils/logger');

/**
 * Define chains operacionais válidas
 * Detecta se execução percorreu a cadeia completa
 */

const OPERATIONAL_CHAINS = {
  support_workflow: {
    name: 'Support Workflow',
    chain: [
      { step: 'authenticate_agent', module: 'auth' },
      { step: 'load_ticket', module: 'ticket' },
      { step: 'process_reply', module: 'ticket' },
      { step: 'update_status', module: 'ticket' },
      { step: 'notify_customer', module: 'notification' },
      { step: 'audit_log', module: 'audit' },
    ],
  },
  fitness_checkin_workflow: {
    name: 'Fitness Checkin Workflow',
    chain: [
      { step: 'authenticate_member', module: 'auth' },
      { step: 'verify_membership', module: 'membership' },
      { step: 'scan_device', module: 'device' },
      { step: 'record_attendance', module: 'attendance' },
      { step: 'log_access', module: 'audit' },
    ],
  },
  booking_workflow: {
    name: 'Booking Workflow',
    chain: [
      { step: 'search_availability', module: 'booking' },
      { step: 'select_slot', module: 'booking' },
      { step: 'validate_booking', module: 'booking' },
      { step: 'process_payment', module: 'billing' },
      { step: 'send_confirmation', module: 'notification' },
      { step: 'create_audit', module: 'audit' },
    ],
  },
  crm_workflow: {
    name: 'CRM Workflow',
    chain: [
      { step: 'search_contact', module: 'crm' },
      { step: 'create_or_update', module: 'crm' },
      { step: 'validate_fields', module: 'crm' },
      { step: 'persist_to_db', module: 'crm' },
      { step: 'log_activity', module: 'audit' },
    ],
  },
  access_control_workflow: {
    name: 'Access Control Workflow',
    chain: [
      { step: 'verify_identity', module: 'auth' },
      { step: 'check_permissions', module: 'access_control' },
      { step: 'make_decision', module: 'access_control' },
      { step: 'execute_action', module: 'device' },
      { step: 'log_access', module: 'audit' },
    ],
  },
};

/**
 * Mapeia capabilities para chains operacionais
 */
const CAPABILITY_TO_CHAIN = {
  'ticket-reply': 'support_workflow',
  'ticket-status-change': 'support_workflow',
  'ticket-escalation': 'support_workflow',
  'ticket-close': 'support_workflow',
  'checkin-scan': 'fitness_checkin_workflow',
  'checkin-biometric': 'fitness_checkin_workflow',
  'booking-search': 'booking_workflow',
  'booking-select': 'booking_workflow',
  'booking-confirm': 'booking_workflow',
  'contact-create': 'crm_workflow',
  'contact-update': 'crm_workflow',
  'contact-search': 'crm_workflow',
  'turnstile-release': 'access_control_workflow',
  'access-denied': 'access_control_workflow',
};

/**
 * Traça chain a partir de replay/execution trace
 * @param {object} executionTrace - trace do replay ou execução
 * @returns {array} módulos visitados em ordem
 */
function traceExecutionChain(executionTrace = {}) {
  const chain = [];

  if (!executionTrace.events) {
    return chain;
  }

  for (const event of executionTrace.events) {
    const module = extractModuleFromEvent(event);
    if (module && !chain.includes(module)) {
      chain.push(module);
    }
  }

  return chain;
}

/**
 * Extrai módulo de um evento de execução
 */
function extractModuleFromEvent(event = {}) {
  if (event.module) return event.module;
  if (event.service) return event.service;
  if (event.path) {
    const pathParts = event.path.split('/');
    if (pathParts[1]) return pathParts[1]; // /auth/login → 'auth'
  }
  return null;
}

/**
 * Valida se a cadeia executada corresponde à esperada
 * @param {string} chainName - nome do chain esperado
 * @param {array} executedChain - módulos que foram executados
 * @returns {object} validação completa
 */
function validateExecutionChain(chainName, executedChain = []) {
  const expectedChain = OPERATIONAL_CHAINS[chainName];

  if (!expectedChain) {
    return {
      valid: false,
      reason: `chain_unknown: ${chainName}`,
    };
  }

  const expectedModules = expectedChain.chain.map((s) => s.module);
  const missing = expectedModules.filter((m) => !executedChain.includes(m));
  const extra = executedChain.filter((m) => !expectedModules.includes(m));

  const isComplete = missing.length === 0;
  const isClean = extra.length === 0;
  const isSequenced = validateSequence(expectedChain.chain, executedChain);

  return {
    valid: isComplete && isClean && isSequenced,
    chainName,
    expectedModules,
    executedModules: executedChain,
    missing,
    extra,
    isComplete,
    isClean,
    isSequenced,
    reason: isComplete && isClean && isSequenced ? null : 'chain_validation_failed',
  };
}

/**
 * Valida se a sequência de módulos está correta
 */
function validateSequence(expectedSteps = [], executedModules = []) {
  let lastIdx = -1;

  for (const step of expectedSteps) {
    const moduleIdx = executedModules.indexOf(step.module);
    if (moduleIdx < lastIdx) {
      return false; // Out of order
    }
    lastIdx = moduleIdx;
  }

  return true;
}

/**
 * Infere chain esperado a partir de capability
 */
function inferExpectedChain(capabilityId) {
  return CAPABILITY_TO_CHAIN[capabilityId] || 'unknown';
}

/**
 * Valida se replay foi operacional real
 * (não apenas QA Waves → replay → QA Waves)
 */
function validateOperationalRealness(executionTrace = {}) {
  const issues = [];

  // Verificar se acessou módulos reais além do QA
  const modules = traceExecutionChain(executionTrace);
  const onlyQAModules = modules.every((m) => m === 'qa' || m === 'qa-waves');

  if (onlyQAModules) {
    issues.push('execution_stayed_in_qa_only');
  }

  // Verificar se houve interação com dados reais
  if (!executionTrace.userData && !executionTrace.dataAccessed) {
    issues.push('no_real_data_accessed');
  }

  // Verificar se houve timing/latency real
  if (!executionTrace.duration || executionTrace.duration < 100) {
    issues.push('duration_too_short_for_real_operation');
  }

  // Verificar se houve screenshot/visual verification
  if (!executionTrace.screenshots || executionTrace.screenshots.length === 0) {
    issues.push('no_visual_verification');
  }

  return {
    isOperationalReal: issues.length === 0,
    issues,
    recommendation: issues.length > 0 ? 'Não é considerado operacional real' : 'Operacional real',
  };
}

/**
 * Classifica execução por grau de operacionalidade
 */
function classifyOperationality(executionTrace = {}, chainValidation = {}) {
  let score = 0;
  let classification = 'not_operational';

  // Chain validation (0-40 pts)
  if (chainValidation.isComplete) score += 20;
  if (chainValidation.isClean) score += 10;
  if (chainValidation.isSequenced) score += 10;

  // Realness validation (0-60 pts)
  const realness = validateOperationalRealness(executionTrace);
  if (!realness.issues.includes('execution_stayed_in_qa_only')) score += 20;
  if (!realness.issues.includes('no_real_data_accessed')) score += 20;
  if (!realness.issues.includes('duration_too_short_for_real_operation')) score += 10;
  if (!realness.issues.includes('no_visual_verification')) score += 10;

  // Classificar
  if (score >= 80) classification = 'fully_operational';
  else if (score >= 60) classification = 'mostly_operational';
  else if (score >= 40) classification = 'partially_operational';
  else if (score >= 20) classification = 'minimal_operational';

  return {
    score,
    classification,
    realness,
    chainValidation,
  };
}

/**
 * Gera sugestões de remediação para chain breaks
 */
function suggestChainRemediations(chainValidation = {}) {
  const suggestions = [];

  if (!chainValidation.valid) {
    if (chainValidation.missing && chainValidation.missing.length > 0) {
      suggestions.push({
        type: 'missing_modules',
        modules: chainValidation.missing,
        action: `Verificar por que os módulos não foram chamados: ${chainValidation.missing.join(', ')}`,
      });
    }

    if (chainValidation.extra && chainValidation.extra.length > 0) {
      suggestions.push({
        type: 'extra_modules',
        modules: chainValidation.extra,
        action: `Módulos inesperados na execução. Pode indicar bypass ou flow alternativo.`,
      });
    }

    if (!chainValidation.isSequenced) {
      suggestions.push({
        type: 'sequence_broken',
        action: 'Ordem de execução não corresponde ao esperado. Verificar lógica de flow.',
      });
    }
  }

  return suggestions;
}

module.exports = {
  traceExecutionChain,
  validateExecutionChain,
  validateOperationalRealness,
  classifyOperationality,
  inferExpectedChain,
  suggestChainRemediations,
};
