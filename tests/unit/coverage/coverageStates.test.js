'use strict';

const {
  COVERAGE_STATES,
  COUNTS_AS_VISITED,
  COUNTS_AS_VALIDATED,
  resolveItemState,
} = require('../../../qa/coverage/coverageStates');

describe('coverage/coverageStates', () => {
  test('enum contém todos os estados formais', () => {
    expect(Object.values(COVERAGE_STATES).sort()).toEqual([
      'BLOCKED', 'FAILED', 'NOT_APPLICABLE', 'ORPHANED',
      'REVALIDATION_REQUIRED', 'STALE', 'UNCOVERED', 'VALIDATED', 'VISITED',
    ].sort());
  });

  test('precedência: NOT_APPLICABLE vence tudo', () => {
    expect(resolveItemState({ notApplicable: true, executed: true, assertionsPassed: 1, assertionsTotal: 1, stale: true, orphaned: true, blocked: true }))
      .toBe(COVERAGE_STATES.NOT_APPLICABLE);
  });

  test('precedência: ORPHANED > STALE > BLOCKED > FAILED', () => {
    expect(resolveItemState({ orphaned: true, stale: true, blocked: true, executed: true, assertionsPassed: 0, assertionsTotal: 2 }))
      .toBe(COVERAGE_STATES.ORPHANED);
    expect(resolveItemState({ stale: true, blocked: true, executed: true, assertionsPassed: 0, assertionsTotal: 2 }))
      .toBe(COVERAGE_STATES.STALE);
    expect(resolveItemState({ blocked: true, executed: true, assertionsPassed: 0, assertionsTotal: 2 }))
      .toBe(COVERAGE_STATES.BLOCKED);
  });

  test('FAILED quando executado com divergência', () => {
    expect(resolveItemState({ executed: true, assertionsPassed: 1, assertionsTotal: 2 }))
      .toBe(COVERAGE_STATES.FAILED);
  });

  test('VALIDATED quando executado e todas as assertivas passaram', () => {
    expect(resolveItemState({ executed: true, assertionsPassed: 3, assertionsTotal: 3 }))
      .toBe(COVERAGE_STATES.VALIDATED);
  });

  test('VISITED quando executado sem validação completa', () => {
    expect(resolveItemState({ executed: true })).toBe(COVERAGE_STATES.VISITED);
    expect(resolveItemState({ executed: true, assertionsPassed: 0, assertionsTotal: 0 }))
      .toBe(COVERAGE_STATES.VISITED);
  });

  test('UNCOVERED quando nunca executado', () => {
    expect(resolveItemState({})).toBe(COVERAGE_STATES.UNCOVERED);
    expect(resolveItemState()).toBe(COVERAGE_STATES.UNCOVERED);
  });

  test('contagens: visited = VISITED|VALIDATED|FAILED; validated = apenas VALIDATED', () => {
    expect(COUNTS_AS_VISITED).toEqual([
      COVERAGE_STATES.VISITED,
      COVERAGE_STATES.VALIDATED,
      COVERAGE_STATES.FAILED,
    ]);
    expect(COUNTS_AS_VALIDATED).toEqual([COVERAGE_STATES.VALIDATED]);
  });
});
