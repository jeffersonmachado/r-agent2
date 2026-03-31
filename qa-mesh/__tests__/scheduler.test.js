'use strict';

const { selectScenariosForSchedule } = require('../meshScheduler');

describe('qa-mesh/meshScheduler', () => {
  const registry = [
    { id: 'smoke-core', type: 'smoke', criticality: 'blocking' },
    { id: 'regression-beauty', type: 'regression', criticality: 'medium' },
    { id: 'technical-pbx', type: 'technical', criticality: 'blocking' },
  ];

  test('seleciona apenas smoke para schedule smoke', () => {
    expect(selectScenariosForSchedule('smoke', registry).map((item) => item.id)).toEqual(['smoke-core']);
  });

  test('seleciona apenas blocking para schedule critical', () => {
    expect(selectScenariosForSchedule('critical', registry).map((item) => item.id)).toEqual([
      'smoke-core',
      'technical-pbx',
    ]);
  });

  test('regression executa toda a malha', () => {
    expect(selectScenariosForSchedule('regression', registry).map((item) => item.id)).toEqual([
      'smoke-core',
      'regression-beauty',
      'technical-pbx',
    ]);
  });
});
