'use strict';

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || '';
}

class OperationalPolicyEngine {
  classifySignalDecision(signal, context = {}) {
    const signalType = safeString(signal?.type || signal?.signal_type).toLowerCase();
    const confidence = safeNumber(signal?.confidence, 0.5);
    const priorityScore = safeNumber(context?.priorityScore, 0);

    if (confidence < 0.45 && signalType.includes('channel_attention')) {
      return {
        decisionType: 'manual_review',
        actionMode: 'assisted_execution_only',
      };
    }

    if (priorityScore < 35) {
      return {
        decisionType: 'monitor_only',
        actionMode: 'informational_only',
      };
    }

    if (signalType.includes('missed_revenue') || signalType.includes('support_backlog_risk') || signalType.includes('high_cancel_rate')) {
      return {
        decisionType: 'playbook',
        actionMode: 'human_confirm_required',
      };
    }

    if (signalType.includes('customer_reactivation')) {
      return {
        decisionType: 'quick_action',
        actionMode: 'immediate_operator_action',
      };
    }

    if (priorityScore >= 85) {
      return {
        decisionType: 'playbook',
        actionMode: 'human_confirm_required',
      };
    }

    return {
      decisionType: 'quick_action',
      actionMode: 'human_confirm_required',
    };
  }

  classifyRecommendationDecision(recommendation, context = {}) {
    const recommendationType = safeString(recommendation?.type || recommendation?.recommendation_type).toLowerCase();
    const confidence = safeNumber(recommendation?.confidence, 0.5);
    const priorityScore = safeNumber(context?.priorityScore, 0);
    const impactLevel = safeString(recommendation?.impact_level || recommendation?.impactLevel).toLowerCase();

    if (confidence < 0.45 && recommendationType.includes('channel_attention')) {
      return {
        decisionType: 'manual_review',
        actionMode: 'assisted_execution_only',
      };
    }

    if (priorityScore < 35) {
      return {
        decisionType: 'monitor_only',
        actionMode: 'informational_only',
      };
    }

    if (
      recommendationType.includes('missed_revenue')
      || recommendationType.includes('support_backlog_risk')
      || recommendationType.includes('high_cancel_rate')
      || (priorityScore >= 80 && (impactLevel === 'critical' || impactLevel === 'high'))
    ) {
      return {
        decisionType: 'playbook',
        actionMode: 'human_confirm_required',
      };
    }

    if (
      recommendationType.includes('customer_reactivation')
      || recommendationType.includes('schedule_contact')
      || recommendationType.includes('open_followup')
      || recommendationType.includes('notify_agent')
    ) {
      return {
        decisionType: 'quick_action',
        actionMode: 'immediate_operator_action',
      };
    }

    return {
      decisionType: 'manual_review',
      actionMode: 'assisted_execution_only',
    };
  }
}

module.exports = {
  OperationalPolicyEngine,
};
