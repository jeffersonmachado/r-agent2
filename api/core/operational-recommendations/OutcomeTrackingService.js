'use strict';

const crypto = require('crypto');
const logger = require('../../utils/logger');
const { OperationalAction } = require('../../db/models');
const { operationalOutcomeEngine } = require('../operational-outcomes');

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildExecutionTrace({ sourceType, sourceId, input }) {
  const inputSafe = safeObject(input);
  const signalId = safeString(
    sourceType === 'signal'
      ? sourceId
      : (inputSafe.signalId || inputSafe.signal_id || inputSafe.sourceSignalId || inputSafe.source_signal_id)
  );
  const recommendationId = safeString(
    sourceType === 'recommendation'
      ? sourceId
      : (inputSafe.recommendationId || inputSafe.recommendation_id || inputSafe.sourceRecommendationId || inputSafe.source_recommendation_id)
  );

  return {
    sourceType: safeString(sourceType),
    sourceId: safeString(sourceId),
    signalId,
    recommendationId,
    playbookRunId: safeString(inputSafe.playbookRunId || inputSafe.playbook_run_id),
    playbookExecutionId: safeString(inputSafe.playbookExecutionId || inputSafe.playbook_execution_id),
    sourceEventId: safeString(inputSafe.sourceEventId || inputSafe.source_event_id || inputSafe.eventId || inputSafe.event_id),
    correlationId: safeString(inputSafe.correlationId || inputSafe.correlation_id || sourceId),
  };
}

class OutcomeTrackingService {
  constructor() {
    this.actionModel = null;
  }

  getModels() {
    if (!this.actionModel) {
      this.actionModel = typeof OperationalAction === 'function' ? OperationalAction() : null;
    }
    return {
      ActionModel: this.actionModel,
    };
  }

  async recordActionExecution({
    tenantId,
    contactId = null,
    sourceType,
    sourceId,
    actionId,
    actorType = 'system',
    actorId = null,
    input = {},
    success = true,
    result = null,
    error = null,
  } = {}) {
    const tenantKey = safeString(tenantId);
    const sourceTypeKey = safeString(sourceType);
    const sourceIdKey = safeString(sourceId);
    const actionIdKey = safeString(actionId);

    if (!tenantKey) return { ok: false, error: 'tenant_required' };
    if (!sourceTypeKey) return { ok: false, error: 'source_type_required' };
    if (!sourceIdKey) return { ok: false, error: 'source_id_required' };
    if (!actionIdKey) return { ok: false, error: 'action_id_required' };

    const { ActionModel } = this.getModels();
    if (!ActionModel) {
      return { ok: false, error: 'operational_action_model_unavailable' };
    }

    if (typeof ActionModel.create !== 'function') {
      return { ok: false, error: 'operational_action_model_invalid' };
    }

    try {
      const executedAt = new Date();
      const trace = buildExecutionTrace({ sourceType: sourceTypeKey, sourceId: sourceIdKey, input });
      const actionRow = await ActionModel.create({
        id: newId('opact'),
        tenant_key: tenantKey,
        contact_id: safeString(contactId),
        source_type: sourceTypeKey,
        source_id: sourceIdKey,
        action_id: actionIdKey,
        actor_type: safeString(actorType) || 'system',
        actor_id: safeString(actorId),
        status: success ? 'executed' : 'failed',
        input_json: {
          ...safeObject(input),
          trace,
        },
        result_json: result && typeof result === 'object' ? result : (result == null ? null : { value: result }),
        error_message: success ? null : (safeString(error) || 'execution_failed'),
        executed_at: executedAt,
      });

      const outcomePayload = {
        actionId: actionRow?.id || null,
        actionType: actionIdKey,
        actorType: safeString(actorType) || 'system',
        actorId: safeString(actorId),
        contactId: safeString(contactId),
        trace,
        result: result && typeof result === 'object' ? result : (result == null ? null : { value: result }),
        error: success ? null : (safeString(error) || 'execution_failed'),
      };
      const outcomeOut = await operationalOutcomeEngine.recordOutcome({
        tenantId: tenantKey,
        contactId: safeString(contactId),
        signalId: trace.signalId,
        recommendationId: trace.recommendationId,
        playbookExecutionId: trace.playbookExecutionId || null,
        sourceType: sourceTypeKey,
        sourceId: sourceIdKey,
        actionId: actionRow?.id || null,
        actionType: actionIdKey,
        outcomeType: success ? 'operational_action_executed' : 'operational_action_failed',
        outcomeScore: success ? 0.8 : 0.2,
        status: success ? 'success' : 'failed',
        producedAt: executedAt,
        resultContext: outcomePayload,
      });
      if (!outcomeOut?.ok) {
        return { ok: false, error: outcomeOut?.error || 'outcome_write_failed' };
      }

      return {
        ok: true,
        action: actionRow && typeof actionRow.toJSON === 'function' ? actionRow.toJSON() : actionRow,
        outcome: outcomeOut.item || null,
      };
    } catch (err) {
      logger.debug('[OutcomeTrackingService] Falha ao registrar outcome (ignorado)', {
        tenantId: tenantKey,
        sourceType: sourceTypeKey,
        sourceId: sourceIdKey,
        actionId: actionIdKey,
        error: err?.message || String(err || 'unknown_error'),
      });
      return { ok: false, error: err?.message || 'outcome_write_failed' };
    }
  }

  async listOutcomes({
    tenantId,
    sourceType = null,
    sourceId = null,
    actionId = null,
    status = null,
    limit = 120,
  } = {}) {
    const tenantKey = safeString(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };

    return operationalOutcomeEngine.listOutcomes({
      tenantId: tenantKey,
      sourceType,
      sourceId,
      actionId,
      status,
      limit,
    });
  }
}

module.exports = {
  OutcomeTrackingService,
};
