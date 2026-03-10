'use strict';

const {
  listSuggestedActionsForSignal,
  recommendationTypeForSignal,
  recommendationDescriptionForType,
} = require('./RecommendationCatalog');

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function normalizeSeverity(value) {
  const normalized = String(value || 'medium').trim().toLowerCase();
  if (['low', 'medium', 'high', 'critical'].includes(normalized)) return normalized;
  return 'medium';
}

function priorityFromSeverity(severity) {
  const map = { low: 30, medium: 55, high: 78, critical: 92 };
  return map[normalizeSeverity(severity)] || 55;
}

function impactFromSeverity(severity) {
  const map = { low: 'low', medium: 'medium', high: 'high', critical: 'critical' };
  return map[normalizeSeverity(severity)] || 'medium';
}

function normalizeConfidence(value, fallback = 0.6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function buildRecommendationFromSignal(signal = {}) {
  const signalType = safeString(signal?.type) || 'channel_attention';
  const severity = normalizeSeverity(signal?.severity);
  const recommendationType = recommendationTypeForSignal(signalType);
  const suggestedActionIds = listSuggestedActionsForSignal(signalType);

  return {
    type: recommendationType,
    priority: priorityFromSeverity(severity),
    confidence: normalizeConfidence(signal?.confidence, 0.6),
    impactLevel: impactFromSeverity(severity),
    targetModule: String(signal?.source_module || signal?.sourceModule || 'support').trim() || 'support',
    description: recommendationDescriptionForType(recommendationType),
    suggestedActions: suggestedActionIds.map((actionId) => ({
      action: actionId,
      sourceSignalType: signalType,
      severity,
    })),
    context: {
      severity,
      signalContext: signal?.context_json || signal?.context || {},
      sourceModule: signal?.source_module || signal?.sourceModule || 'operational_agent',
    },
    sourceSignalId: safeString(signal?.id),
    sourceSignalType: signalType,
    tenantId: safeString(signal?.tenant_id || signal?.tenantId),
    contactId: safeString(signal?.contact_id || signal?.contactId),
  };
}

module.exports = {
  buildRecommendationFromSignal,
};
