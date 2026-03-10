'use strict';

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toLower(value) {
  return String(value || '').trim().toLowerCase();
}

class OutcomeClassifier {
  classifyEvent(event = {}) {
    const eventType = toLower(event.type || event.event_type);
    const payload = safeObject(event.payload);

    if (!eventType) {
      return { shouldRecord: false, reason: 'event_type_required' };
    }

    if (eventType === 'operational_playbook_completed') {
      return {
        shouldRecord: true,
        outcomeType: 'playbook_completed',
        status: 'success',
        outcomeScore: 0.92,
      };
    }

    if (eventType === 'operational_playbook_aborted') {
      return {
        shouldRecord: true,
        outcomeType: 'playbook_aborted',
        status: 'failed',
        outcomeScore: 0.15,
      };
    }

    if (eventType === 'operational_signal_resolved') {
      return {
        shouldRecord: true,
        outcomeType: 'manual_resolution',
        status: 'success',
        outcomeScore: 0.88,
      };
    }

    if (eventType === 'operational_recommendation_executed') {
      return {
        shouldRecord: true,
        outcomeType: 'recommendation_executed',
        status: 'success',
        outcomeScore: 0.84,
      };
    }

    if (eventType === 'operational_recommendation_accepted') {
      return {
        shouldRecord: true,
        outcomeType: 'recommendation_accepted',
        status: 'success',
        outcomeScore: 0.7,
      };
    }

    if (eventType === 'operational_recommendation_ignored') {
      return {
        shouldRecord: true,
        outcomeType: 'recommendation_ignored',
        status: 'failed',
        outcomeScore: 0.2,
      };
    }

    if (eventType === 'operational_quick_action_executed') {
      if (payload.outcomeTracked === true) {
        return { shouldRecord: false, reason: 'already_tracked' };
      }
      return {
        shouldRecord: true,
        outcomeType: 'quick_action_executed',
        status: 'success',
        outcomeScore: 0.8,
      };
    }

    if (eventType === 'operational_quick_action_failed') {
      if (payload.outcomeTracked === true) {
        return { shouldRecord: false, reason: 'already_tracked' };
      }
      return {
        shouldRecord: true,
        outcomeType: 'quick_action_failed',
        status: 'failed',
        outcomeScore: 0.2,
      };
    }

    const revenueHint = /(revenue|faturamento|receita)/.test(eventType)
      && /(recover|recovered|recovery|recuper)/.test(eventType);
    if (revenueHint) {
      return {
        shouldRecord: true,
        outcomeType: 'revenue_recovered',
        status: 'success',
        outcomeScore: 0.97,
      };
    }

    const bookingHint = /(booking|appointment|schedule|agendamento)/.test(eventType)
      && /(created|booked|confirmed|scheduled|criado|confirmado)/.test(eventType);
    const hasRecommendationLink = Boolean(
      safeString(payload.recommendationId)
      || safeString(payload.recommendation_id)
      || safeString(payload.sourceRecommendationId)
      || safeString(payload.source_recommendation_id)
      || safeString(payload.recommendationRef)
    );
    if (bookingHint && hasRecommendationLink) {
      return {
        shouldRecord: true,
        outcomeType: 'booking_created_after_recommendation',
        status: 'success',
        outcomeScore: 0.94,
      };
    }

    return { shouldRecord: false, reason: 'event_not_mapped' };
  }
}

module.exports = {
  OutcomeClassifier,
};
