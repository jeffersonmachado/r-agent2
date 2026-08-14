'use strict';

const {
  REQUIRED_REPLAY_JOURNEYS,
  calculateReplayCoveragePercent,
} = require('../../tools/system/platform-readiness');

describe('platform readiness replay coverage', () => {
  test('uses the declared required replay journeys as denominator', () => {
    expect(REQUIRED_REPLAY_JOURNEYS).toHaveLength(7);
    expect(calculateReplayCoveragePercent(REQUIRED_REPLAY_JOURNEYS)).toBe(100);
  });

  test('never exceeds 100 for duplicates or unknown journeys', () => {
    expect(calculateReplayCoveragePercent([
      ...REQUIRED_REPLAY_JOURNEYS,
      ...REQUIRED_REPLAY_JOURNEYS,
      'unknown-extra-journey',
    ])).toBe(100);
  });

  test('reports partial coverage against the same canonical set', () => {
    expect(calculateReplayCoveragePercent(REQUIRED_REPLAY_JOURNEYS.slice(0, 2))).toBe(28.57);
  });
});
