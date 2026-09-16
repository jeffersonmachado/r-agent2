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

describe('discoverySetSelection — ciclo incremental (excludeKeys de já pesquisados)', () => {
  // Loop de absorção da missão: depois que um benchmark foi PESQUISADO
  // (analyzedAt), ele já consta do sample com novelty medida. Re-selecioná-lo
  // criaria uma entrada fresca SEM pesquisa por cima da medida — perda de
  // evidência e duplicidade de identidade no sample. A seleção de um novo
  // ciclo precisa excluir o que já foi pesquisado e medir cobertura A PARTIR
  // do que já se conhece.

  test('candidato excluído (já pesquisado) nunca é selecionado, mesmo com o maior score', () => {
    const withoutExclusion = selectDiscoverySet({
      candidates: POOL,
      acceptedArchetypeKeys: ['independent-gym', 'financial-billing', 'student-digital-experience'],
      size: 2,
    });
    expect(withoutExclusion.selected).toContain('alpha'); // sanity: sem exclusão, alpha lidera

    const { selected, excluded } = selectDiscoverySet({
      candidates: POOL,
      acceptedArchetypeKeys: ['independent-gym', 'financial-billing', 'student-digital-experience'],
      size: 2,
      excludeKeys: ['alpha'],
    });

    expect(selected).not.toContain('alpha');
    expect(selected).toHaveLength(2);
    expect(excluded).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidateKey: 'alpha', reason: 'already_researched' }),
    ]));
  });

  test('cobertura parte do inventário já pesquisado: arquétipo já coberto não pontua de novo', () => {
    // alpha (excluído) já cobre independent-gym. delta-fitness-like só traria
    // o mesmo arquétipo; beta traz financial-billing (não coberto pelos
    // excluídos). A seleção incremental deve refletir o que FALTA.
    const pool = [
      candidate({ candidateKey: 'researched-gym', archetypes: ['independent-gym'], country: 'BR', independenceGroup: 'rg' }),
      candidate({ candidateKey: 'same-archetype-new', archetypes: ['independent-gym'], country: 'BR', independenceGroup: 'san' }),
      candidate({ candidateKey: 'new-archetype', archetypes: ['financial-billing'], country: 'BR', independenceGroup: 'na' }),
    ];
    const { selected, rationale } = selectDiscoverySet({
      candidates: pool,
      acceptedArchetypeKeys: ['independent-gym', 'financial-billing'],
      size: 1,
      excludeKeys: ['researched-gym'],
    });

    expect(selected).toEqual(['new-archetype']);
    expect(rationale[0].breakdown.map((d) => d.dimension)).toContain('archetypeCoverage');
  });

  test('holdout nunca é um candidato já pesquisado', () => {
    const { holdoutKey, basis } = selectHoldout({
      candidates: POOL,
      selectedKeys: ['alpha'],
      acceptedArchetypeKeys: ['independent-gym', 'financial-billing', 'student-digital-experience'],
      excludeKeys: ['beta', 'gamma', 'gamma-wl'],
    });

    // Todos fora do set estão excluídos → não existe holdout honesto.
    expect(holdoutKey).toBeNull();
    expect(basis.reason).toBe('no_candidate_outside_discovery_set');
  });

  test('distância do holdout é medida contra selecionados E já pesquisados', () => {
    const pool = [
      candidate({ candidateKey: 'researched-billing', archetypes: ['financial-billing'], country: 'BR', independenceGroup: 'rb' }),
      candidate({ candidateKey: 'in-set', archetypes: ['independent-gym'], country: 'BR', independenceGroup: 'is' }),
      candidate({ candidateKey: 'hopeful', archetypes: ['financial-billing'], country: 'BR', independenceGroup: 'hopeful' }),
    ];
    const { holdoutKey, basis } = selectHoldout({
      candidates: pool,
      selectedKeys: ['in-set'],
      acceptedArchetypeKeys: ['independent-gym', 'financial-billing'],
      excludeKeys: ['researched-billing'],
    });

    expect(holdoutKey).toBe('hopeful');
    // financial-billing JÁ é conhecido (pesquisado): não conta como distância.
    const factors = basis.factors.map((f) => f.reason);
    expect(factors).not.toContain('archetype_not_covered');
    expect(factors).toContain('independence_group_not_covered');
  });

  test('sem excludeKeys o comportamento é o de sempre (compatibilidade)', () => {
    const a = selectDiscoverySet({
      candidates: POOL,
      acceptedArchetypeKeys: ['independent-gym', 'financial-billing', 'student-digital-experience'],
      size: 3,
    });
    const b = selectDiscoverySet({
      candidates: POOL,
      acceptedArchetypeKeys: ['independent-gym', 'financial-billing', 'student-digital-experience'],
      size: 3,
      excludeKeys: [],
    });
    expect(a.selected).toEqual(b.selected);
  });
});
