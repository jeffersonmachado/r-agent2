'use strict';

/**
 * OperationalQuickActionRegistry
 *
 * Centralized mapping between signal/recommendation types and available quick actions.
 * No persistence - all mappings are statically defined.
 */

const QUICK_ACTIONS = {
  open_followup: {
    id: 'open_followup',
    label: 'Abrir follow-up',
    targetType: 'contact',
    allowedSources: ['customer_reactivation', 'missed_revenue', 'followup_overdue', 'upsell_opportunity'],
    executorType: 'playbook_step',
    payloadTemplate: {
      type: 'create_followup',
      delayHours: 24,
      description: 'Follow-up automático via quick action',
    },
    confirmationRequired: false,
    icon: 'phone-callback',
    variant: 'primary',
  },

  send_whatsapp_template: {
    id: 'send_whatsapp_template',
    label: 'Enviar template WhatsApp',
    targetType: 'contact',
    allowedSources: ['customer_reactivation', 'missed_revenue', 'upsell_opportunity'],
    executorType: 'playbook_step',
    payloadTemplate: {
      type: 'send_whatsapp_template',
      template: null, // require user input
      languageCode: 'pt_BR',
    },
    confirmationRequired: true, // need to select template
    icon: 'message',
    variant: 'secondary',
  },

  suggest_schedule_slots: {
    id: 'suggest_schedule_slots',
    label: 'Ver horários disponíveis',
    targetType: 'contact',
    allowedSources: ['customer_reactivation', 'missed_revenue', 'low_occupancy'],
    executorType: 'playbook_step',
    payloadTemplate: {
      type: 'suggest_schedule_slots',
      limit: 3,
      durationMinutes: 30,
    },
    confirmationRequired: false,
    icon: 'calendar',
    variant: 'secondary',
  },

  create_campaign: {
    id: 'create_campaign',
    label: 'Criar campanha',
    targetType: 'contact',
    allowedSources: ['low_occupancy'],
    executorType: 'service_call',
    serviceName: 'ccCampaignsService',
    serviceMethod: 'createCampaign',
    payloadTemplate: {
      name: null, // require input
      description: 'Campanha criada via quick action',
      status: 'draft',
    },
    confirmationRequired: true,
    icon: 'megaphone',
    variant: 'secondary',
  },

  notify_operator: {
    id: 'notify_operator',
    label: 'Notificar operador',
    targetType: 'tenant',
    allowedSources: ['low_occupancy', 'followup_overdue', 'channel_attention'],
    executorType: 'event_emit',
    eventType: 'operational_notification',
    payloadTemplate: {
      message: null, // require input
      priority: 'high',
    },
    confirmationRequired: true,
    icon: 'bell',
    variant: 'warning',
  },

  schedule_callback: {
    id: 'schedule_callback',
    label: 'Agendar callback',
    targetType: 'contact',
    allowedSources: ['followup_overdue'],
    executorType: 'service_call',
    serviceName: 'ccScheduledCallbacksService',
    serviceMethod: 'scheduleCallback',
    payloadTemplate: {
      scheduledFor: null, // require input
      priority: 'high',
    },
    confirmationRequired: true,
    icon: 'schedule',
    variant: 'primary',
  },

  create_opportunity: {
    id: 'create_opportunity',
    label: 'Criar oportunidade CRM',
    targetType: 'contact',
    allowedSources: ['upsell_opportunity'],
    executorType: 'playbook_step',
    payloadTemplate: {
      type: 'create_opportunity',
      title: null,
    },
    confirmationRequired: true,
    icon: 'trending-up',
    variant: 'primary',
  },

  review_queue: {
    id: 'review_queue',
    label: 'Revisar fila',
    targetType: 'tenant',
    allowedSources: ['support_backlog_risk'],
    executorType: 'navigation',
    navigationTarget: '/support?view=queue',
    payloadTemplate: {},
    confirmationRequired: false,
    icon: 'inbox',
    variant: 'warning',
  },

  assign_team: {
    id: 'assign_team',
    label: 'Atribuir ao time',
    targetType: 'contact',
    allowedSources: ['support_backlog_risk'],
    executorType: 'playbook_step',
    payloadTemplate: {
      type: 'notify_team',
      teamId: null, // require input
    },
    confirmationRequired: true,
    icon: 'users',
    variant: 'secondary',
  },

  inspect_channel_health: {
    id: 'inspect_channel_health',
    label: 'Inspecionar canal',
    targetType: 'tenant',
    allowedSources: ['channel_attention'],
    executorType: 'service_call',
    serviceName: 'channelHealthService',
    serviceMethod: 'getChannelHealth',
    payloadTemplate: {
      windowMinutes: 10,
    },
    confirmationRequired: false,
    icon: 'activity',
    variant: 'info',
  },

  offer_alternative_slot: {
    id: 'offer_alternative_slot',
    label: 'Oferecer horário alternativo',
    targetType: 'contact',
    allowedSources: ['missed_revenue'],
    executorType: 'playbook_step',
    payloadTemplate: {
      type: 'suggest_schedule_slots',
      limit: 3,
      durationMinutes: 30,
    },
    confirmationRequired: false,
    icon: 'calendar-alt',
    variant: 'secondary',
  },

  notify_supervisor: {
    id: 'notify_supervisor',
    label: 'Notificar supervisor',
    targetType: 'tenant',
    allowedSources: ['high_cancel_rate'],
    executorType: 'event_emit',
    eventType: 'supervisor_alert',
    payloadTemplate: {
      message: 'Taxa de cancelamentos elevada - análise de política necessária',
      priority: 'critical',
    },
    confirmationRequired: false,
    icon: 'alert-triangle',
    variant: 'error',
  },

  review_schedule_policy: {
    id: 'review_schedule_policy',
    label: 'Revisar política de agendamento',
    targetType: 'tenant',
    allowedSources: ['high_cancel_rate'],
    executorType: 'navigation',
    navigationTarget: '/admin/settings/scheduling-policy',
    payloadTemplate: {},
    confirmationRequired: false,
    icon: 'settings',
    variant: 'warning',
  },

  reschedule: {
    id: 'reschedule',
    label: 'Reagendar contato',
    targetType: 'contact',
    allowedSources: ['schedule_conflict', 'double_booking', 'agent_unavailable'],
    executorType: 'playbook_step',
    payloadTemplate: {
      type: 'suggest_schedule_slots',
      limit: 3,
      durationMinutes: 30,
    },
    confirmationRequired: false,
    icon: 'calendar',
    variant: 'primary',
  },

  reassign_agent: {
    id: 'reassign_agent',
    label: 'Reatribuir agente',
    targetType: 'contact',
    allowedSources: ['agent_unavailable', 'ticket_escalation', 'support_backlog_risk'],
    executorType: 'playbook_step',
    payloadTemplate: {
      type: 'notify_team',
      message: 'Solicitação de reatribuição operacional',
      teamId: null,
    },
    confirmationRequired: true,
    icon: 'users',
    variant: 'warning',
  },

  notify_customer: {
    id: 'notify_customer',
    label: 'Notificar cliente',
    targetType: 'contact',
    allowedSources: ['double_booking', 'schedule_conflict', 'customer_no_response'],
    executorType: 'playbook_step',
    payloadTemplate: {
      type: 'send_whatsapp_message',
      message: 'Detectamos uma atualização no seu atendimento e vamos confirmar o próximo passo em seguida.',
    },
    confirmationRequired: false,
    icon: 'message',
    variant: 'secondary',
  },

  send_document: {
    id: 'send_document',
    label: 'Enviar documento sugerido',
    targetType: 'contact',
    allowedSources: ['knowledge_gap'],
    executorType: 'playbook_step',
    payloadTemplate: {
      type: 'send_whatsapp_template',
      template: null,
      languageCode: 'pt_BR',
    },
    confirmationRequired: true,
    icon: 'file-text',
    variant: 'info',
  },

  trigger_playbook: {
    id: 'trigger_playbook',
    label: 'Acionar playbook',
    targetType: 'tenant',
    allowedSources: ['ticket_escalation', 'knowledge_gap', 'schedule_conflict'],
    executorType: 'navigation',
    navigationTarget: '/operational-control-center?tab=playbooks',
    payloadTemplate: {},
    confirmationRequired: false,
    icon: 'book-open',
    variant: 'warning',
  },
};

const ACTION_ID_ALIASES = {
  schedule_contact: 'schedule_callback',
  send_whatsapp_message: 'send_whatsapp_template',
  create_followup_task: 'open_followup',
  run_playbook: 'trigger_playbook',
  assign_ticket: 'assign_team',
  notify_agent: 'notify_operator',
  reschedule_schedule: 'reschedule',
  send_rag_document: 'send_document',
};

// Signal type -> Quick Action IDs mapping
const SIGNAL_ACTION_MAP = {
  customer_reactivation: [
    'open_followup',
    'send_whatsapp_template',
    'suggest_schedule_slots',
  ],
  missed_revenue: [
    'open_followup',
    'offer_alternative_slot',
    'send_whatsapp_template',
  ],
  low_occupancy: [
    'create_campaign',
    'notify_operator',
    'suggest_schedule_slots',
  ],
  followup_overdue: [
    'schedule_callback',
    'notify_operator',
  ],
  upsell_opportunity: [
    'create_opportunity',
    'send_whatsapp_template',
  ],
  support_backlog_risk: [
    'review_queue',
    'assign_team',
  ],
  channel_attention: [
    'inspect_channel_health',
    'notify_operator',
  ],
  high_cancel_rate: [
    'review_schedule_policy',
    'notify_supervisor',
  ],
  customer_no_response: [
    'open_followup',
    'notify_customer',
  ],
  lead_high_intent: [
    'create_opportunity',
    'schedule_callback',
  ],
  ticket_escalation: [
    'reassign_agent',
    'trigger_playbook',
    'notify_supervisor',
  ],
  schedule_conflict: [
    'reschedule',
    'notify_customer',
    'trigger_playbook',
  ],
  agent_unavailable: [
    'reassign_agent',
    'reschedule',
  ],
  double_booking: [
    'reschedule',
    'notify_customer',
  ],
  knowledge_gap: [
    'send_document',
    'trigger_playbook',
  ],
};

// Recommendation type -> Quick Action IDs mapping (same as signals for now)
const RECOMMENDATION_ACTION_MAP = Object.keys(SIGNAL_ACTION_MAP).reduce((acc, key) => {
  acc[key] = SIGNAL_ACTION_MAP[key];
  acc[`operational_${key}`] = SIGNAL_ACTION_MAP[key];
  return acc;
}, {});

Object.assign(RECOMMENDATION_ACTION_MAP, {
  schedule_contact: ['schedule_callback', 'send_whatsapp_template', 'open_followup'],
  reengage_cold_lead: ['open_followup', 'notify_operator'],
  prevent_churn: ['send_whatsapp_template', 'notify_operator', 'trigger_playbook'],
  assign_ticket: ['assign_team', 'notify_operator'],
  escalate_ticket: ['trigger_playbook', 'assign_team', 'notify_supervisor'],
  prioritize_sla_ticket: ['assign_team', 'notify_operator'],
  reschedule_appointment: ['reschedule', 'notify_operator', 'notify_customer'],
  reassign_owner: ['reassign_agent', 'assign_team'],
  send_rag_document: ['send_document', 'notify_operator'],
  reengage_contact: ['open_followup', 'notify_customer'],
  resume_conversion: ['create_opportunity', 'send_whatsapp_template', 'schedule_callback'],
  start_reactivation_outreach: ['create_campaign', 'notify_operator'],
  review_operational_signal: ['notify_operator', 'trigger_playbook'],
});

class OperationalQuickActionRegistry {
  constructor() {}

  resolveActionId(actionId) {
    const id = String(actionId || '').trim();
    if (!id) return null;
    return ACTION_ID_ALIASES[id] || id;
  }

  enrichActionDefinition(action) {
    if (!action || typeof action !== 'object') return null;

    const payloadTemplate = action.payloadTemplate && typeof action.payloadTemplate === 'object'
      ? action.payloadTemplate
      : {};

    const required = Object.entries(payloadTemplate)
      .filter(([, value]) => value === null)
      .map(([key]) => key);

    return {
      ...action,
      action_id: action.id,
      required_permissions: Array.isArray(action.required_permissions)
        ? action.required_permissions
        : (action.targetType === 'tenant'
          ? ['tickets:update', 'analytics:read']
          : ['tickets:update', 'crm:update']),
      supported_contexts: Array.isArray(action.supported_contexts)
        ? action.supported_contexts
        : (action.targetType === 'tenant'
          ? ['tenant', 'occ']
          : ['contact', 'support', 'crm']),
      parameter_schema: action.parameter_schema || {
        type: 'object',
        required,
        properties: Object.keys(payloadTemplate).reduce((acc, key) => {
          acc[key] = { nullable: payloadTemplate[key] === null };
          return acc;
        }, {}),
      },
      audit_behavior: action.audit_behavior || {
        recordAction: true,
        recordOutcome: true,
        recordOperationalEvent: true,
      },
    };
  }

  /**
   * Get available quick actions for a signal
   *
   * @param {Object} signal - Signal object with type property
   * @returns {Array} Array of quick action definitions
   */
  getActionsForSignal(signal) {
    if (!signal || typeof signal !== 'object') return [];
    const signalType = String(signal.type || '').trim();
    const actionIds = SIGNAL_ACTION_MAP[signalType] || [];
    return actionIds
      .map((id) => this.enrichActionDefinition(QUICK_ACTIONS[this.resolveActionId(id)]))
      .filter(Boolean);
  }

  /**
   * Get available quick actions for a recommendation
   *
   * @param {Object} recommendation - Recommendation object with type property
   * @returns {Array} Array of quick action definitions
   */
  getActionsForRecommendation(recommendation) {
    if (!recommendation || typeof recommendation !== 'object') return [];
    const recType = String(recommendation.type || '').trim();
    const fromRecMap = RECOMMENDATION_ACTION_MAP[recType] || null;
    const fromSignalMap = SIGNAL_ACTION_MAP[recType]
      || (recType.startsWith('operational_') ? SIGNAL_ACTION_MAP[recType.slice('operational_'.length)] : null)
      || (recType.startsWith('handle_') ? SIGNAL_ACTION_MAP[recType.slice('handle_'.length)] : null);
    const actionIds = fromRecMap || fromSignalMap || [];
    return actionIds
      .map((id) => this.enrichActionDefinition(QUICK_ACTIONS[this.resolveActionId(id)]))
      .filter(Boolean);
  }

  /**
   * Get a specific quick action by ID
   *
   * @param {string} actionId - Action ID
   * @returns {Object|null} Quick action definition or null
   */
  getActionById(actionId) {
    const id = this.resolveActionId(actionId);
    return this.enrichActionDefinition(QUICK_ACTIONS[id]) || null;
  }

  /**
   * List all available quick actions
   *
   * @returns {Array} All quick action definitions
   */
  listAllActions() {
    return Object.values(QUICK_ACTIONS)
      .map((item) => this.enrichActionDefinition(item))
      .filter(Boolean);
  }

  /**
   * Check if a signal type has quick actions
   *
   * @param {string} signalType
   * @returns {boolean}
   */
  hasActionsForSignalType(signalType) {
    const type = String(signalType || '').trim();
    return !!SIGNAL_ACTION_MAP[type];
  }

  /**
   * Check if a recommendation type has quick actions
   *
   * @param {string} recommendationType
   * @returns {boolean}
   */
  hasActionsForRecommendationType(recommendationType) {
    const type = String(recommendationType || '').trim();
    return !!(
      RECOMMENDATION_ACTION_MAP[type]
      || SIGNAL_ACTION_MAP[type]
      || (type.startsWith('operational_') ? SIGNAL_ACTION_MAP[type.slice('operational_'.length)] : null)
      || (type.startsWith('handle_') ? SIGNAL_ACTION_MAP[type.slice('handle_'.length)] : null)
    );
  }

  /**
   * Validate if action is allowed for source type
   *
   * @param {string} actionId
   * @param {string} sourceType - signal type or recommendation type
   * @returns {boolean}
   */
  isActionAllowedForSource(actionId, sourceType) {
    const action = this.getActionById(actionId);
    if (!action) return false;
    const source = String(sourceType || '').trim();
    return (action.allowedSources || []).includes(source);
  }
}

const quickActionRegistry = new OperationalQuickActionRegistry();

module.exports = {
  OperationalQuickActionRegistry,
  quickActionRegistry,
  QUICK_ACTIONS,
  SIGNAL_ACTION_MAP,
  RECOMMENDATION_ACTION_MAP,
};
