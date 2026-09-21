'use strict';

const {
  TASK_TYPES, RISK_LEVELS, TASK_SCOPES, CAPABILITIES, TASK_STATES, TERMINAL_STATES,
} = require('../../engine/engineeringRouter/constants');

describe('engineeringRouter/constants', () => {
  test('enums são não vazios e congelados', () => {
    expect(TASK_TYPES.length).toBeGreaterThan(0);
    expect(Object.isFrozen(TASK_TYPES)).toBe(true);
    expect(RISK_LEVELS).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    expect(TASK_SCOPES).toEqual(['SMALL', 'MEDIUM', 'LARGE', 'REPOSITORY_WIDE']);
    expect(CAPABILITIES.length).toBeGreaterThanOrEqual(14);
  });

  test('todos os estados terminais pertencem a TASK_STATES', () => {
    for (const s of TERMINAL_STATES) {
      expect(TASK_STATES).toContain(s);
    }
  });
});
