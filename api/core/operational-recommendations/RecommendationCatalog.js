'use strict';

const DEFAULT_ACTIONS_BY_SIGNAL = {
  lead_high_intent: ['schedule_contact', 'send_whatsapp_message', 'create_followup_task'],
  lead_cold: ['create_followup_task', 'notify_agent'],
  followup_due: ['create_followup_task', 'schedule_contact', 'send_whatsapp_message'],
  churn_risk: ['send_whatsapp_message', 'notify_agent', 'run_playbook'],

  ticket_stalled: ['assign_ticket', 'notify_agent', 'run_playbook'],
  escalation_risk: ['assign_ticket', 'notify_agent', 'run_playbook'],
  sla_risk: ['assign_ticket', 'notify_agent'],

  schedule_conflict: ['reschedule_schedule', 'notify_agent', 'send_whatsapp_message'],
  agent_unavailable: ['assign_ticket', 'reschedule_schedule', 'notify_agent'],
  double_booking: ['reschedule_schedule', 'notify_agent', 'send_whatsapp_message'],

  knowledge_gap: ['send_rag_document', 'notify_agent', 'run_playbook'],
  knowledge_reuse_opportunity: ['send_rag_document', 'notify_agent'],

  customer_no_response: ['create_followup_task', 'send_whatsapp_message'],
  customer_reactivation: ['create_followup_task', 'send_whatsapp_message', 'schedule_contact'],
  customer_reengaged: ['schedule_contact', 'send_whatsapp_message', 'create_followup_task'],

  support_backlog_risk: ['assign_ticket', 'notify_agent'],
  ticket_escalation: ['run_playbook', 'assign_ticket', 'notify_agent'],
  low_occupancy: ['schedule_contact', 'notify_agent'],
  high_cancel_rate: ['reschedule_schedule', 'notify_agent'],
  missed_revenue: ['schedule_contact', 'send_whatsapp_message'],
  channel_attention: ['notify_agent', 'run_playbook'],
  followup_overdue: ['create_followup_task', 'schedule_contact', 'send_whatsapp_message'],
  upsell_opportunity: ['schedule_contact', 'notify_agent', 'run_playbook'],
};

const SIGNAL_TO_RECOMMENDATION_TYPE = {
  lead_high_intent: 'schedule_contact',
  lead_cold: 'reengage_cold_lead',
  followup_due: 'schedule_contact',
  churn_risk: 'prevent_churn',

  ticket_stalled: 'assign_ticket',
  escalation_risk: 'escalate_ticket',
  sla_risk: 'prioritize_sla_ticket',

  schedule_conflict: 'reschedule_appointment',
  agent_unavailable: 'reassign_owner',
  double_booking: 'reschedule_appointment',

  knowledge_gap: 'send_rag_document',
  knowledge_reuse_opportunity: 'send_rag_document',

  customer_no_response: 'reengage_contact',
  customer_reactivation: 'resume_conversion',
  customer_reengaged: 'resume_conversion',

  support_backlog_risk: 'assign_ticket',
  ticket_escalation: 'escalate_ticket',
  low_occupancy: 'start_reactivation_outreach',
  high_cancel_rate: 'reschedule_appointment',
  missed_revenue: 'schedule_contact',
  channel_attention: 'review_operational_signal',
  followup_overdue: 'schedule_contact',
  upsell_opportunity: 'prevent_churn',
};

const RECOMMENDATION_DESCRIPTIONS = {
  schedule_contact: 'Contato com potencial de avanço comercial; priorizar contato agendado.',
  reengage_cold_lead: 'Lead com baixa temperatura; iniciar reengajamento estruturado.',
  prevent_churn: 'Sinais de possível evasão detectados; aplicar contenção preventiva.',
  assign_ticket: 'Ticket requer owner explícito para reduzir tempo de resposta.',
  escalate_ticket: 'Risco de escalada detectado; acionar fluxo de escalonamento.',
  prioritize_sla_ticket: 'Risco de SLA; priorizar ticket para evitar violação.',
  reschedule_appointment: 'Conflito operacional detectado; recomendar reagendamento.',
  reassign_owner: 'Owner atual indisponível; redistribuir execução.',
  send_rag_document: 'Existe material relevante para apoiar atendimento/contexto do cliente.',
  reengage_contact: 'Cliente sem resposta; disparar estratégia de recontato.',
  resume_conversion: 'Cliente voltou a interagir; retomar fluxo de conversão.',
  start_reactivation_outreach: 'Baixa ocupação/atividade; iniciar campanha de recuperação.',
};

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function listSuggestedActionsForSignal(signalType) {
  const key = safeString(signalType);
  if (!key) return [];
  return Array.isArray(DEFAULT_ACTIONS_BY_SIGNAL[key]) ? DEFAULT_ACTIONS_BY_SIGNAL[key] : [];
}

function recommendationTypeForSignal(signalType) {
  const key = safeString(signalType);
  if (!key) return 'review_operational_signal';
  return SIGNAL_TO_RECOMMENDATION_TYPE[key] || `handle_${key}`;
}

function recommendationDescriptionForType(type) {
  const key = safeString(type);
  if (!key) return 'Recomendação operacional gerada pelo core.';
  return RECOMMENDATION_DESCRIPTIONS[key] || 'Recomendação operacional gerada pelo core.';
}

module.exports = {
  DEFAULT_ACTIONS_BY_SIGNAL,
  SIGNAL_TO_RECOMMENDATION_TYPE,
  RECOMMENDATION_DESCRIPTIONS,
  listSuggestedActionsForSignal,
  recommendationTypeForSignal,
  recommendationDescriptionForType,
};
