'use strict';

const {
  visitedCoverage,
  validatedCoverage,
  successRate,
  weightedCoverage,
  dimensionCoverage,
  criticalSummary,
  waveScore,
  DEFAULT_WAVE_WEIGHTS,
  WAVE_WEIGHT_PRESETS,
} = require('../../../qa/coverage/coverageCalculator');

const S = {
  UNCOVERED: 'UNCOVERED',
  VISITED: 'VISITED',
  VALIDATED: 'VALIDATED',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
  STALE: 'STALE',
  ORPHANED: 'ORPHANED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
};

describe('coverage/coverageCalculator', () => {
  test('visited ≠ validated ≠ successRate: falha aumenta visited, não validated, diminui successRate', () => {
    const items = [
      { id: 'i1', state: S.VALIDATED, criticality: 'NORMAL', dimension: 'apis' },
      { id: 'i2', state: S.FAILED, criticality: 'NORMAL', dimension: 'apis' },
      { id: 'i3', state: S.UNCOVERED, criticality: 'NORMAL', dimension: 'apis' },
    ];
    // 2/3 visitados (VALIDATED + FAILED), 1/3 validados.
    expect(visitedCoverage(items)).toBe(66.7);
    expect(validatedCoverage(items)).toBe(33.3);
    // Execução com falha: 1 passed + 1 failed → 50%; sem a falha seria 100%.
    expect(successRate([{ status: 'passed' }, { status: 'failed' }])).toBe(50);
    expect(successRate([{ status: 'passed' }])).toBe(100);
  });

  test('NOT_APPLICABLE não é elegível; sem elegíveis retorna 100', () => {
    const items = [
      { id: 'i1', state: S.NOT_APPLICABLE, criticality: 'NORMAL', dimension: 'apis' },
      { id: 'i2', state: S.VALIDATED, criticality: 'NORMAL', dimension: 'apis' },
    ];
    expect(visitedCoverage(items)).toBe(100);
    expect(validatedCoverage(items)).toBe(100);
    expect(visitedCoverage([{ id: 'x', state: S.NOT_APPLICABLE }])).toBe(100);
    expect(validatedCoverage([])).toBe(100);
  });

  test('successRate ignora skipped/queued', () => {
    expect(successRate([
      { status: 'passed' },
      { status: 'failed' },
      { status: 'skipped' },
      { status: 'queued' },
    ])).toBe(50);
  });

  test('cobertura ponderada: falha em CRITICAL derruba mais que falha em NORMAL', () => {
    const base = [
      { id: 'c1', state: S.FAILED, criticality: 'CRITICAL', dimension: 'apis' },
      { id: 'n1', state: S.VALIDATED, criticality: 'NORMAL', dimension: 'apis' },
      { id: 'n2', state: S.VALIDATED, criticality: 'NORMAL', dimension: 'apis' },
    ];
    const compare = [
      { id: 'c1', state: S.VALIDATED, criticality: 'CRITICAL', dimension: 'apis' },
      { id: 'n1', state: S.FAILED, criticality: 'NORMAL', dimension: 'apis' },
      { id: 'n2', state: S.VALIDATED, criticality: 'NORMAL', dimension: 'apis' },
    ];
    // Falha no CRITICAL: (1+1)/(5+1+1) = 2/7 = 28.6
    expect(weightedCoverage(base)).toBe(28.6);
    // Falha no NORMAL: (5+1)/7 = 6/7 = 85.7
    expect(weightedCoverage(compare)).toBe(85.7);
    expect(weightedCoverage(base)).toBeLessThan(weightedCoverage(compare));
    // Criticidade desconhecida cai no peso NORMAL.
    expect(weightedCoverage([{ id: 'x', state: S.VALIDATED, criticality: 'WEIRD' }])).toBe(100);
  });

  test('dimensionCoverage separada por dimensão', () => {
    const items = [
      { id: 'j1', state: S.VALIDATED, criticality: 'NORMAL', dimension: 'journeys' },
      { id: 'a1', state: S.FAILED, criticality: 'NORMAL', dimension: 'apis' },
      { id: 'a2', state: S.UNCOVERED, criticality: 'NORMAL', dimension: 'apis' },
    ];
    const byDim = dimensionCoverage(items);
    expect(byDim.journeys.validated).toBe(100);
    expect(byDim.apis.visited).toBe(50);
    expect(byDim.apis.validated).toBe(0);
    expect(byDim.apis.eligible).toBe(2);
    expect(byDim.apis.total).toBe(2);
  });

  test('criticalSummary conta apenas CRITICAL', () => {
    const items = [
      { id: '1', state: S.UNCOVERED, criticality: 'CRITICAL' },
      { id: '2', state: S.FAILED, criticality: 'CRITICAL' },
      { id: '3', state: S.STALE, criticality: 'CRITICAL' },
      { id: '4', state: S.ORPHANED, criticality: 'CRITICAL' },
      { id: '5', state: S.UNCOVERED, criticality: 'NORMAL' },
      { id: '6', state: S.FAILED, criticality: 'HIGH' },
    ];
    expect(criticalSummary(items)).toEqual({ uncovered: 1, failed: 1, stale: 1, orphaned: 1 });
  });

  test('waveScore com pesos default consolida grupos presentes', () => {
    const items = [
      { id: 'j1', state: S.VALIDATED, criticality: 'NORMAL', dimension: 'journeys' },
      { id: 'p1', state: S.FAILED, criticality: 'NORMAL', dimension: 'paths' },
      { id: 'p2', state: S.VALIDATED, criticality: 'NORMAL', dimension: 'transitions' },
    ];
    // journeys=100, pathsTransitions=50 → (0.4*100 + 0.2*50) / 0.6 = 83.3
    expect(waveScore(dimensionCoverage(items))).toBe(83.3);
  });

  test('waveScore com presets: database-integrity pesa mais models', () => {
    const items = [
      { id: 'm1', state: S.FAILED, criticality: 'NORMAL', dimension: 'models' },
      { id: 'j1', state: S.VALIDATED, criticality: 'NORMAL', dimension: 'journeys' },
    ];
    const dims = dimensionCoverage(items);
    const dbScore = waveScore(dims, 'database-integrity');
    const bizScore = waveScore(dims, 'business-journey');
    // Modelo falhado pesa muito mais no preset de integridade de banco.
    expect(dbScore).toBeLessThan(bizScore);
    // database-integrity: (0.45*0 + 0.2*100) / 0.65 = 30.8
    expect(dbScore).toBe(30.8);
    // security mapeia autorização/isolamento ao grupo apisContracts.
    const secItems = [
      { id: 's1', state: S.VALIDATED, criticality: 'NORMAL', dimension: 'authorization' },
    ];
    expect(waveScore(dimensionCoverage(secItems), 'security')).toBe(100);
    expect(WAVE_WEIGHT_PRESETS['business-journey']).toEqual(DEFAULT_WAVE_WEIGHTS);
  });

  test('waveScore sem grupos elegíveis retorna 100', () => {
    expect(waveScore({})).toBe(100);
  });
});
