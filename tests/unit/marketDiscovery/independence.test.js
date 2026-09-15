'use strict';

/**
 * Independência: clone/white-label/mesmo grupo econômico NUNCA conta como
 * diversidade real.
 */

const {
  buildEffectiveGroupResolver,
  effectiveGroupsOf,
  independenceReport,
  evaluateDiversityIndependence,
} = require('../../../api/services/marketDiscovery/independence');

function candidate(overrides) {
  return { candidateKey: overrides.candidateKey, ...overrides };
}

describe('independence — clones não são diversidade', () => {
  test('white-label herda o grupo do alvo, mesmo declarando grupo próprio', () => {
    const candidates = [
      candidate({ candidateKey: 'gymnovo', independenceGroup: 'gymnovo' }),
      candidate({ candidateKey: 'gymnovo-wl', independenceGroup: 'grupo-proprio-wl', cloneOf: 'gymnovo' }),
    ];
    const resolve = buildEffectiveGroupResolver(candidates);
    expect(resolve(candidates[1])).toBe('gymnovo');
    expect(effectiveGroupsOf(candidates).size).toBe(1);
  });

  test('mesmo produto base (baseProduct) também colapsa', () => {
    const candidates = [
      candidate({ candidateKey: 'produto-base', independenceGroup: 'base' }),
      candidate({ candidateKey: 'revenda-a', baseProduct: 'produto-base' }),
    ];
    expect(effectiveGroupsOf(candidates).size).toBe(1);
  });

  test('aquisição/mesmo controlador/suíte compartilhada formam UM grupo', () => {
    const candidates = [
      candidate({ candidateKey: 'adquirida', metadata: { acquiredBy: 'big-group' } }),
      candidate({ candidateKey: 'irma', metadata: { parentGroup: 'big-group' } }),
      candidate({ candidateKey: 'suite-a', metadata: { sharedSuite: 'suite-x' } }),
      candidate({ candidateKey: 'suite-b', metadata: { sharedSuite: 'suite-x' } }),
      candidate({ candidateKey: 'independente', independenceGroup: 'solo' }),
    ];
    const report = independenceReport(candidates);
    expect(report.totalCandidates).toBe(5);
    expect(report.independentCount).toBe(3);
    expect(report.independentGroups).toEqual(['big-group', 'solo', 'suite-x']);
  });

  test('cadeia de clones (clone de clone) resolve no grupo raiz', () => {
    const candidates = [
      candidate({ candidateKey: 'raiz', independenceGroup: 'raiz-group' }),
      candidate({ candidateKey: 'meio', cloneOf: 'raiz' }),
      candidate({ candidateKey: 'ponta', cloneOf: 'meio' }),
    ];
    const resolve = buildEffectiveGroupResolver(candidates);
    expect(resolve(candidates[2])).toBe('raiz-group');
    expect(effectiveGroupsOf(candidates).size).toBe(1);
  });

  test('relatório de diversidade reprova universo inflado por clones', () => {
    const candidates = [
      candidate({ candidateKey: 'a', independenceGroup: 'a' }),
      candidate({ candidateKey: 'b', independenceGroup: 'b' }),
      candidate({ candidateKey: 'b-wl-1', cloneOf: 'b' }),
      candidate({ candidateKey: 'b-wl-2', cloneOf: 'b' }),
    ];
    const verdict = evaluateDiversityIndependence(candidates, { minimumIndependentGroups: 3 });
    expect(verdict.status).toBe('FAIL');
    expect(verdict.violations).toEqual([
      { reason: 'independent_groups_below_minimum', distinct: 2, required: 3 },
    ]);
    expect(verdict.report.clones).toHaveLength(2);
  });

  test('universo genuinamente independente passa', () => {
    const candidates = [
      candidate({ candidateKey: 'a', independenceGroup: 'a' }),
      candidate({ candidateKey: 'b', independenceGroup: 'b' }),
      candidate({ candidateKey: 'c', independenceGroup: 'c' }),
    ];
    const verdict = evaluateDiversityIndependence(candidates, { minimumIndependentGroups: 3, minimumIndependentShare: 1 });
    expect(verdict.status).toBe('PASS');
    expect(verdict.report.independentShare).toBe(1);
  });
});
