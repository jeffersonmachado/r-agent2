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
  assessDiscoveryInputViability,
  researchedKeysFromSample,
  reservedHoldoutKeysFromSample,
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

describe('candidateDiscovery — researchedKeysFromSample (ciclo incremental)', () => {
  // Loop de absorção: benchmarks com `analyzedAt` já foram pesquisados e têm
  // novelty medida no sample. A seleção de um novo ciclo precisa excluí-los
  // PELA MESMA IDENTIDADE usada no universo (domínio registrável do site
  // oficial; nome normalizado como fallback).

  test('deriva a chave de identidade dos benchmarks ANALISADOS', () => {
    const keys = researchedKeysFromSample({
      benchmarks: [
        { ...SEED_BENCHMARK, analyzedAt: '2026-09-15T10:00:00.000Z' },
        {
          id: 'zenplanner',
          name: 'Zen Planner',
          sources: [{ tier: 5, url: 'https://www.zenplanner.com/' }],
          analyzedAt: '2026-09-15T11:00:00.000Z',
        },
      ],
    });
    expect(keys).toEqual(expect.arrayContaining(['w12.com.br', 'zenplanner.com']));
    expect(keys).toHaveLength(2);
  });

  test('benchmark NÃO analisado não é excluído (ainda é desconhecido legítimo)', () => {
    const keys = researchedKeysFromSample({
      benchmarks: [
        { ...SEED_BENCHMARK, analyzedAt: '2026-09-15T10:00:00.000Z' },
        { id: 'novo', name: 'Novo', sources: [{ tier: 5, url: 'https://novo.com.br/' }] },
      ],
    });
    expect(keys).toEqual(['w12.com.br']);
  });

  test('sem URL parseável cai para o nome normalizado; sample vazio devolve []', () => {
    const keys = researchedKeysFromSample({
      benchmarks: [{ id: 'sem-site', name: 'Academia Sem Site', analyzedAt: '2026-09-15T10:00:00.000Z' }],
    });
    expect(keys).toEqual(['academia-sem-site']);
    expect(researchedKeysFromSample(null)).toEqual([]);
    expect(researchedKeysFromSample({})).toEqual([]);
  });
});

describe('candidateDiscovery — reservedHoldoutKeysFromSample (run real r13, 2026-09-16)', () => {
  // Run real r13: o pool elegível tinha APENAS o holdout pré-registrado
  // (wellable.co, role=validation, SEM analyzedAt). `researchedKeysFromSample`
  // exclui só o que já foi pesquisado (analyzedAt), então o holdout reservado
  // ficou elegível ao SET, foi selecionado e o run terminou sem handoff
  // (`holdout_unavailable_all_candidates_selected`). Consumir o holdout no
  // discovery set é leakage estrutural: ele deixaria de medir a generalização
  // do inventário. Holdout pré-registrado não-analisado é RESERVADO — nunca
  // entra no set; permanece elegível na seleção de holdout.

  test('benchmark role=validation SEM analyzedAt é reservado pela identidade do universo', () => {
    const keys = reservedHoldoutKeysFromSample({
      benchmarks: [
        {
          id: 'wellable.co',
          name: 'Wellable',
          role: 'validation',
          sources: [{ tier: 5, url: 'https://www.wellable.co/' }],
        },
        { ...SEED_BENCHMARK, analyzedAt: '2026-09-15T10:00:00.000Z' },
      ],
    });

    expect(keys).toEqual(['wellable.co']);
  });

  test('sample.holdout.benchmarkId reserva pelo id mesmo sem role=validation explícito', () => {
    const keys = reservedHoldoutKeysFromSample({
      holdout: { benchmarkId: 'reservado' },
      benchmarks: [
        { id: 'reservado', name: 'Reservado', role: 'discovery', sources: [{ tier: 5, url: 'https://reservado.io/' }] },
        { id: 'livre', name: 'Livre', role: 'discovery', sources: [{ tier: 5, url: 'https://livre.io/' }] },
      ],
    });

    expect(keys).toEqual(['reservado.io']);
  });

  test('holdout JÁ analisado não é reservado (é pesquisado — vale researchedKeys); sample vazio devolve []', () => {
    const keys = reservedHoldoutKeysFromSample({
      benchmarks: [
        {
          id: 'holdout-medido',
          name: 'Holdout Medido',
          role: 'validation',
          analyzedAt: '2026-09-15T10:00:00.000Z',
          sources: [{ tier: 5, url: 'https://medido.io/' }],
        },
      ],
    });

    expect(keys).toEqual([]);
    expect(reservedHoldoutKeysFromSample(null)).toEqual([]);
    expect(reservedHoldoutKeysFromSample({})).toEqual([]);
  });
});

describe('candidateDiscovery — merge não destrutivo (run real r9, 2026-09-16)', () => {
  // O r9 expôs três defeitos de merge: (1) a confirmação de seed — que corre
  // DEPOIS da varredura — carregava archetypes=[] e sobrescrevia os arquétipos
  // derivados do mapeamento de sinais; (2) o veredito de relevância observado
  // na varredura era descartado quando o registro existente não tinha nenhum
  // (ficava só em metadata); (3) uma segunda página do MESMO domínio sem os
  // termos de categoria derrubava o veredito IN_MARKET já medido — relevância
  // é propriedade do CANDIDATO, e uma página sem termos não desmente a outra.
  const RELEVANCE_IN = {
    evaluated: true, state: 'IN_MARKET', accepted: true, reason: 'category_signals_present',
    signalCount: 1, minSignals: 1, matchedTerms: ['corporate wellness platform'], domain: 'vendorx.io',
  };
  const RELEVANCE_OUT = {
    evaluated: true, state: 'OUT_OF_MARKET', accepted: false, reason: 'category_signals_below_minimum',
    signalCount: 0, minSignals: 1, matchedTerms: [], domain: 'vendorx.io',
  };

  test('array vazio do registro novo NÃO sobrescreve campos já povoados', () => {
    const { discoverCandidates } = require('../../../api/services/marketDiscovery/candidateDiscovery');
    const researchFirst = {
      name: 'VendorX', officialSite: 'https://vendorx.io/',
      archetypes: ['personal-wellness'], segments: ['corporate'],
      sourceEvidence: [{ url: 'https://vendorx.io/blog/a/', evidenceRef: 'ev-1', contentHash: 'h1' }],
      marketRelevance: RELEVANCE_IN,
    };
    const seedConfirmationLater = {
      name: 'VendorX', officialSite: 'https://vendorx.io/',
      archetypes: [], segments: [],
      sourceEvidence: [{ url: 'https://vendorx.io/', evidenceRef: 'ev-2', contentHash: 'h2' }],
    };
    const { candidates } = discoverCandidates({ vertical: 'v', seeds: [], researchResults: [researchFirst, seedConfirmationLater] });
    const record = candidates.find((c) => c.candidateKey === 'vendorx.io');
    expect(record.archetypes).toEqual(['personal-wellness']);
    expect(record.segments).toEqual(['corporate']);
    expect(record.sourceEvidence.length).toBe(2);
  });

  test('veredito de relevância é promovido quando o registro existente não tem nenhum', () => {
    const { discoverCandidates } = require('../../../api/services/marketDiscovery/candidateDiscovery');
    const seed = {
      name: 'VendorX', officialSite: 'https://vendorx.io/',
      sourceEvidence: [], rationale: 'seed de referência',
    };
    const found = {
      name: 'VendorX', officialSite: 'https://vendorx.io/',
      sourceEvidence: [{ url: 'https://vendorx.io/', evidenceRef: 'ev-1', contentHash: 'h1' }],
      marketRelevance: RELEVANCE_IN,
    };
    const { candidates } = discoverCandidates({ vertical: 'v', seeds: [seed], researchResults: [found] });
    const record = candidates.find((c) => c.candidateKey === 'vendorx.io');
    // A confirmação por pesquisa grava o veredito medido — a elegibilidade
    // histórica depende dele persistido, não de metadata de auditoria.
    expect(record.marketRelevance?.state).toBe('IN_MARKET');
    expect(record.origin).toBe('seed'); // origem do seed preservada
  });

  test('IN_MARKET é estável: página posterior sem termos NÃO derruba o veredito do candidato', () => {
    const { discoverCandidates } = require('../../../api/services/marketDiscovery/candidateDiscovery');
    const inMarket = {
      name: 'VendorX', officialSite: 'https://vendorx.io/blog/a/',
      sourceEvidence: [{ url: 'https://vendorx.io/blog/a/', evidenceRef: 'ev-1', contentHash: 'h1' }],
      marketRelevance: RELEVANCE_IN,
    };
    const pageWithoutTerms = {
      name: 'VendorX', officialSite: 'https://vendorx.io/careers/',
      sourceEvidence: [{ url: 'https://vendorx.io/careers/', evidenceRef: 'ev-2', contentHash: 'h2' }],
      marketRelevance: RELEVANCE_OUT,
    };
    const { candidates, outOfMarket } = discoverCandidates({ vertical: 'v', seeds: [], researchResults: [inMarket, pageWithoutTerms] });
    const record = candidates.find((c) => c.candidateKey === 'vendorx.io');
    expect(record.state).toBe('ACCEPTED');
    expect(record.marketRelevance?.state).toBe('IN_MARKET');
    expect(outOfMarket.map((c) => c.candidateKey)).not.toContain('vendorx.io');
  });
});

describe('candidateDiscovery — mergeCandidateRecords (merge cross-run com o persistido)', () => {
  // Run real de 2026-09-16 (woliba.io): o upsert do store sobrescrevia o
  // registro PERSISTIDO com a visão do run corrente — uma confirmação de seed
  // com fetch falho regravou a linha como EVIDENCE_REQUIRED, com relevância e
  // evidência ZERADAS e o nome trocado pelo título de um listicle. A verdade
  // do candidato vive na tabela market_candidates: o merge cross-run ACUMULA
  // — evidência faz união por url, IN_MARKET é estável, e só a POLÍTICA
  // vigente (host excluído) corrige um aceite histórico.
  const { mergeCandidateRecords } = require('../../../api/services/marketDiscovery/candidateDiscovery');
  const REL_IN = {
    evaluated: true, state: 'IN_MARKET', accepted: true, reason: 'category_signals_present',
    signalCount: 1, minSignals: 1, matchedTerms: ['employee wellness platform'], domain: 'vendorx.io',
  };
  const REL_OUT_CONTENT = {
    evaluated: true, state: 'OUT_OF_MARKET', accepted: false, reason: 'category_signals_below_minimum',
    signalCount: 0, minSignals: 1, matchedTerms: [], domain: 'vendorx.io',
  };
  const REL_OUT_HOST = {
    evaluated: true, state: 'OUT_OF_MARKET', accepted: false, reason: 'candidate_host_excluded',
    signalCount: 0, minSignals: 1, matchedTerms: [], domain: 'vendorx.io',
  };

  test('sem registro persistido, o incoming passa como veio', () => {
    const incoming = {
      candidateKey: 'vendorx.io', name: 'VendorX', origin: 'research', state: 'ACCEPTED',
      sourceEvidence: [{ url: 'https://vendorx.io/', evidenceRef: 'ev-1', contentHash: 'h1' }],
      marketRelevance: REL_IN,
    };
    expect(mergeCandidateRecords(null, incoming)).toBe(incoming);
    expect(mergeCandidateRecords(undefined, incoming)).toBe(incoming);
  });

  test('evidência ACUMULA por url entre runs: mesma fonte atualiza o hash, nunca duplica', () => {
    const persisted = {
      candidateKey: 'vendorx.io', name: 'VendorX', origin: 'research',
      sourceEvidence: [{ url: 'https://vendorx.io/blog/a/', evidenceRef: 'ev-1', contentHash: 'h1' }],
      marketRelevance: REL_IN, metadata: {},
    };
    const incoming = {
      candidateKey: 'vendorx.io', name: 'VendorX', origin: 'research',
      sourceEvidence: [
        { url: 'https://vendorx.io/blog/a/', evidenceRef: 'ev-1b', contentHash: 'h1-novo' },
        { url: 'https://vendorx.io/', evidenceRef: 'ev-2', contentHash: 'h2' },
      ],
      marketRelevance: REL_IN, metadata: {},
    };
    const merged = mergeCandidateRecords(persisted, incoming);
    expect(merged.sourceEvidence).toHaveLength(2);
    const byUrl = Object.fromEntries(merged.sourceEvidence.map((e) => [e.url, e]));
    expect(byUrl['https://vendorx.io/blog/a/'].contentHash).toBe('h1-novo');
    expect(byUrl['https://vendorx.io/'].evidenceRef).toBe('ev-2');
    // Idempotência: fundir de novo o MESMO incoming não cresce a evidência.
    const again = mergeCandidateRecords(merged, incoming);
    expect(again.sourceEvidence).toHaveLength(2);
  });

  test('IN_MARKET persistido é ESTÁVEL entre runs: página nova sem termos não derruba o candidato', () => {
    const persisted = {
      candidateKey: 'vendorx.io', name: 'VendorX', origin: 'research', state: 'ACCEPTED',
      sourceEvidence: [
        { url: 'https://vendorx.io/blog/a/', evidenceRef: 'ev-1', contentHash: 'h1' },
        { url: 'https://vendorx.io/', evidenceRef: 'ev-2', contentHash: 'h2' },
      ],
      marketRelevance: REL_IN, archetypes: ['personal-wellness'], metadata: { nameSource: 'homepage_title' },
    };
    const incoming = {
      candidateKey: 'vendorx.io', name: 'Vendorx', origin: 'research', state: 'OUT_OF_MARKET',
      sourceEvidence: [{ url: 'https://vendorx.io/careers/', evidenceRef: 'ev-3', contentHash: 'h3' }],
      marketRelevance: REL_OUT_CONTENT, archetypes: [], metadata: { nameSource: 'domain_label' },
    };
    const merged = mergeCandidateRecords(persisted, incoming);
    expect(merged.marketRelevance.state).toBe('IN_MARKET');
    expect(merged.state).toBe('ACCEPTED');
    expect(merged.sourceEvidence).toHaveLength(3);
    expect(merged.archetypes).toEqual(['personal-wellness']);
    // O veredito divergente fica auditável, nunca some em silêncio.
    expect(merged.metadata.observedMarketRelevance.state).toBe('OUT_OF_MARKET');
  });

  test('host excluído pela POLÍTICA VIGENTE corrige o aceite histórico', () => {
    const persisted = {
      candidateKey: 'vendorx.io', name: 'VendorX', origin: 'research', state: 'ACCEPTED',
      sourceEvidence: [{ url: 'https://vendorx.io/', evidenceRef: 'ev-1', contentHash: 'h1' }],
      marketRelevance: REL_IN, metadata: {},
    };
    const incoming = {
      candidateKey: 'vendorx.io', name: 'VendorX', origin: 'research', state: 'OUT_OF_MARKET',
      sourceEvidence: [{ url: 'https://vendorx.io/', evidenceRef: 'ev-1', contentHash: 'h1' }],
      marketRelevance: REL_OUT_HOST, metadata: {},
    };
    const merged = mergeCandidateRecords(persisted, incoming);
    expect(merged.marketRelevance.state).toBe('OUT_OF_MARKET');
    expect(merged.marketRelevance.reason).toBe('candidate_host_excluded');
    expect(merged.state).toBe('OUT_OF_MARKET');
  });

  test('incoming sem veredito (confirmação de seed) NÃO apaga o veredito persistido', () => {
    const persisted = {
      candidateKey: 'vendorx.io', name: 'VendorX', origin: 'research', state: 'ACCEPTED',
      sourceEvidence: [{ url: 'https://vendorx.io/', evidenceRef: 'ev-1', contentHash: 'h1' }],
      marketRelevance: REL_IN, metadata: {},
    };
    const incoming = {
      candidateKey: 'vendorx.io', name: 'VendorX', origin: 'research',
      sourceEvidence: [], marketRelevance: null, metadata: {},
    };
    const merged = mergeCandidateRecords(persisted, incoming);
    expect(merged.marketRelevance.state).toBe('IN_MARKET');
    expect(merged.state).toBe('ACCEPTED');
    expect(merged.sourceEvidence).toHaveLength(1);
  });

  test('nome: proveniência de rank MAIOR sara nome legado; rank menor não rebaixa', () => {
    const { mergeCandidateRecords: merge } = require('../../../api/services/marketDiscovery/candidateDiscovery');
    // Legado sem nameSource é tratado como título de busca (foi de lá que o
    // lixo pré-fix veio): homepage/domain_label sarão o título de listicle.
    const legado = {
      candidateKey: 'woliba.io', name: 'Top 11 Wellhub Alternatives or Competitors in 2026',
      origin: 'research', sourceEvidence: [{ url: 'https://woliba.io/blog/x/', evidenceRef: 'ev-1' }],
      marketRelevance: REL_IN, metadata: {},
    };
    const sarado = merge(legado, {
      candidateKey: 'woliba.io', name: 'Woliba', origin: 'research',
      sourceEvidence: [{ url: 'https://woliba.io/', evidenceRef: 'ev-2' }],
      marketRelevance: REL_IN, metadata: { nameSource: 'homepage_title' },
    });
    expect(sarado.name).toBe('Woliba');
    expect(sarado.metadata.nameSource).toBe('homepage_title');
    // Rank menor NÃO rebaixa um nome bom.
    const bom = {
      candidateKey: 'vantagefit.io', name: 'Vantage Fit', origin: 'research',
      sourceEvidence: [{ url: 'https://vantagefit.io/', evidenceRef: 'ev-1' }],
      marketRelevance: REL_IN, metadata: { nameSource: 'homepage_title' },
    };
    const rebaixado = merge(bom, {
      candidateKey: 'vantagefit.io', name: 'Vantagefit', origin: 'research',
      sourceEvidence: [{ url: 'https://vantagefit.io/pricing/', evidenceRef: 'ev-2' }],
      marketRelevance: REL_IN, metadata: { nameSource: 'domain_label' },
    });
    expect(rebaixado.name).toBe('Vantage Fit');
  });

  test('arrays fazem união determinística e origem seed persistida prevalece', () => {
    const persisted = {
      candidateKey: 'vendorx.io', name: 'VendorX', origin: 'seed',
      sourceEvidence: [{ url: 'https://vendorx.io/', evidenceRef: 'ev-1' }],
      archetypes: ['personal-wellness'], segments: ['corporate'], metadata: {},
    };
    const incoming = {
      candidateKey: 'vendorx.io', name: 'VendorX', origin: 'research',
      sourceEvidence: [{ url: 'https://vendorx.io/docs/', evidenceRef: 'ev-2' }],
      archetypes: ['boutique-studio', 'personal-wellness'], segments: [], metadata: {},
    };
    const merged = mergeCandidateRecords(persisted, incoming);
    expect(merged.archetypes).toEqual(['boutique-studio', 'personal-wellness']);
    expect(merged.segments).toEqual(['corporate']);
    expect(merged.origin).toBe('seed');
  });
});

/**
 * Um provider quebrado nao se disfarca de mercado vazio.
 *
 * DEFEITO MEDIDO (2026-09-19): o run de `bakery` avaliou 23 candidatos e
 * rejeitou TODOS por `category_signals_below_minimum` (nenhum casou um unico
 * termo de categoria, `minSignals: 1`). O provider havia devolvido conteudo sem
 * relacao com a query (`login.authorize.net` para "bakery management software").
 * O sistema registrou isso como mercado sem players e so falhou no handoff,
 * tres camadas adiante, com um 400 generico.
 *
 * Zero aceitos significa duas coisas OPOSTAS; estes testes fixam a distincao.
 */
describe('assessDiscoveryInputViability', () => {
  const semSinal = (n) => Array.from({ length: n }, (_, i) => ({
    candidateKey: `cand-${i}`,
    relevance: { reason: 'category_signals_below_minimum', signalCount: 0, minSignals: 1 },
  }));

  it('detecta o caso real de bakery: 23 avaliados, 0 aceitos, 100% sem sinal de categoria', () => {
    const verdict = assessDiscoveryInputViability({
      universe: 23,
      accepted: [],
      evidenceRequired: [],
      outOfMarket: semSinal(23),
    });
    expect(verdict.degenerate).toBe(true);
    expect(verdict.reason).toBe('provider_returned_no_relevant_candidates');
    expect(verdict.evaluated).toBe(23);
  });

  it('NAO acusa mercado vazio de verdade: recusa por outro criterio nao e falha de provider', () => {
    const verdict = assessDiscoveryInputViability({
      universe: 5,
      accepted: [],
      evidenceRequired: [],
      outOfMarket: [
        { candidateKey: 'a', relevance: { reason: 'category_signals_below_minimum' } },
        { candidateKey: 'b', relevance: { reason: 'different_archetype' } },
      ],
    });
    expect(verdict.degenerate).toBe(false);
  });

  it('NAO acusa quando existe candidato utilizavel (aceito ou requerendo evidencia)', () => {
    const comAceito = assessDiscoveryInputViability({
      universe: 5,
      accepted: [{ candidateKey: 'x' }],
      evidenceRequired: [],
      outOfMarket: semSinal(2),
    });
    expect(comAceito.degenerate).toBe(false);

    const comEvidencia = assessDiscoveryInputViability({
      universe: 5,
      accepted: [],
      evidenceRequired: [{ candidateKey: 'y' }],
      outOfMarket: semSinal(2),
    });
    expect(comEvidencia.degenerate).toBe(false);
  });

  it('NAO acusa universo vazio: nenhum seed nao e falha de entrada do provider', () => {
    expect(assessDiscoveryInputViability({ universe: 0, outOfMarket: [] }).degenerate).toBe(false);
    expect(assessDiscoveryInputViability({}).degenerate).toBe(false);
  });

  it('NAO acusa lista de fora-de-mercado vazia (nada foi analisado, nada a concluir)', () => {
    expect(assessDiscoveryInputViability({ universe: 3, accepted: [], outOfMarket: [] }).degenerate).toBe(false);
  });
});
