'use strict';

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeReferenceType(value) {
  return String(value || '').trim().toLowerCase();
}

class OutcomeAttributionService {
  resolveFromEvent(event = {}) {
    const payload = safeObject(event.payload);
    const referenceType = normalizeReferenceType(event.referenceType || event.entity_type);
    const referenceId = safeString(event.referenceId || event.entity_id);

    const signalId = this.#resolveSignalId({ payload, referenceType, referenceId });
    const recommendationId = this.#resolveRecommendationId({ payload, referenceType, referenceId });
    const playbookExecutionId = this.#resolvePlaybookExecutionId({ payload, referenceType, referenceId });
    const actionType = this.#resolveActionType({ payload, eventType: event.type || event.event_type });
    const contactId = safeString(event.contactId)
      || safeString(payload.contactId)
      || safeString(payload.contact_id)
      || null;

    let sourceType = safeString(event.sourceType) || null;
    let sourceId = safeString(event.sourceId) || null;

    if (!sourceType || !sourceId) {
      if (playbookExecutionId) {
        sourceType = 'playbook';
        sourceId = playbookExecutionId;
      } else if (recommendationId) {
        sourceType = 'recommendation';
        sourceId = recommendationId;
      } else if (signalId) {
        sourceType = 'signal';
        sourceId = signalId;
      } else {
        sourceType = safeString(referenceType) || 'event';
        sourceId = referenceId || safeString(event.correlationId) || safeString(event.event_id) || null;
      }
    }

    return {
      contactId,
      signalId,
      recommendationId,
      playbookExecutionId,
      actionType,
      sourceType,
      sourceId,
    };
  }

  #resolveSignalId({ payload, referenceType, referenceId }) {
    if (referenceType === 'operational_signal' || referenceType === 'signal') {
      return referenceId;
    }
    return safeString(payload.signalId)
      || safeString(payload.signal_id)
      || safeString(payload.sourceSignalId)
      || safeString(payload.source_signal_id)
      || null;
  }

  #resolveRecommendationId({ payload, referenceType, referenceId }) {
    if (referenceType === 'operational_recommendation' || referenceType === 'recommendation') {
      return referenceId;
    }
    return safeString(payload.recommendationId)
      || safeString(payload.recommendation_id)
      || safeString(payload.sourceRecommendationId)
      || safeString(payload.source_recommendation_id)
      || null;
  }

  #resolvePlaybookExecutionId({ payload, referenceType, referenceId }) {
    if (
      referenceType === 'playbook_run'
      || referenceType === 'playbook'
      || referenceType === 'operational_playbook_execution'
    ) {
      return referenceId;
    }
    return safeString(payload.playbookExecutionId)
      || safeString(payload.playbook_execution_id)
      || safeString(payload.playbookRunId)
      || safeString(payload.playbook_run_id)
      || safeString(payload.executionId)
      || safeString(payload.execution_id)
      || null;
  }

  #resolveActionType({ payload, eventType }) {
    return safeString(payload.actionType)
      || safeString(payload.action_type)
      || safeString(payload.actionId)
      || safeString(payload.action_id)
      || safeString(eventType)
      || null;
  }
}

module.exports = {
  OutcomeAttributionService,
};
