/**
 * Event Model v1 (canonical events)
 *
 * This module defines a minimal contract to standardize events across modules
 * (physical queues, orders/delivery, PBX/CDR, etc.).
 */

const crypto = require('crypto');

const EVENT_TYPES_V1 = new Set([
  // Physical (Fast service)
  'PhysicalTicketCreated',
  'PhysicalTicketCalled',
  'PhysicalTicketFinished',
  'PhysicalServiceStarted',
  'PhysicalServicePaused',
  'PhysicalServiceResumed',
  'PhysicalTicketSkipped',
  'PhysicalTicketTransferred',
  'PhysicalTicketAbandoned',
  'PhysicalSLARisk',

  // Orders/Delivery
  'OrderCreated',
  'OrderStatusChanged',
  'DeliveryCreated',
  'DeliveryStatusChanged',
  'DeliverySLARisk',
  'SupportIncidentOpened',
  'SupportTicketOpened',

  // Scheduler / Ops
  'ScheduledTriggerFired',

  // PBX
  'PbxCdrIngested',
  'CallRinging',
  'CallAnswered',
  'CallEnded',

  // Voice runtime / gateway
  'VoiceCallRinging',
  'VoiceCallAnswered',
  'VoiceCallEnded',
  'VoiceCallDtmf',
  'VoiceCallTransfer',
  'VoiceFlowInput',
  'VoiceFlowAction',
  'VoiceRecordingCaptured',

  // Vertical - Journey Events (Beauty & Fitness shared)
  'VerticalJourney_ConfirmationSent',
  'VerticalJourney_ConfirmationReceived',
  'VerticalJourney_Reminder24hSent',
  'VerticalJourney_ReminderNearTimeSent',
  'VerticalJourney_NoShowDetected',
  'VerticalJourney_ServiceCompleted',
  'VerticalJourney_FollowUpSent',
  'VerticalJourney_ReviewRequested',
  'VerticalJourney_ReactivationSent',
  'VerticalJourney_WelcomeSent',
  'VerticalJourney_FrequencyAlertSent',
  'VerticalJourney_ReturnCampaignSent',
  'VerticalJourney_LoyaltyPointsReversed',
  'VerticalJourney_Custom',

  // Vertical - Billing / Membership
  'MembershipBillingStatusChanged',
  'SessionBundleConsumed',
  'SessionBundleCreated',
  'LoyaltyPointsGranted',

  // Vertical - Attendance (Fitness)
  'FitnessCheckIn',
  'FitnessCheckOut',
  'FitnessAttendanceAbsent',

  // Vertical - Engagement
  'VerticalEngagementSignalComputed',

  // CRM - Operational signals
  'CrmOperationalEvent',

  // Learning routine (RAP Learn)
  'LearningRoutineCompleted',

  // Cognitive Core — execuções do pipeline cognitivo
  'cognitive.execution.completed',
  'cognitive.execution.failed',
  'cognitive.execution.handed_off',

  // Causal runtime trace — boundaries reais da jornada operacional
  'channel.message.inbound',
  'tenant.resolution.completed',
  'principal.resolution.completed',
  'cognitive.context.completed',
  'cognitive.intent.classified',
  'cognitive.decision.completed',
  'agent.planning.completed',
  'handoff.decision.completed',
  'handoff.requested',
  'ticket.queue.enqueued',
  'human.takeover.started',
  'human.action.completed',
  'backend.mutation.completed',
  'business.outcome.validated',
  'business.outcome.failed',
  'evidence.generated',
  'replay.persisted',

  // Agent Runtime — roteamento, execução e delegação de agentes especialistas
  'agent.routing.completed',
  'agent.execution.started',
  'agent.execution.completed',
  'agent.execution.failed',
  'agent.execution.handed_off',
  'agent.delegation.requested',
  'agent.delegation.completed',
  'tool.execution.started',
  'tool.execution.completed',
  'tool.execution.failed',
  'process.delegated',

  // Learning Core — interação de usuário na UI (telemetria de aprendizado)
  'learning.interaction.navigation',
  'learning.interaction.click',
  'learning.interaction.api_call',
  'learning.interaction.flow_completed',
  'learning.interaction.flow_abandoned',
  'learning.interaction.error',
]);

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeString(v, maxLen = 120) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/**
 * @typedef {object} CanonicalEventV1
 * @property {string} id
 * @property {string} tenant_key
 * @property {string} type
 * @property {string} source
 * @property {string} occurred_at ISO string
 * @property {string|null} correlation_id
 * @property {{type:string|null,id:string|null}} subject
 * @property {{type:string|null,id:string|null}} actor
 * @property {string|null} idempotency_key
 * @property {object} payload
 */

/**
 * Build a canonical event. Validation is shallow; storage layer enforces minimal constraints.
 *
 * @param {object} args
 * @param {string} [args.eventId]
 * @param {string} args.tenantId
 * @param {string} args.type
 * @param {string} [args.source]
 * @param {Date|string} [args.occurredAt]
 * @param {string|null} [args.correlationId]
 * @param {string|null} [args.parentEventId]
 * @param {string|null} [args.causationId]
 * @param {string|null} [args.runId]
 * @param {string|null} [args.criticalJourneyId]
 * @param {string|null} [args.executionId]
 * @param {string|null} [args.principalId]
 * @param {{type?:string,id?:string}|null} [args.subject]
 * @param {{type?:string,id?:string}|null} [args.actor]
 * @param {string|null} [args.idempotencyKey]
 * @param {object} [args.payload]
 * @returns {CanonicalEventV1}
 */
function buildEventV1({
  eventId = null,
  tenantId,
  type,
  source = 'api',
  occurredAt = new Date(),
  correlationId = null,
  parentEventId = null,
  causationId = null,
  runId = null,
  criticalJourneyId = null,
  executionId = null,
  principalId = null,
  subject = null,
  actor = null,
  idempotencyKey = null,
  payload = {},
}) {
  const t = String(type || '').trim();
  if (!EVENT_TYPES_V1.has(t)) {
    const err = new Error(`unsupported_event_type:${t}`);
    // @ts-ignore
    err.code = 'unsupported_event_type';
    // @ts-ignore
    err.details = { type: t };
    throw err;
  }
  const dt = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  const occurredIso = Number.isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();

  return {
    id: normalizeString(eventId, 160) || makeId('evt'),
    tenant_key: String(tenantId),
    type: t,
    source: String(source || 'api'),
    occurred_at: occurredIso,
    correlation_id: normalizeString(correlationId, 120),
    parent_event_id: normalizeString(parentEventId, 160),
    causation_id: normalizeString(causationId, 160),
    run_id: normalizeString(runId, 160),
    critical_journey_id: normalizeString(criticalJourneyId, 160),
    execution_id: normalizeString(executionId, 160),
    principal_id: normalizeString(principalId, 160),
    subject: {
      type: normalizeString(subject && subject.type, 40),
      id: normalizeString(subject && subject.id, 128),
    },
    actor: {
      type: normalizeString(actor && actor.type, 40),
      id: normalizeString(actor && actor.id, 128),
    },
    idempotency_key: normalizeString(idempotencyKey, 160),
    payload: payload && typeof payload === 'object' ? payload : {},
  };
}

module.exports = {
  EVENT_TYPES_V1,
  buildEventV1,
};
