'use strict';

const { getPolicy, requiresIndependentReview, resolveMaxIterations, POLICY_VERSION } = require('../../engine/engineeringRouter/routingPolicy');
const { TASK_TYPES } = require('../../engine/engineeringRouter/constants');

describe('engineeringRouter/routingPolicy', () => {
  test('toda taskType do vocabulário tem uma policy definida', () => {
    for (const t of TASK_TYPES) {
      expect(() => getPolicy(t)).not.toThrow();
    }
  });

  test('policy carrega policyVersion', () => {
    expect(getPolicy('BUG_FIX').policyVersion).toBe(POLICY_VERSION);
  });

  test('SECURITY_REVIEW e COMPLEX_BUG_FIX sempre exigem review independente', () => {
    expect(requiresIndependentReview('SECURITY_REVIEW', 'LOW')).toBe(true);
    expect(requiresIndependentReview('COMPLEX_BUG_FIX', 'LOW')).toBe(true);
  });

  test('BUG_FIX exige independência apenas por risco HIGH/CRITICAL', () => {
    expect(requiresIndependentReview('BUG_FIX', 'LOW')).toBe(false);
    expect(requiresIndependentReview('BUG_FIX', 'MEDIUM')).toBe(false);
    expect(requiresIndependentReview('BUG_FIX', 'HIGH')).toBe(true);
    expect(requiresIndependentReview('BUG_FIX', 'CRITICAL')).toBe(true);
  });

  test('TEST_GENERATION e REPOSITORY_AUDIT nunca exigem independência', () => {
    expect(requiresIndependentReview('TEST_GENERATION', 'CRITICAL')).toBe(false);
    expect(requiresIndependentReview('REPOSITORY_AUDIT', 'CRITICAL')).toBe(false);
  });

  test('resolveMaxIterations respeita override do Task Contract', () => {
    expect(resolveMaxIterations('BUG_FIX', 7)).toBe(7);
    expect(resolveMaxIterations('BUG_FIX', 0)).toBe(getPolicy('BUG_FIX').defaultMaxIterations);
    expect(resolveMaxIterations('BUG_FIX', undefined)).toBe(getPolicy('BUG_FIX').defaultMaxIterations);
  });
});
