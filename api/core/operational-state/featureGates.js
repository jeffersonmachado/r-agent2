'use strict';

const tenantFeatureService = require('../../services/tenantFeatureService');

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

async function isOperationalFeatureEnabled(tenantId, featureKey, fallback = false) {
  const safeFallback = normalizeBoolean(fallback, false);
  if (!tenantId || !featureKey) return safeFallback;

  try {
    return await tenantFeatureService.isEnabled(String(tenantId), String(featureKey), safeFallback);
  } catch (_) {
    return safeFallback;
  }
}

module.exports = {
  isOperationalFeatureEnabled,
};
