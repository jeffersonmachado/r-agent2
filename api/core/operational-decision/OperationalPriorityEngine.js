'use strict';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function getAgeHours(value) {
  if (!value) return 0;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 0;
  const diffMs = Date.now() - parsed.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 0;
  return diffMs / (1000 * 60 * 60);
}

function severityPoints(severity) {
  const normalized = String(severity || '').toLowerCase();
  if (normalized === 'critical') return 40;
  if (normalized === 'high') return 30;
  if (normalized === 'medium') return 20;
  return 10;
}

function impactPoints(impactLevel) {
  const normalized = String(impactLevel || '').toLowerCase();
  if (normalized === 'critical') return 30;
  if (normalized === 'high') return 24;
  if (normalized === 'medium') return 16;
  return 8;
}

function urgencyPoints(ageHours) {
  if (ageHours >= 72) return 25;
  if (ageHours >= 24) return 18;
  if (ageHours >= 6) return 10;
  return 5;
}

function typeImpactPoints(typeKey) {
  const normalized = String(typeKey || '').toLowerCase();
  if (normalized.includes('support_backlog_risk')) return 20;
  if (normalized.includes('missed_revenue')) return 20;
  if (normalized.includes('high_cancel_rate')) return 18;
  if (normalized.includes('low_occupancy')) return 14;
  if (normalized.includes('customer_reactivation')) return 12;
  if (normalized.includes('channel_attention')) return 8;
  return 10;
}

function revenueRiskPoints(typeKey, context = {}) {
  const normalized = String(typeKey || '').toLowerCase();
  const contextRisk = safeNumber(context?.revenueRiskScore, Number.NaN);
  if (Number.isFinite(contextRisk)) {
    return clamp(Math.round(contextRisk), 0, 20);
  }

  if (normalized.includes('missed_revenue')) return 20;
  if (normalized.includes('high_cancel_rate')) return 14;
  if (normalized.includes('low_occupancy')) return 12;
  if (normalized.includes('customer_reactivation')) return 10;
  return 4;
}

function existingActionPenalty(context = {}) {
  const activePlaybookCount = safeNumber(context?.activePlaybookCount, 0);
  const hasActiveAction = context?.hasActiveAction === true;
  if (activePlaybookCount > 0 || hasActiveAction) return -15;
  return 0;
}

class OperationalPriorityEngine {
  scoreSignal(signal, context = {}) {
    const signalType = safeString(signal?.type || signal?.signal_type);
    const ageHours = getAgeHours(signal?.detected_at || signal?.created_at);

    const breakdown = {
      severity: severityPoints(signal?.severity),
      urgency: urgencyPoints(ageHours),
      impact: typeImpactPoints(signalType),
      revenueRisk: revenueRiskPoints(signalType, context),
      existingActionPenalty: existingActionPenalty(context),
    };

    const priorityScore = clamp(
      breakdown.severity
      + breakdown.urgency
      + breakdown.impact
      + breakdown.revenueRisk
      + breakdown.existingActionPenalty,
      0,
      100,
    );

    return {
      priorityScore,
      scoreBreakdown: breakdown,
    };
  }

  scoreRecommendation(recommendation, context = {}) {
    const recommendationType = safeString(recommendation?.type || recommendation?.recommendation_type);
    const ageHours = getAgeHours(recommendation?.created_at || recommendation?.updated_at);
    const confidence = clamp(safeNumber(recommendation?.confidence, 0.5), 0, 1);
    const normalizedPriority = clamp(safeNumber(recommendation?.priority, 50), 0, 100);

    const breakdown = {
      severity: impactPoints(recommendation?.impact_level || recommendation?.impactLevel),
      urgency: urgencyPoints(ageHours),
      impact: clamp(Math.round((normalizedPriority / 100) * 25), 0, 25),
      revenueRisk: revenueRiskPoints(recommendationType, {
        revenueRiskScore: safeNumber(context?.revenueRiskScore, Number.NaN),
      }),
      existingActionPenalty: existingActionPenalty(context),
    };

    const confidenceAdjustment = clamp(Math.round((confidence - 0.5) * 10), -5, 5);

    const priorityScore = clamp(
      breakdown.severity
      + breakdown.urgency
      + breakdown.impact
      + breakdown.revenueRisk
      + breakdown.existingActionPenalty
      + confidenceAdjustment,
      0,
      100,
    );

    return {
      priorityScore,
      scoreBreakdown: breakdown,
    };
  }
}

module.exports = {
  OperationalPriorityEngine,
};
