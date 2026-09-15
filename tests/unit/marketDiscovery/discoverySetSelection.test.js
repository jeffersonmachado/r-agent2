'use strict';

/**
 * Seleção do Discovery Set: determinismo, cobertura de arquétipos,
 * independência (clone não pontua como grupo novo) e rationale auditável.
 */

const {
  SELECTION_WEIGHTS,
  selectDiscoverySet,
  selectHoldout,
} = require('../../../api/services/marketDiscovery/discoverySetSelection');

function candidate(overrides) {
  return {
    candidateKey: overrides.candidateKey,
    archetypes: [],
    segments: [],
    targetCustomers: [],
    profile: null,
    ...overrides,
  };
}

const POOL = [
  candidate({
    candidateKey: 'alpha',
    archetypes: ['independent-gym'],
    country: 'BR',
    segments: ['rede'],
    independenceGroup: 'alpha',
    profile: { dimensions: { operationalDepth: 'high', financialDepth: 'high', customerEngagementDepth: 'medium', integrationMaturity: 'high' } },
  }),
  candidate({
    candidateKey: 'beta',
    archetypes: ['financial-billing'],
    country: 'BR',
    independenceGroup: 'beta',
    profile: { dimensions: { operationalDepth: 'medium', financialDepth: 'high', customerEngagementDepth: 'low', integrationMaturity: 'low' } },
  }),
  candidate({
    candidateKey: 'gamma',
    archetypes: ['student-digital-experience'],
    country: 'US',
    targetCustomers: ['small'],
    independenceGroup: 'gamma',
    profile: { dimensions: { operationalDepth: 'low', financialDepth: 'low', customerEngagementDepth: 'high', integrationMaturity: 'medium' } },
  }),
  // White-label de gamma: MESMO grupo efetivo — não pode pontuar independência.
  candidate({ candidateKey: 'gamma-wl', archetypes: ['student-digital-experience'], country: 'US', cloneOf: 'gamma', independenceGroup: 'grupo-falso' }),
];

describe('discoverySetSelection — seleção determinística', () => {
  test('o mesmo universo produz SEMPRE o mesmo set e a mesma ordem', () => {
    const a = selectDiscoverySet({ candidates: POOL, acceptedArchetypeKeys: ['independent-gym', 'financial-billing', 'student-digital-experience'], size: 3 });
    const b = selectDiscoverySet({ candidates: [...POOL].reverse(), acceptedArchetypeKeys: ['independent-gym', 'financial-billing', 'student-digital-experience'], size: 3 });
    expect(a.selected).toEqual(b.selected);
    expect(a.rationale).toEqual(b.rationale);
  });

  test('prioriza cobertura de arquétipo e independência; clone perde para grupo novo', () => {
    const { selected, rationale, policy } = selectDiscoverySet({
      candidates: POOL,
      acceptedArchetypeKeys: ['independent-gym', 'financial-billing', 'student-digital-experience'],
      size: 3,
    });

    expect(selected).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma']));
    expect(selected).not.toContain('gamma-wl'); // clone nunca entra por "diversidade"
    expect(policy.weights).toEqual(SELECTION_WEIGHTS);
    expect(policy.independentGroupsCovered).toBe(3);

    // Cada seleção carrega breakdown auditável por dimensão.
    const first = rationale[0];
    expect(first.order).toBe(1);
    expect(first.breakdown.map((d) => d.dimension)).toContain('archetypeCoverage');
    expect(first.breakdown.map((d) => d.dimension)).toContain('independence');
  });

  test('arquétipo NÃO aceito (sem evidência) não pontua cobertura', () => {
    const pool = [
      candidate({ candidateKey: 'claims-new-archetype', archetypes: ['arquétipo-inventado'], independenceGroup: 'x' }),
      candidate({ candidateKey: 'plain', archetypes: ['independent-gym'], independenceGroup: 'y' }),
    ];
    const { rationale } = selectDiscoverySet({ candidates: pool, acceptedArchetypeKeys: ['independent-gym'], size: 1 });
    const claimed = rationale.find((r) => r.candidateKey === 'claims-new-archetype');
    const plain = rationale.find((r) => r.candidateKey === 'plain');
    // 'arquétipo-inventado' não está entre os ACCEPTED → sem pontos de cobertura.
    if (claimed) {
      expect(claimed.breakdown.find((d) => d.dimension === 'archetypeCoverage')).toBeUndefined();
    }
    expect(plain.breakdown.find((d) => d.dimension === 'archetypeCoverage')).toBeDefined();
  });

  test('excluídos e não-selecionados ficam auditáveis', () => {
    const { excluded } = selectDiscoverySet({ candidates: POOL, size: 2 });
    expect(excluded).toHaveLength(2);
    for (const item of excluded) {
      expect(item.reason).toBe('not_selected_by_score');
    }
  });
});

describe('discoverySetSelection — holdout antes da pesquisa profunda', () => {
  test('o holdout maximiza distância do set e NUNCA pertence a ele', () => {
    const { selected } = selectDiscoverySet({
      candidates: POOL,
      acceptedArchetypeKeys: ['independent-gym', 'financial-billing', 'student-digital-experience'],
      size: 2,
    });
    const { holdoutKey, basis } = selectHoldout({
      candidates: POOL,
      selectedKeys: selected,
      acceptedArchetypeKeys: ['independent-gym', 'financial-billing', 'student-digital-experience'],
    });

    expect(holdoutKey).toBeTruthy();
    expect(selected).not.toContain(holdoutKey);
    expect(basis.reason).toMatch(/distância|distance/i);
    expect(basis.tieBreak).toBe('distance_desc__candidate_key_asc');
    expect(basis.distance).toBeGreaterThan(0);
  });

  test('sem candidato fora do set, o holdout é declaradamente inexistente', () => {
    const { holdoutKey, basis } = selectHoldout({ candidates: POOL, selectedKeys: POOL.map((c) => c.candidateKey) });
    expect(holdoutKey).toBeNull();
    expect(basis.reason).toBe('no_candidate_outside_discovery_set');
  });
});
