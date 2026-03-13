// Phase 9 prep: centralizes optional advanced BPMN capabilities behind explicit flags.
// Default remains MVP-only to guarantee backwards-compatible behavior.

export const BPMN_FEATURE_FLAGS = Object.freeze({
  ADVANCED_GATEWAYS: false,
  POOLS_AND_LANES: true,
  MESSAGE_FLOW: true,
  BOUNDARY_EVENTS: true,
  EXPANDED_SUBPROCESS: false,
  BPMN_DI: true,
});

export function getBpmnFeatureFlags(overrides = {}) {
  return Object.freeze({
    ...BPMN_FEATURE_FLAGS,
    ...(overrides && typeof overrides === 'object' ? overrides : {}),
  });
}

export function isBpmnFeatureEnabled(featureName, overrides = {}) {
  const flags = getBpmnFeatureFlags(overrides);
  const key = String(featureName || '').trim();
  return flags[key] === true;
}
