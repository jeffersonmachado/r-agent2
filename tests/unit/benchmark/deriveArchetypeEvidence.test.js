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
 *
 * Contrato histórico do bloco (verificado também por
 * tests/unit/benchmarkFitnessArchetypeGap.test.js):
 *  - `derivation` é STRING descritiva (módulo + run + vocabulário + contagem);
 *  - cada ref carrega findingId + evidenceId + sourceId (cadeia completa).
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
  {
    id: 'brf-aaa', evidenceId: 'bre-aaa', sourceId: 'brsrc-aaa', name: 'recurring billing', kind: 'capability', matchedTerm: 'billing',
  },
];

describe('derive-archetype-coverage-evidence — applyArchetypeEvidence (núcleo puro)', () => {
  test('escreve o bloco derivado no benchmark com arquétipo declarado e preserva o resto', () => {
    const sample = {
      vertical: 'fitness',
      benchmarks: [
        { id: 'abcfitness', archetype: 'financial-billing', findingsInventory: ['brf-aaa'], stale: 'keep-me' },
        { id: 'sem-arquetipo', archetype: null, archetypeEvidence: { derivation: 'velho', supportingFindings: [] } },
      ],
      outraChave: { intacta: true },
    };
    const next = applyArchetypeEvidence({
      sample,
      benchmarkVerdicts: [verdict('abcfitness', true, SUPPORT), verdict('sem-arquetipo', false)],
      provenance: PROVENANCE,
    });

    const abc = next.benchmarks.find((b) => b.id === 'abcfitness');
    expect(typeof abc.archetypeEvidence.derivation).toBe('string');
    expect(abc.archetypeEvidence.derivation).toContain(GENERATOR_ID);
    expect(abc.archetypeEvidence.derivation).toContain('fitness-semantic-2026-09-15-r2');
    expect(abc.archetypeEvidence.derivation).toContain('financial-billing');
    expect(abc.archetypeEvidence.supported).toBe(true);
    expect(abc.archetypeEvidence.supportingFindings).toEqual([
      {
        findingId: 'brf-aaa', evidenceId: 'bre-aaa', sourceId: 'brsrc-aaa', name: 'recurring billing', kind: 'capability', matchedTerm: 'billing',
      },
    ]);
    expect(abc.archetypeEvidence.provenance).toEqual(PROVENANCE);
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

  test('suporte referencia APENAS achados do inventário vigente e carrega a cadeia evidence/source (consistência B10/§17)', () => {
    const sample = { vertical: 'fitness', benchmarks: [{ id: 'abcfitness', archetype: 'financial-billing', findingsInventory: ['brf-aaa', 'brf-bbb'] }] };
    const next = applyArchetypeEvidence({ sample, benchmarkVerdicts: [verdict('abcfitness', true, SUPPORT)], provenance: PROVENANCE });
    const inventory = new Set(next.benchmarks[0].findingsInventory);
    for (const ref of next.benchmarks[0].archetypeEvidence.supportingFindings) {
      expect(inventory.has(ref.findingId)).toBe(true);
      expect(typeof ref.evidenceId).toBe('string');
      expect(typeof ref.sourceId).toBe('string');
    }
  });
});

/**
 * FITNESS-ABS-14 (2026-09-16) — escopo MULTI-RUN da derivação. Bug real do
 * ciclo 3: a derivação lia findings SÓ do run mais recente da vertical. O run
 * r11 (zenplanner/vantagefit) não contém abcfitness/wellhub — analisados no
 * run r2 — então os blocos `archetypeEvidence` deles foram REMOVIDOS como
 * "sem prova", derrubando duas travas de honestidade, embora o
 * `findingsInventory` deles continuasse referenciando (corretamente) os
 * findings do run r2, que seguem persistidos.
 *
 * A regra correta: os findings que respaldam um benchmark são os do ÚLTIMO
 * run que o contém como subject — exatamente a fonte do `findingsInventory`
 * vigente (cada patch substitui os campos de pesquisa do benchmark por
 * inteiro). Benchmark ausente do run mais recente NÃO perde a prova.
 */
describe('FITNESS-ABS-14 — selectFindingsPerBenchmark (multi-run, último run que contém o subject)', () => {
  const { selectFindingsPerBenchmark } = require('../../../qa/benchmarks/archetypeEvidenceDerivation');

  const R1 = {
    researchVersion: 'fitness-semantic-2026-09-15-r2',
    subjects: ['abcfitness', 'wellhub'],
    findings: [
      { id: 'brf-abc', benchmark_id: 'abcfitness', external_name: 'recurring billing', verified: true },
      { id: 'brf-wh', benchmark_id: 'wellhub', external_name: 'student app', verified: true },
    ],
  };
  const R2 = {
    researchVersion: 'fitness-market-discovery-2026-09-16-r11',
    subjects: ['vantagefit.io'],
    findings: [
      { id: 'brf-vf', benchmark_id: 'vantagefit.io', external_name: 'activity tracking', verified: true },
    ],
  };

  test('benchmark fora do run mais recente MANTÉM os findings do run que o analisou', () => {
    const selected = selectFindingsPerBenchmark({ runs: [R1, R2] });
    expect(selected.get('abcfitness').researchVersion).toBe(R1.researchVersion);
    expect(selected.get('abcfitness').findings.map((f) => f.id)).toEqual(['brf-abc']);
    expect(selected.get('wellhub').researchVersion).toBe(R1.researchVersion);
    expect(selected.get('vantagefit.io').researchVersion).toBe(R2.researchVersion);
    expect(selected.get('vantagefit.io').findings.map((f) => f.id)).toEqual(['brf-vf']);
  });

  test('benchmark reanalisado em run mais novo usa SÓ os findings do run novo (inventário substituído)', () => {
    const R2b = {
      researchVersion: 'fitness-r3',
      subjects: ['abcfitness'],
      findings: [{ id: 'brf-abc-novo', benchmark_id: 'abcfitness', external_name: 'subscription billing', verified: true }],
    };
    const selected = selectFindingsPerBenchmark({ runs: [R1, R2b] });
    expect(selected.get('abcfitness').researchVersion).toBe('fitness-r3');
    expect(selected.get('abcfitness').findings.map((f) => f.id)).toEqual(['brf-abc-novo']);
  });

  test('finding de benchmark fora do discovery set do run NÃO entra (sujeito é a fronteira)', () => {
    const run = {
      researchVersion: 'fitness-r4',
      subjects: ['abcfitness'],
      findings: [{ id: 'brf-x', benchmark_id: 'intruso', external_name: 'billing', verified: true }],
    };
    const selected = selectFindingsPerBenchmark({ runs: [run] });
    expect(selected.has('intruso')).toBe(false);
  });
});
