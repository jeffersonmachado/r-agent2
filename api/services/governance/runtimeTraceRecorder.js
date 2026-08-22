'use strict';

/**
 * runtimeTraceRecorder — ponte do RUNTIME para o control plane de certificação.
 *
 * O Cognitive Orchestrator já emite eventos causais (eventId, parentEventId,
 * causationId, runId, correlationId, executionId, criticalJourneyId) para o
 * Event Ledger. Este módulo espelha, best-effort, os eventos de jornada crítica
 * em ExecutionTrace + ExecutionTraceEvent, para que o validator apenas CONSULTE
 * causalidade produzida pelo runtime — nunca a invente.
 *
 * Toda falha aqui é registrada como warn e NUNCA propaga para o fluxo de negócio.
 */

const { getSequelize } = require('../../db/sequelize');
const getTrace = require('../../db/models/ExecutionTrace');
const getEvent = require('../../db/models/ExecutionTraceEvent');

function defaultLogger() {
  try {
    return require('../../utils/logger');
  } catch (_) {
    return { warn: () => {}, info: () => {}, error: () => {} };
  }
}

async function findOrCreateTrace({ runId, traceType, correlationId, executionId, tenantId, principalId, sourceFingerprint }) {
  const Trace = getTrace();
  const existing = await Trace.findOne({ where: { run_id: runId, correlation_id: correlationId } });
  if (existing) return existing;
  return Trace.create({
    run_id: runId,
    trace_type: traceType || 'CRITICAL_JOURNEY',
    critical_journey_id: null,
    correlation_id: correlationId,
    execution_id: executionId || null,
    tenant_id: tenantId || null,
    principal_id: principalId || null,
    status: 'RUNNING',
    started_at: new Date(),
    source_fingerprint: sourceFingerprint || null,
    metadata: { producer: 'runtime:cognitive-core' },
  });
}

async function recordCriticalEvent(input) {
  const sequelize = getSequelize();
  if (!sequelize) return null;
  const log = defaultLogger();
  const { runId, correlationId, criticalJourneyId } = input;
  if (!runId || !correlationId) return null;

  try {
    const trace = await findOrCreateTrace({
      runId,
      traceType: 'CRITICAL_JOURNEY',
      correlationId,
      executionId: input.executionId,
      tenantId: input.tenantId,
      principalId: input.principalId,
      sourceFingerprint: input.sourceFingerprint,
    });
    if (criticalJourneyId && !trace.critical_journey_id) {
      await trace.update({ critical_journey_id: criticalJourneyId });
    }
    return await getEvent().create({
      trace_id: trace.id,
      event_id: input.eventId || `evt-${require('crypto').randomUUID()}`,
      parent_event_id: input.parentEventId || null,
      causation_id: input.causationId || null,
      producer: input.producer || 'runtime:cognitive-core',
      event_type: input.type || 'cognitive.event',
      entity_type: input.subject?.type || null,
      entity_id: input.subject?.id || null,
      occurred_at: input.occurredAt || new Date(),
      evidence_id: input.evidenceId || null,
      payload_jsonb: { ...(input.payload || {}), correlationId, executionId: input.executionId },
    });
  } catch (error) {
    log.warn('[runtimeTraceRecorder] mirror failed (best-effort)', { runId, correlationId, error: error.message });
    return null;
  }
}

module.exports = { recordCriticalEvent, findOrCreateTrace };
