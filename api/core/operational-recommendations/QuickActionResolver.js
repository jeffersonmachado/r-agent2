'use strict';

const { listSuggestedActionsForSignal } = require('./RecommendationCatalog');

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

class QuickActionResolver {
  resolveSuggestedActions({ signal, recommendationType, suggestedActions = [] } = {}) {
    const signalType = safeString(signal?.type || signal?.source_signal_type || signal?.sourceSignalType);
    const severity = safeString(signal?.severity) || 'medium';
    const recommended = Array.isArray(suggestedActions) && suggestedActions.length > 0
      ? suggestedActions
      : listSuggestedActionsForSignal(signalType);

    return recommended
      .map((item) => {
        if (typeof item === 'string') {
          const action = safeString(item);
          return action
            ? {
              action,
              sourceSignalType: signalType,
              severity,
              recommendationType: safeString(recommendationType),
            }
            : null;
        }

        if (!item || typeof item !== 'object') return null;
        const action = safeString(item.action || item.id || item.type);
        if (!action) return null;

        return {
          ...item,
          action,
          sourceSignalType: safeString(item.sourceSignalType || item.source_signal_type) || signalType,
          severity: safeString(item.severity) || severity,
          recommendationType: safeString(item.recommendationType || item.recommendation_type) || safeString(recommendationType),
        };
      })
      .filter(Boolean);
  }
}

module.exports = {
  QuickActionResolver,
};
