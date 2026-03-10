'use strict';

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function safeNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso(value = new Date()) {
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();
}

function createOperationalEvent(input = {}) {
  return {
    id: safeString(input.id || input.eventId || input.event_id),
    tenantId: safeString(input.tenantId || input.tenant_id),
    contactId: safeString(input.contactId || input.contact_id),
    type: safeString(input.type || input.eventType || input.event_type),
    sourceModule: safeString(input.sourceModule || input.source_module),
    correlationId: safeString(input.correlationId || input.correlation_id),
    payload: safeObject(input.payload),
    createdAt: nowIso(input.createdAt || input.created_at),
  };
}

function createOperationalSignal(input = {}) {
  return {
    id: safeString(input.id || input.signalId || input.signal_id),
    tenantId: safeString(input.tenantId || input.tenant_id),
    contactId: safeString(input.contactId || input.contact_id),
    type: safeString(input.type || input.signalType || input.signal_type),
    severity: safeString(input.severity) || 'medium',
    confidence: safeNumber(input.confidence, 0.5),
    status: safeString(input.status) || 'open',
    context: safeObject(input.context || input.context_json),
    detectedAt: nowIso(input.detectedAt || input.detected_at),
  };
}

function createOperationalRecommendation(input = {}) {
  return {
    id: safeString(input.id || input.recommendationId || input.recommendation_id),
    tenantId: safeString(input.tenantId || input.tenant_id),
    contactId: safeString(input.contactId || input.contact_id),
    sourceSignalId: safeString(input.sourceSignalId || input.source_signal_id),
    type: safeString(input.type || input.recommendationType || input.recommendation_type),
    priority: safeNumber(input.priority, 50),
    confidence: safeNumber(input.confidence, 0.5),
    status: safeString(input.status) || 'open',
    targetModule: safeString(input.targetModule || input.target_module),
    suggestedActions: normalizeArray(input.suggestedActions || input.suggested_actions),
    context: safeObject(input.context || input.context_json),
    createdAt: nowIso(input.createdAt || input.created_at),
  };
}

function createOperationalDecision(input = {}) {
  return {
    sourceType: safeString(input.sourceType || input.source_type),
    sourceId: safeString(input.sourceId || input.source_id),
    recommendationId: safeString(input.recommendationId || input.recommendation_id),
    signalId: safeString(input.signalId || input.signal_id),
    decisionType: safeString(input.decisionType || input.decision_type),
    actionMode: safeString(input.actionMode || input.action_mode),
    priorityScore: safeNumber(input.priorityScore || input.priority_score, 0),
    reason: safeString(input.reason),
    expectedOutcome: safeString(input.expectedOutcome || input.expected_outcome),
  };
}

function createOperationalAction(input = {}) {
  return {
    id: safeString(input.id || input.actionId || input.action_id),
    tenantId: safeString(input.tenantId || input.tenant_id),
    contactId: safeString(input.contactId || input.contact_id),
    sourceType: safeString(input.sourceType || input.source_type),
    sourceId: safeString(input.sourceId || input.source_id),
    actorType: safeString(input.actorType || input.actor_type) || 'system',
    actorId: safeString(input.actorId || input.actor_id),
    status: safeString(input.status) || 'requested',
    input: safeObject(input.input || input.input_json),
    result: safeObject(input.result || input.result_json),
    executedAt: input.executedAt ? nowIso(input.executedAt) : null,
  };
}

function createOperationalOutcome(input = {}) {
  return {
    id: safeString(input.id || input.outcomeId || input.outcome_id),
    tenantId: safeString(input.tenantId || input.tenant_key || input.tenant_id),
    contactId: safeString(input.contactId || input.contact_id),
    sourceType: safeString(input.sourceType || input.source_type),
    sourceId: safeString(input.sourceId || input.source_id),
    actionId: safeString(input.actionId || input.action_id),
    outcomeType: safeString(input.outcomeType || input.outcome_type),
    outcomeScore: safeNumber(input.outcomeScore || input.outcome_score, null),
    status: safeString(input.status) || 'success',
    resultContext: safeObject(input.resultContext || input.result_context_json),
    producedAt: nowIso(input.producedAt || input.produced_at),
  };
}

function createOperationalContext(input = {}) {
  return {
    tenantId: safeString(input.tenantId || input.tenant_id),
    contactId: safeString(input.contactId || input.contact_id),
    customer: safeObject(input.customer),
    conversation: safeObject(input.conversation),
    ticket: safeObject(input.ticket),
    scheduling: safeObject(input.scheduling),
    crm: safeObject(input.crm),
    knowledge: safeObject(input.knowledge),
    team: safeObject(input.team),
    history: safeObject(input.history),
    metadata: safeObject(input.metadata),
  };
}

function createOperationalStateSnapshot(input = {}) {
  return {
    tenantId: safeString(input.tenantId || input.tenant_id),
    contactId: safeString(input.contactId || input.contact_id),
    backlog: safeNumber(input.backlog, 0),
    queuePressure: safeNumber(input.queuePressure || input.queue_pressure, 0),
    schedulingPressure: safeNumber(input.schedulingPressure || input.scheduling_pressure, 0),
    openConversations: safeNumber(input.openConversations || input.open_conversations, 0),
    pendingFollowUps: safeNumber(input.pendingFollowUps || input.pending_follow_ups, 0),
    workloadByAgent: safeObject(input.workloadByAgent || input.workload_by_agent),
    slaRisk: safeNumber(input.slaRisk || input.sla_risk, 0),
    escalationRisk: safeNumber(input.escalationRisk || input.escalation_risk, 0),
    waitingCustomers: safeNumber(input.waitingCustomers || input.waiting_customers, 0),
    capacityAvailability: safeNumber(input.capacityAvailability || input.capacity_availability, 0),
    signals: normalizeArray(input.signals),
    recommendations: normalizeArray(input.recommendations),
    outcomes: normalizeArray(input.outcomes),
    generatedAt: nowIso(input.generatedAt || input.generated_at),
  };
}

module.exports = {
  createOperationalEvent,
  createOperationalSignal,
  createOperationalRecommendation,
  createOperationalDecision,
  createOperationalAction,
  createOperationalOutcome,
  createOperationalContext,
  createOperationalStateSnapshot,
};
