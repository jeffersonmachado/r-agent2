'use strict';

/**
 * Candidatos: seeds são referência (não verdade), a descoberta pode ir ALÉM
 * dos seeds, e "o agente achou relevante" sem evidência é rejeitado.
 */

const {
  CANDIDATE_STATES,
  buildCandidateRecord,
  discoverCandidates,
  seedFromBenchmark,
} = require('../../../api/services/marketDiscovery/candidateDiscovery');

const EVIDENCE = {
  url: 'https://novo.example.com/',
  evidenceRef: 'ev-xyz',
  contentHash: 'sha256:cafe',
  tier: 5,
};

const SEED_BENCHMARK = {
  id: 'evo-w12',
  name: 'EVO (W12)',
  archetype: 'integration-first-api',
  independenceGroup: 'w12',
  sources: [{ tier: 5, url: 'https://w12.example.com/' }],
  dimensions: { geography: 'BR', customerSize: 'medium-large' },
};

describe('candidateDiscovery — seeds são referência, não verdade', () => {
  test('seed entra como EVIDENCE_REQUIRED, nunca ACCEPTED por padrão', () => {
    const seed = seedFromBenchmark('fitness', SEED_BENCHMARK);
    const record = buildCandidateRecord(seed);
    expect(record.origin).toBe('seed');
    expect(record.state).toBe(CANDIDATE_STATES.EVIDENCE_REQUIRED);
    expect(record.candidateKey).toBe('evo-w12');
    expect(record.officialSite).toBe('https://w12.example.com/');
  });

  test('seed confirmado por pesquisa ACUMULA evidência e vira ACCEPTED', () => {
    const { candidates, accepted } = discoverCandidates({
      vertical: 'fitness',
      seeds: [seedFromBenchmark('fitness', SEED_BENCHMARK)],
      researchResults: [{
        name: 'EVO (W12)',
        officialSite: 'https://w12.example.com/',
        sourceEvidence: [EVIDENCE],
      }],
    });

    expect(candidates).toHaveLength(1);
    expect(accepted).toHaveLength(1);
    expect(candidates[0].origin).toBe('seed');
    expect(candidates[0].state).toBe(CANDIDATE_STATES.ACCEPTED);
    expect(candidates[0].sourceEvidence).toHaveLength(1);
  });

  test('candidato NOVO além dos seeds é aceito COM evidência', () => {
    const { candidates, accepted, stats } = discoverCandidates({
      vertical: 'fitness',
      seeds: [seedFromBenchmark('fitness', SEED_BENCHMARK)],
      researchResults: [{
        name: 'Fornecedor Novo',
        vendor: 'Fornecedor Novo Ltda',
        officialSite: 'https://novo.example.com/',
        officialDocs: 'https://docs.novo.example.com/',
        country: 'US',
        segments: ['boutique'],
        targetCustomers: ['small'],
        archetypes: ['student-digital-experience'],
        independenceGroup: 'novo',
        sourceEvidence: [EVIDENCE],
        rationale: 'descoberto pela varredura de mercado',
      }],
    });

    expect(stats.beyondSeeds).toBe(1);
    expect(accepted.map((c) => c.candidateKey)).toEqual(['fornecedor-novo']);
    const novo = candidates.find((c) => c.candidateKey === 'fornecedor-novo');
    expect(novo).toEqual(expect.objectContaining({
      origin: 'research',
      state: CANDIDATE_STATES.ACCEPTED,
      vendor: 'Fornecedor Novo Ltda',
      officialSite: 'https://novo.example.com/',
      officialDocs: 'https://docs.novo.example.com/',
      country: 'US',
      segments: ['boutique'],
      targetCustomers: ['small'],
      archetypes: ['student-digital-experience'],
      independenceGroup: 'novo',
    }));
    expect(novo.sourceEvidence[0]).toEqual(expect.objectContaining({ url: EVIDENCE.url, evidenceRef: EVIDENCE.evidenceRef }));
    expect(novo.rationale).toMatch(/varredura/);
  });

  test('"agente achou relevante" com ZERO evidência é rejeitado do universo aceito', () => {
    const { accepted, evidenceRequired } = discoverCandidates({
      vertical: 'fitness',
      seeds: [],
      researchResults: [{
        name: 'Relevante Sem Prova',
        rationale: 'o agente considerou relevante para o mercado',
        sourceEvidence: [],
      }],
    });

    expect(accepted).toEqual([]);
    expect(evidenceRequired.map((c) => c.candidateKey)).toEqual(['relevante-sem-prova']);
  });

  test('evidência sem url + ref/hash não valida o candidato', () => {
    const record = buildCandidateRecord({
      vertical: 'fitness',
      name: 'Quase Prova',
      sourceEvidence: [{ note: 'vi num anúncio' }],
    });
    expect(record.state).toBe(CANDIDATE_STATES.EVIDENCE_REQUIRED);
    expect(record.rationale).toBe('candidate_evidence_invalid');
  });

  test('re-descobrir o mesmo candidato funde evidência sem duplicar', () => {
    const { candidates } = discoverCandidates({
      vertical: 'fitness',
      seeds: [],
      researchResults: [
        { name: 'GymNovo', sourceEvidence: [EVIDENCE] },
        { name: 'GymNovo', sourceEvidence: [{ ...EVIDENCE, url: 'https://novo.example.com/docs' }] },
      ],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourceEvidence).toHaveLength(2);
  });
});
