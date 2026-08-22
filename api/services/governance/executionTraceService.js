'use strict';

const { getSequelize } = require('../../db/sequelize');
const getTrace = require('../../db/models/ExecutionTrace');
const getEvent = require('../../db/models/ExecutionTraceEvent');

function traceError(code, message) { const error = new Error(`${code}: ${message}`); error.code = code; return error; }

async function createTrace(input) {
  const sequelize = getSequelize(); if (!sequelize) throw traceError('governance_db_required', 'Sequelize não inicializado');
  return getTrace().create({ run_id: input.runId, trace_type: input.traceType, critical_journey_id: input.criticalJourneyId || null, correlation_id: input.correlationId, execution_id: input.executionId || null, tenant_id: input.tenantId || null, principal_id: input.principalId || null, status: input.status || 'RUNNING', started_at: input.startedAt || new Date(), source_fingerprint: input.sourceFingerprint, metadata: input.metadata || {} });
}

async function appendEvent({ traceId, eventId, parentEventId = null, causationId = null, producer, eventType, entityType, entityId, occurredAt = new Date(), evidenceId = null, payload = {} }) {
  const trace = await getTrace().findByPk(traceId); if (!trace) throw traceError('trace_not_found', traceId);
  if (parentEventId) { const parent = await getEvent().findOne({ where: { trace_id: traceId, event_id: parentEventId } }); if (!parent) throw traceError('CAUSAL_PARENT_NOT_FOUND', parentEventId); }
  return getEvent().create({ trace_id: traceId, event_id: eventId, parent_event_id: parentEventId, causation_id: causationId, producer, event_type: eventType, entity_type: entityType, entity_id: entityId, occurred_at: occurredAt, evidence_id: evidenceId, payload_jsonb: payload });
}

function createExecutionTraceService({ sequelize, GovernanceRun, ExecutionTrace, EventLedger, idFactory = () => require('crypto').randomUUID(), clock = () => new Date() }) {
  const fail = (code, message) => { throw traceError(code, message); };
  async function loadRun(context, transaction) {
    const run = await GovernanceRun.findOne({ where: { run_id: context.runId, tenant_id: context.tenantId }, transaction, lock: transaction?.LOCK?.UPDATE });
    if (!run) return fail('GOVERNANCE_RUN_NOT_FOUND', context.runId);
    if (run.source_fingerprint !== context.sourceFingerprint) return fail('RUN_SOURCE_DRIFT', context.runId);
    if (run.status !== 'RUNNING') return fail('GOVERNANCE_RUN_NOT_RUNNING', run.status);
    return run;
  }
  async function createTraceWithContext(context) {
    return sequelize.transaction(async (transaction) => {
      await loadRun(context, transaction);
      return ExecutionTrace.create({ id: context.traceId || idFactory(), run_id: context.runId, tenant_id: context.tenantId, source_fingerprint: context.sourceFingerprint, trace_type: context.traceType, critical_journey_id: context.criticalJourneyId, correlation_id: context.correlationId, execution_id: context.executionId, principal_id: context.principalId, status: 'RUNNING', started_at: context.startedAt || clock(), metadata: { eventCount: 0 } }, { transaction });
    });
  }
  async function appendEventWithContext(context) {
    if (!context.producer || /^(governance|validator|test|synthetic)/i.test(context.producer)) return fail('TRACE_RUNTIME_PRODUCER_REQUIRED', context.producer || 'missing');
    const trace = await ExecutionTrace.findOne({ where: { id: context.traceId, run_id: context.runId, tenant_id: context.tenantId } });
    if (!trace || trace.correlation_id !== context.correlationId || trace.execution_id !== context.executionId) return fail('TRACE_CONTEXT_MISMATCH', context.traceId);
    if (trace.source_fingerprint !== context.sourceFingerprint) return fail('RUN_SOURCE_DRIFT', context.traceId);
    if (context.parentEventId && !(await EventLedger.findOne({ where: { trace_id: context.traceId, event_id: context.parentEventId } }))) return fail('TRACE_PARENT_NOT_FOUND', context.parentEventId);
    if (context.causationId && !(await EventLedger.findOne({ where: { trace_id: context.traceId, event_id: context.causationId } })) && context.causationId !== context.eventId) return fail('TRACE_CAUSATION_NOT_FOUND', context.causationId);
    return EventLedger.create({ trace_id: context.traceId, run_id: context.runId, tenant_id: context.tenantId, event_id: context.eventId, parent_event_id: context.parentEventId || null, causation_id: context.causationId || null, correlation_id: context.correlationId, execution_id: context.executionId, producer: context.producer, event_type: context.eventType, occurred_at: context.occurredAt || clock(), payload: context.payload || {} });
  }
  async function reconstructTrace(context) {
    const trace = await ExecutionTrace.findOne({ where: { id: context.traceId, run_id: context.runId, tenant_id: context.tenantId } });
    if (!trace) return fail('TRACE_NOT_FOUND', context.traceId);
    const events = await EventLedger.findAll({ where: { trace_id: context.traceId } });
    const ordered = [...events].sort((a, b) => new Date(a.occurred_at || a.occurredAt) - new Date(b.occurred_at || b.occurredAt));
    return { trace, events: ordered.map((event) => ({ ...event, eventId: event.event_id, parentEventId: event.parent_event_id, causationId: event.causation_id })), eventCount: ordered.length };
  }
  async function closeTrace(context) {
    const reconstructed = await reconstructTrace(context);
    if (reconstructed.eventCount === 0) return fail('TRACE_EVENTS_REQUIRED', context.traceId);
    const trace = await reconstructed.trace.update({ status: 'COMPLETED', completed_at: context.completedAt || clock(), eventCount: reconstructed.eventCount, metadata: { ...(reconstructed.trace.metadata || {}), eventCount: reconstructed.eventCount } });
    return { trace, eventCount: reconstructed.eventCount };
  }
  return { createTrace: createTraceWithContext, appendEvent: appendEventWithContext, reconstructTrace, closeTrace };
}

module.exports = { createTrace, appendEvent, createExecutionTraceService, traceError };