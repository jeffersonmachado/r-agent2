'use strict';

/**
 * archetypeEvidence do sample DERIVADA, nunca digitada (2026-09-16).
 *
 * O bloco `archetypeEvidence.supportingFindings` precisa resolver contra o
 * `findingsInventory` VIGENTE do benchmark. Quando um patch de pesquisa
 * substitui o inventário (nova researchVersion), o bloco fica stale — e o
 * teste de honestidade (benchmarkResearchHonesty, B10) reprova com razão:
 * referência de achado que não existe no inventário é proveniência quebrada.
 *
 * O caminho legítimo é o GERADOR: deriva o bloco dos achados VERIFICADOS do
 * run corrente (mesma fonte do patch), escreve só a chave gerenciada e
 * detecta drift com --check.
 */

const {
  applyArchetypeEvidence,
  GENERATOR_ID,
} = require('../../../scripts/benchmark/derive-archetype-coverage-evidence');

const PROVENANCE = {
  generator: GENERATOR_ID,
  researchVersion: 'fitness-semantic-2026-09-15-r2',
  normalizationVersion: '1.0.0',
  derivedAt: '2026-09-16T02:56:27.715Z',
};

function verdict(benchmarkId, supported, supportingFindings = []) {
  return {
    benchmarkId,
    declaredArchetype: 'financial-billing',
    declaredArchetypeEvidence: {
      supported,
      reason: supported ? 'supported_by_verified_findings' : 'no_verified_finding_matches_archetype_vocabulary',
      supportingFindings,
      verifiedFindings: supportingFindings.length,
      totalFindings: 10,
    },
  };
}

const SUPPORT = [
  { findingId: 'brf-aaa', evidenceId: 'bre-aaa', sourceId: 'brsrc-aaa' },
];

describe('derive-archetype-coverage-evidence — applyArchetypeEvidence (núcleo puro)', () => {
  test('escreve o bloco derivado no benchmark com arquétipo declarado e preserva o resto', () => {
    const sample = {
      vertical: 'fitness',
      benchmarks: [
        { id: 'abcfitness', archetype: 'financial-billing', findingsInventory: ['brf-aaa'], stale: 'keep-me' },
        { id: 'sem-arquetipo', archetype: null, archetypeEvidence: { derivation: { old: true }, supportingFindings: [] } },
      ],
      outraChave: { intacta: true },
    };
    const next = applyArchetypeEvidence({
      sample,
      benchmarkVerdicts: [verdict('abcfitness', true, SUPPORT), verdict('sem-arquetipo', false)],
      provenance: PROVENANCE,
    });

    const abc = next.benchmarks.find((b) => b.id === 'abcfitness');
    expect(abc.archetypeEvidence).toEqual({
      derivation: PROVENANCE,
      supported: true,
      reason: 'supported_by_verified_findings',
      supportingFindings: SUPPORT,
      verifiedFindings: 1,
      totalFindings: 10,
    });
    expect(abc.stale).toBe('keep-me');

    // Benchmark sem suporte: bloco STALE é removido (prova velha não é prova).
    const sem = next.benchmarks.find((b) => b.id === 'sem-arquetipo');
    expect(sem.archetypeEvidence).toBeUndefined();

    expect(next.outraChave).toEqual({ intacta: true });
  });

  test('determinístico e idempotente', () => {
    const sample = { vertical: 'fitness', benchmarks: [{ id: 'abcfitness', archetype: 'financial-billing' }] };
    const once = applyArchetypeEvidence({ sample, benchmarkVerdicts: [verdict('abcfitness', true, SUPPORT)], provenance: PROVENANCE });
    const twice = applyArchetypeEvidence({ sample: once, benchmarkVerdicts: [verdict('abcfitness', true, SUPPORT)], provenance: PROVENANCE });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  test('suporte referencia APENAS achados do inventário vigente (consistência B10)', () => {
    const sample = { vertical: 'fitness', benchmarks: [{ id: 'abcfitness', archetype: 'financial-billing', findingsInventory: ['brf-aaa', 'brf-bbb'] }] };
    const next = applyArchetypeEvidence({ sample, benchmarkVerdicts: [verdict('abcfitness', true, SUPPORT)], provenance: PROVENANCE });
    const inventory = new Set(next.benchmarks[0].findingsInventory);
    for (const ref of next.benchmarks[0].archetypeEvidence.supportingFindings) {
      expect(inventory.has(ref.findingId)).toBe(true);
    }
  });
});
