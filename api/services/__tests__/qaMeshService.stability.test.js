'use strict';

const qaMeshService = require('../qaMeshService');

describe('qaMeshService stability+learn accessors', () => {
  test('retorna snapshot de estabilidade com campos principais', () => {
    const snapshot = qaMeshService.getStabilitySnapshot();
    expect(snapshot).toBeTruthy();
    expect(snapshot.global).toBeTruthy();
    expect(snapshot.releaseGate).toBeTruthy();
  });

  test('retorna sumario de learn com estrutura consistente', () => {
    const summary = qaMeshService.getLearnSummary();
    expect(summary).toBeTruthy();
    expect(summary).toHaveProperty('ranked');
    expect(summary).toHaveProperty('suggestions');
    expect(summary).toHaveProperty('plans');
  });
});
