'use strict';

const {
  REQUIRED_REPLAY_JOURNEYS,
  calculateReplayCoveragePercent,
  hasProvenCrmMutation,
} = require('../../tools/system/platform-readiness');

describe('platform readiness replay coverage', () => {
  test('uses the declared required replay journeys as denominator', () => {
    expect(REQUIRED_REPLAY_JOURNEYS).toHaveLength(8);
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
    expect(calculateReplayCoveragePercent(REQUIRED_REPLAY_JOURNEYS.slice(0, 2))).toBe(25);
  });
});

describe('HARD-028 — hasProvenCrmMutation (prova semântica, não keyword)', () => {
  function smokeWithStep(stepOverrides = {}, flowOverrides = {}) {
    return {
      flows: [{
        journeyId: 'fitness_customer_checkin',
        replay: { status: 'GO' },
        ...flowOverrides,
        steps: [{
          id: 'step_submit_checkin',
          status: 'executed',
          stepExecutionProof: { valid: true },
          mutationLinkage: {
            expectedSideEffects: ['access_decision_created', 'crm_journey_updated'],
            observedSideEffects: ['access_decision_created', 'crm_journey_updated'],
          },
          ...stepOverrides,
        }],
      }],
    };
  }

  test('mutação CRM declarada + observada + proof válido em replay GO → true', () => {
    expect(hasProvenCrmMutation(smokeWithStep())).toBe(true);
  });

  test('declarada mas NÃO observada → false (presence ≠ valid)', () => {
    expect(hasProvenCrmMutation(smokeWithStep({
      mutationLinkage: {
        expectedSideEffects: ['crm_journey_updated'],
        observedSideEffects: ['access_decision_created'],
      },
    }))).toBe(false);
  });

  test('observada mas NÃO declarada no contrato → false', () => {
    expect(hasProvenCrmMutation(smokeWithStep({
      mutationLinkage: {
        expectedSideEffects: ['access_decision_created'],
        observedSideEffects: ['crm_journey_updated'],
      },
    }))).toBe(false);
  });

  test('step proof inválido → false', () => {
    expect(hasProvenCrmMutation(smokeWithStep({ stepExecutionProof: { valid: false } }))).toBe(false);
  });

  test('replay não-GO → false', () => {
    expect(hasProvenCrmMutation(smokeWithStep({}, { replay: { status: 'NO_GO' } }))).toBe(false);
  });

  test('keyword no corpus sem linkage semântico → false', () => {
    expect(hasProvenCrmMutation({ flows: [], raw: 'crm_journey_updated' })).toBe(false);
    expect(hasProvenCrmMutation(null)).toBe(false);
  });
});
