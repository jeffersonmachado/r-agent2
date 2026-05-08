const logger = require('../../utils/logger');

/**
 * Mapa semântico de capability → validators
 * Inferência baseada em padrões de nomenclatura e tipo de capability
 */
const CAPABILITY_VALIDATOR_MAP = {
  // Support/Ticket domain
  'ticket-reply': [
    'message_sent_visible',
    'ticket_history_updated',
    'notification_sent',
    'timestamp_recorded',
  ],
  'ticket-status-change': ['status_updated_in_ui', 'status_persisted_db', 'audit_log_created'],
  'ticket-escalation': ['escalation_flag_set', 'manager_notified', 'priority_increased'],
  'ticket-close': ['ticket_closed_status', 'closure_reason_recorded', 'customer_notified'],

  // CRM domain
  'contact-creation': ['contact_id_generated', 'contact_persisted', 'contact_searchable'],
  'contact-update': ['contact_fields_updated', 'update_timestamp_recorded', 'audit_created'],
  'contact-search': ['search_results_returned', 'correct_contact_found', 'pagination_working'],

  // Membership/Fitness domain
  'membership-signup': ['membership_id_assigned', 'plan_active', 'payment_processed'],
  'membership-renewal': ['renewal_date_extended', 'payment_processed', 'notification_sent'],
  'membership-cancel': ['membership_status_cancelled', 'refund_processed', 'email_sent'],
  'checkin-scan': ['attendance_recorded', 'timestamp_logged', 'device_responded'],
  'checkin-biometric': ['biometric_stored', 'access_granted', 'audit_logged'],

  // Billing domain
  'billing-charge': ['charge_created', 'payment_confirmed', 'receipt_generated', 'ledger_updated'],
  'billing-refund': ['refund_initiated', 'status_reversed', 'customer_notified'],
  'subscription-update': ['subscription_terms_updated', 'next_billing_adjusted'],

  // Access Control domain
  'turnstile-release': [
    'access_decision_made',
    'release_command_sent',
    'solenoid_activated',
    'access_logged',
  ],
  'access-denied': ['denial_logged', 'reason_recorded', 'security_alert_triggered'],

  // Voice/Call domain
  'call-routing': ['call_queued', 'agent_assigned', 'call_initiated', 'duration_recorded'],
  'call-transfer': ['transfer_initiated', 'target_ringing', 'transfer_logged'],
  'call-recording': ['recording_started', 'audio_persisted', 'transcription_queued'],

  // Generic patterns
  'form-submit': ['form_data_persisted', 'success_message_shown', 'redirect_occurred'],
  'modal-open': ['modal_visible', 'focus_set', 'close_button_responsive'],
  'modal-close': ['modal_hidden', 'background_focus_restored'],
  'dropdown-select': ['value_changed', 'ui_updated', 'event_fired'],
  'button-click': ['click_handler_executed', 'navigation_or_action_triggered'],
  'input-fill': ['value_set', 'validation_passed', 'change_event_fired'],
};

/**
 * Pattern matchers para inferência heurística
 */
const VALIDATOR_PATTERNS = {
  ui_visible: {
    keywords: ['visible', 'show', 'display', 'appear', 'render'],
    validators: ['element_visible', 'not_hidden', 'opacity_100'],
  },
  data_persisted: {
    keywords: ['save', 'persist', 'store', 'create', 'update', 'write'],
    validators: ['data_in_database', 'api_call_made', 'backend_updated'],
  },
  state_changed: {
    keywords: ['status', 'state', 'change', 'update', 'set'],
    validators: ['state_changed', 'status_updated', 'property_changed'],
  },
  notification: {
    keywords: ['notify', 'alert', 'message', 'email', 'sms', 'toast'],
    validators: ['notification_sent', 'email_delivered', 'event_triggered'],
  },
  navigation: {
    keywords: ['navigate', 'route', 'redirect', 'go', 'move'],
    validators: ['url_changed', 'page_rendered', 'navigation_occurred'],
  },
  validation: {
    keywords: ['validate', 'check', 'verify', 'confirm'],
    validators: ['validation_passed', 'no_errors', 'constraints_met'],
  },
  security: {
    keywords: ['access', 'auth', 'permission', 'grant', 'deny', 'role'],
    validators: ['access_granted', 'permission_verified', 'authorization_checked'],
  },
};

/**
 * Infere validators para uma capability
 * Usa mapa direto se existir, senão usa pattern matching heurístico
 */
function inferValidatorsForCapability(capability = {}) {
  const capId = capability.id || capability.name || '';
  const capName = capability.name || capId;

  // 1. Check mapa direto
  if (CAPABILITY_VALIDATOR_MAP[capId]) {
    return CAPABILITY_VALIDATOR_MAP[capId].map((v) => ({
      name: v,
      type: 'assertion',
      source: 'direct_map',
      inferred: true,
    }));
  }

  // 2. Pattern matching heurístico
  const validators = [];
  const lower = capName.toLowerCase();

  for (const [patternName, pattern] of Object.entries(VALIDATOR_PATTERNS)) {
    const hasMatch = pattern.keywords.some((kw) => lower.includes(kw));
    if (hasMatch) {
      for (const v of pattern.validators) {
        if (!validators.some((x) => x.name === v)) {
          validators.push({
            name: v,
            type: 'assertion',
            source: 'pattern_match',
            pattern: patternName,
            inferred: true,
          });
        }
      }
    }
  }

  // 3. Se não encontrou via pattern, gerar genéricos baseado no tipo de capability
  if (validators.length === 0) {
    validators.push(
      {
        name: `${capId}_executed`,
        type: 'assertion',
        source: 'generic',
        inferred: true,
      },
      {
        name: `${capId}_success`,
        type: 'assertion',
        source: 'generic',
        inferred: true,
      }
    );
  }

  return validators;
}

/**
 * Gera mapa de validators por capability
 */
function generateValidatorsMap(capabilities = []) {
  const map = {};

  for (const capability of capabilities) {
    const capId = capability.id || capability.name;
    map[capId] = inferValidatorsForCapability(capability);
  }

  return map;
}

/**
 * Classifica validators por criticidade
 */
function classifyValidatorsByCriticality(validators = []) {
  return {
    critical: validators.filter((v) => {
      const lower = v.name.toLowerCase();
      return (
        lower.includes('persisted') || lower.includes('database') || lower.includes('authorization')
      );
    }),
    important: validators.filter((v) => {
      const lower = v.name.toLowerCase();
      return (
        lower.includes('visible') || lower.includes('changed') || lower.includes('executed')
      );
    }),
    informational: validators.filter((v) => {
      const lower = v.name.toLowerCase();
      return !lower.includes('persisted') && !lower.includes('visible') && !lower.includes('database');
    }),
  };
}

/**
 * Valida if validators cobrem capability
 */
function validateValidatorsCoverage(capability = {}, validators = []) {
  const classified = classifyValidatorsByCriticality(validators);

  return {
    hasCritical: classified.critical.length > 0,
    hasImportant: classified.important.length > 0,
    totalValidators: validators.length,
    coverage: validators.length > 0 ? 'partial' : 'none',
  };
}

module.exports = {
  inferValidatorsForCapability,
  generateValidatorsMap,
  classifyValidatorsByCriticality,
  validateValidatorsCoverage,
};
