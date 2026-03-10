'use strict';

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || '';
}

class OperationalDecisionReasonBuilder {
  buildSignalReason({ signal, priorityScore, decisionType, context = {} }) {
    const severity = safeString(signal?.severity).toLowerCase();
    const signalType = safeString(signal?.type || signal?.signal_type);
    const activePlaybooks = Number(context?.activePlaybookCount || 0);

    if (decisionType === 'monitor_only') {
      return 'Low priority issue; monitor without immediate action.';
    }

    if (decisionType === 'manual_review') {
      return `Low confidence for ${signalType || 'signal'}; manual review recommended.`;
    }

    if (decisionType === 'playbook') {
      if (severity === 'critical' && activePlaybooks <= 0) {
        return 'Critical severity with no active playbook.';
      }
      return 'High operational risk indicates multi-step resolution via playbook.';
    }

    if (signalType.toLowerCase().includes('customer_reactivation')) {
      return 'Customer reactivation signal suitable for immediate quick action.';
    }

    if (priorityScore >= 80) {
      return 'High priority score indicates immediate operator attention.';
    }

    return 'Operational signal classified for quick action with human confirmation.';
  }

  buildRecommendationReason({ recommendation, priorityScore, decisionType, context = {} }) {
    const recommendationType = safeString(recommendation?.type || recommendation?.recommendation_type);
    const activePlaybooks = Number(context?.activePlaybookCount || 0);

    if (decisionType === 'monitor_only') {
      return 'Low-priority recommendation; keep under monitoring.';
    }

    if (decisionType === 'manual_review') {
      return `Low confidence recommendation (${recommendationType || 'operational'}); manual validation required.`;
    }

    if (decisionType === 'playbook') {
      if (activePlaybooks <= 0) {
        return 'High revenue/operational risk and no active action; playbook recommended.';
      }
      return 'Recommendation indicates coordinated multi-step execution.';
    }

    if (priorityScore >= 75) {
      return 'High score recommendation suitable for immediate operator action.';
    }

    return 'Recommendation suitable for controlled quick action.';
  }
}

module.exports = {
  OperationalDecisionReasonBuilder,
};