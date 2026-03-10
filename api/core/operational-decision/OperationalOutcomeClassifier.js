'use strict';

function safeString(value) {
  const out = value == null ? '' : String(value).trim().toLowerCase();
  return out || '';
}

class OperationalOutcomeClassifier {
  classifySignalExpectedOutcome(signal) {
    const signalType = safeString(signal?.type || signal?.signal_type);

    if (signalType.includes('support_backlog_risk')) return 'reduce_backlog';
    if (signalType.includes('missed_revenue')) return 'recover_revenue';
    if (signalType.includes('high_cancel_rate')) return 'recover_revenue';
    if (signalType.includes('customer_reactivation')) return 'reactivate_contact';
    if (signalType.includes('low_occupancy')) return 'fill_schedule';
    if (signalType.includes('channel_attention')) return 'stabilize_channel';
    if (signalType.includes('followup')) return 'followup_completion';
    return 'stabilize_channel';
  }

  classifyRecommendationExpectedOutcome(recommendation) {
    const recommendationType = safeString(recommendation?.type || recommendation?.recommendation_type);

    if (recommendationType.includes('reduce_backlog')) return 'reduce_backlog';
    if (recommendationType.includes('missed_revenue')) return 'recover_revenue';
    if (recommendationType.includes('high_cancel_rate')) return 'recover_revenue';
    if (recommendationType.includes('customer_reactivation')) return 'reactivate_contact';
    if (recommendationType.includes('schedule')) return 'fill_schedule';
    if (recommendationType.includes('channel')) return 'stabilize_channel';
    if (recommendationType.includes('followup')) return 'followup_completion';
    return 'stabilize_channel';
  }
}

module.exports = {
  OperationalOutcomeClassifier,
};