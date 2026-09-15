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
  url: 'https://novo.com.br/',
  evidenceRef: 'ev-xyz',
  contentHash: 'sha256:cafe',
  tier: 5,
};

const SEED_BENCHMARK = {
  id: 'evo-w12',
  name: 'EVO (W12)',
  archetype: 'integration-first-api',
  independenceGroup: 'w12',
  sources: [{ tier: 5, url: 'https://w12.com.br/' }],
  dimensions: { geography: 'BR', customerSize: 'medium-large' },
};

describe('candidateDiscovery — seeds são referência, não verdade', () => {
  test('seed entra como EVIDENCE_REQUIRED, nunca ACCEPTED por padrão', () => {
    const seed = seedFromBenchmark('fitness', SEED_BENCHMARK);
    const record = buildCandidateRecord(seed);
    expect(record.origin).toBe('seed');
    expect(record.state).toBe(CANDIDATE_STATES.EVIDENCE_REQUIRED);
    // T-S2: a identidade é o DOMÍNIO REGISTRÁVEL do site oficial, não o título.
    expect(record.candidateKey).toBe('w12.com.br');
    expect(record.officialSite).toBe('https://w12.com.br/');
  });

  test('seed confirmado por pesquisa ACUMULA evidência e vira ACCEPTED', () => {
    const { candidates, accepted } = discoverCandidates({
      vertical: 'fitness',
      seeds: [seedFromBenchmark('fitness', SEED_BENCHMARK)],
      researchResults: [{
        name: 'EVO (W12)',
        officialSite: 'https://w12.com.br/',
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
        officialSite: 'https://novo.com.br/',
        officialDocs: 'https://docs.novo.com.br/',
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
    expect(accepted.map((c) => c.candidateKey)).toEqual(['novo.com.br']);
    const novo = candidates.find((c) => c.candidateKey === 'novo.com.br');
    expect(novo).toEqual(expect.objectContaining({
      origin: 'research',
      state: CANDIDATE_STATES.ACCEPTED,
      vendor: 'Fornecedor Novo Ltda',
      officialSite: 'https://novo.com.br/',
      officialDocs: 'https://docs.novo.com.br/',
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
        { name: 'GymNovo', sourceEvidence: [{ ...EVIDENCE, url: 'https://novo.com.br/docs' }] },
      ],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourceEvidence).toHaveLength(2);
  });

  test('identidade é o domínio: títulos de página diferentes do MESMO site fundem em um candidato', () => {
    const { candidates } = discoverCandidates({
      vertical: 'fitness',
      seeds: [],
      researchResults: [
        { name: 'GymNovo - Página Inicial', officialSite: 'https://www.gymnovo.com/', sourceEvidence: [EVIDENCE] },
        { name: 'GymNovo | Preços', officialSite: 'https://app.gymnovo.com/pricing', sourceEvidence: [{ ...EVIDENCE, url: 'https://app.gymnovo.com/pricing' }] },
      ],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidateKey).toBe('gymnovo.com');
    expect(candidates[0].sourceEvidence).toHaveLength(2);
  });

  test('domínio registrável composto é respeitado (com.br)', () => {
    const record = buildCandidateRecord({
      vertical: 'fitness',
      name: 'Tecnofit',
      officialSite: 'https://www.tecnofit.com.br/',
      sourceEvidence: [{ ...EVIDENCE, url: 'https://www.tecnofit.com.br/' }],
    });
    expect(record.candidateKey).toBe('tecnofit.com.br');
  });
});

describe('candidateDiscovery — gate de relevância de mercado (T-S2)', () => {
  const OUT_OF_MARKET = {
    evaluated: true,
    state: 'OUT_OF_MARKET',
    accepted: false,
    reason: 'category_signals_below_minimum',
    signalCount: 0,
    minSignals: 1,
    matchedTerms: [],
    domain: 'modafitness.com.br',
  };

  test('candidato RESEARCH fora do mercado é OUT_OF_MARKET mesmo com evidência obtida', () => {
    const { candidates, accepted, outOfMarket } = discoverCandidates({
      vertical: 'fitness',
      seeds: [],
      researchResults: [{
        name: 'Moda Fitness Loja',
        officialSite: 'https://modafitness.com.br/',
        sourceEvidence: [EVIDENCE],
        marketRelevance: OUT_OF_MARKET,
      }],
    });
    expect(accepted).toEqual([]);
    expect(candidates[0].state).toBe(CANDIDATE_STATES.OUT_OF_MARKET);
    expect(outOfMarket).toEqual([
      expect.objectContaining({ candidateKey: 'modafitness.com.br' }),
    ]);
    expect(outOfMarket[0].relevance).toEqual(expect.objectContaining({ reason: 'category_signals_below_minimum' }));
  });

  test('candidato RESEARCH dentro do mercado segue o fluxo de evidência normal', () => {
    const { accepted } = discoverCandidates({
      vertical: 'fitness',
      seeds: [],
      researchResults: [{
        name: 'GymNovo',
        officialSite: 'https://gymnovo.com/',
        sourceEvidence: [EVIDENCE],
        marketRelevance: {
          evaluated: true, state: 'IN_MARKET', accepted: true, reason: 'category_signals_present',
          signalCount: 2, minSignals: 1, matchedTerms: ['gym management software'], domain: 'gymnovo.com',
        },
      }],
    });
    expect(accepted.map((c) => c.candidateKey)).toEqual(['gymnovo.com']);
    expect(accepted[0].marketRelevance.state).toBe('IN_MARKET');
  });

  test('seed NÃO passa pelo gate de conteúdo: a declaração governada prevalece e o veredito observado fica auditável', () => {
    const { candidates, accepted } = discoverCandidates({
      vertical: 'fitness',
      seeds: [seedFromBenchmark('fitness', SEED_BENCHMARK)],
      researchResults: [{
        name: 'EVO (W12)',
        officialSite: 'https://w12.com.br/',
        sourceEvidence: [EVIDENCE],
        marketRelevance: { ...OUT_OF_MARKET, domain: 'w12.com.br' },
      }],
    });
    expect(candidates).toHaveLength(1);
    expect(accepted).toHaveLength(1);
    expect(candidates[0].origin).toBe('seed');
    expect(candidates[0].state).toBe(CANDIDATE_STATES.ACCEPTED);
    expect(candidates[0].metadata.observedMarketRelevance.state).toBe('OUT_OF_MARKET');
  });

  test('sem marketContext avaliado (NOT_EVALUABLE) a evidência continua mandando', () => {
    const record = buildCandidateRecord({
      vertical: 'fitness',
      name: 'Novo',
      officialSite: 'https://novo.com.br/',
      sourceEvidence: [EVIDENCE],
      marketRelevance: { evaluated: false, state: 'NOT_EVALUABLE', accepted: true, reason: 'market_context_not_declared' },
    });
    expect(record.state).toBe(CANDIDATE_STATES.ACCEPTED);
  });
});
