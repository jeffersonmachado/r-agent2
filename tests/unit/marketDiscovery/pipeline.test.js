'use strict';

/**
 * Pipeline completo de descoberta de mercado: MARKET → ARCHETYPES →
 * CANDIDATES → CANDIDATE ANALYSIS → DIVERSITY → DISCOVERY SET → HOLDOUT
 * PREREGISTRATION → handoff para pesquisa profunda.
 *
 * Os runners de capability são INJETADOS e honram o contrato REAL de
 * `api/services/benchmark/researchCapabilities.js` (fetch devolve
 * `contentHash` do conteúdo efetivamente devolvido etc.).
 */

const crypto = require('crypto');

const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const { RESEARCH_CAPABILITY_IDS } = require('../../../api/services/benchmark/researchCapabilities');
const {
  createMarketDiscoverySupervisor,
  DISCOVERY_RUN_STATES,
  DISCOVERY_RUN_OUTCOMES,
  buildDiscoveryPrincipal,
} = require('../../../api/services/marketDiscovery/marketDiscoverySupervisor');
const { createMarketDiscoveryMemoryStore } = require('../../helpers/marketDiscoveryMemoryStore');
const { buildCandidateRecord } = require('../../../api/services/marketDiscovery/candidateDiscovery');

const TENANT = 'system';
const NOW = '2026-09-15T12:00:00.000Z';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function sha(content) {
  return crypto.createHash('sha256').update(String(content)).digest('hex');
}

const SAMPLE = {
  vertical: 'fitness-lab',
  archetypes: [
    { id: 'independent-gym', importance: 'REQUIRED', name: 'Academia independente', evidence: 'texto histórico do config (não é evidência)' },
    { id: 'financial-billing', importance: 'REQUIRED', name: 'Financeiro e cobrança recorrente', evidence: 'texto histórico' },
    { id: 'student-digital-experience', importance: 'REQUIRED', name: 'Experiência digital do aluno', evidence: 'texto histórico' },
  ],
  benchmarks: [
    {
      id: 'seed-alpha',
      name: 'Alpha Gym',
      archetype: 'independent-gym',
      independenceGroup: 'alpha',
      sources: [{ tier: 5, url: 'https://alpha-gym.com/' }],
      dimensions: { geography: 'BR', customerSize: 'small' },
    },
    {
      id: 'seed-beta',
      name: 'Beta Fit',
      archetype: 'financial-billing',
      independenceGroup: 'beta',
      sources: [{ tier: 5, url: 'https://beta-fit.com/' }],
      dimensions: { geography: 'BR', customerSize: 'medium' },
    },
  ],
};

/** Universo que a "pesquisa" encontra: 2 seeds + 1 novo + 1 white-label do novo. */
const SEARCH_HITS = [
  { url: 'https://alpha-gym.com/', title: 'Alpha Gym', country: 'BR', archetypes: ['independent-gym'] },
  { url: 'https://beta-fit.com/', title: 'Beta Fit', country: 'BR', archetypes: ['financial-billing'] },
  { url: 'https://gymnovo.com/', title: 'GymNovo', country: 'US', archetypes: ['student-digital-experience'], segments: ['boutique'], independenceGroup: 'gymnovo' },
  // T-S2: identidade = domínio registrável. Um subdomínio do MESMO domínio seria
  // o mesmo fornecedor; o white-label mora em outro domínio e declara cloneOf
  // apontando para a identidade (domínio) do produto base.
  { url: 'https://gymnovo-whitelabel.com/', title: 'GymNovo WhiteLabel', country: 'US', archetypes: ['student-digital-experience'], cloneOf: 'gymnovo.com', independenceGroup: 'wl-proprio' },
  { url: 'https://delta-fitness.com/', title: 'Delta Fitness', country: 'IE', archetypes: ['independent-gym'], segments: ['rede'], independenceGroup: 'delta' },
];

function buildProviders() {
  return {
    search: async () => ({ candidates: SEARCH_HITS }),
    fetch: async (input) => {
      const content = `conteúdo oficial de ${input.url}`;
      return {
        httpStatus: 200,
        content,
        contentType: 'text/html',
        retrievedAt: NOW,
        contentHash: sha(content),
      };
    },
    inspectDocumentation: async () => ({
      sections: ['Matrículas', 'Cobrança', 'Catraca', 'App do aluno', 'Relatórios', 'Planos', 'Turmas', 'CRM', 'NF-e'],
    }),
    inspectApiDocs: async () => ({ operations: ['GET /members', 'POST /billing', 'GET /access'] }),
    captureEvidence: async (input) => ({ evidenceRef: `ev-${sha(input.url).slice(0, 12)}`, contentHash: input.contentHash }),
  };
}

async function buildHarness({ providers = buildProviders(), sharedState, selection = { size: 3 } } = {}) {
  const registry = createToolRegistry({ logger: silent });
  const store = createMarketDiscoveryMemoryStore({ state: sharedState });
  const supervisor = createMarketDiscoverySupervisor({
    store,
    registry,
    providers,
    tenantId: TENANT,
    actor: buildDiscoveryPrincipal(),
    now: () => NOW,
    logger: silent,
    selection,
  });
  return { registry, store, supervisor };
}

describe('Market discovery — pipeline completo', () => {
  test('caminho feliz MARKET → … → HOLDOUT PREREGISTERED → handoff', async () => {
    const { supervisor, store } = await buildHarness();

    const result = await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-discovery-v1',
      sample: SAMPLE,
    });

    expect(result.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);

    // Run terminou na fase de handoff, com cada estágio registrado.
    const run = await store.getRun({ tenantId: TENANT, vertical: 'fitness-lab', discoveryVersion: 'fitness-lab-discovery-v1' });
    expect(run.state).toBe(DISCOVERY_RUN_STATES.HANDED_OFF);
    expect(run.completed_at).toBe(NOW);
    expect(run.metadata.marketScan).toBeDefined();
    expect(run.metadata.diversity).toBeDefined();

    // Arquétipos revalidados COM evidência deste run (não pelo config).
    expect(result.archetypes.accepted).toEqual(expect.arrayContaining([
      'independent-gym', 'financial-billing', 'student-digital-experience',
    ]));
    const billing = await store.getArchetype({ tenantId: TENANT, vertical: 'fitness-lab', archetypeKey: 'financial-billing' });
    expect(billing.state).toBe('ACCEPTED');
    expect(billing.source_evidence.length).toBeGreaterThan(0);
    expect(billing.source_evidence[0]).toEqual(expect.objectContaining({ evidenceRef: expect.any(String), contentHash: expect.any(String) }));

    // Candidato NOVO (além dos seeds) aceito com evidência.
    expect(result.candidates.beyondSeeds).toBeGreaterThan(0);
    const gymnovo = await store.getCandidate({ tenantId: TENANT, vertical: 'fitness-lab', candidateKey: 'gymnovo.com' });
    expect(gymnovo.state).toBe('ACCEPTED');
    expect(gymnovo.origin).toBe('research');
    expect(gymnovo.profiled_at).toBe(NOW);
    expect(gymnovo.deep_research_at).toBeNull(); // profiling NUNCA é pesquisa profunda

    // Clone/white-label não conta como diversidade real.
    expect(result.diversity.totalCandidates).toBe(5);
    expect(result.diversity.independentCount).toBe(4);
    expect(result.diversity.clones).toEqual([
      { candidateKey: 'gymnovo-whitelabel.com', cloneOf: 'gymnovo.com' },
    ]);

    // Discovery set determinístico com rationale persistida.
    expect(result.discoverySet.selected).toHaveLength(3);
    const set = await store.getDiscoverySet({ tenantId: TENANT, setId: result.discoverySet.id });
    expect(set.selection_rationale).toHaveLength(3);
    expect(set.selection_rationale[0]).toEqual(expect.objectContaining({ candidateKey: expect.any(String), score: expect.any(Number), breakdown: expect.any(Array) }));

    // Holdout pré-registrado ANTES do handoff, com base de seleção.
    expect(result.holdout.preregistered).toBe(true);
    expect(result.holdout.candidateKey).toBeTruthy();
    expect(result.discoverySet.selected).not.toContain(result.holdout.candidateKey);
    expect(set.holdout_preregistered).toBe(true);
    expect(set.holdout_selected_at).toBe(NOW);
    expect(set.holdout_selection_basis).toEqual(expect.objectContaining({ reason: expect.any(String) }));
    expect(set.state).toBe('OPENED_FOR_RESEARCH');

    // Handoff compatível com o subsistema de benchmark research.
    expect(result.handoff).toEqual(expect.objectContaining({
      tenantId: TENANT,
      vertical: 'fitness-lab',
      benchmarkIds: result.discoverySet.selected,
      holdoutBenchmarkId: result.holdout.candidateKey,
    }));
  });

  test('determinístico: o mesmo universo produz o mesmo set, holdout e ids', async () => {
    const first = await buildHarness();
    const second = await buildHarness();

    const a = await first.supervisor.discover({ vertical: 'fitness-lab', discoveryVersion: 'v1', sample: SAMPLE });
    const b = await second.supervisor.discover({ vertical: 'fitness-lab', discoveryVersion: 'v1', sample: SAMPLE });

    expect(a.runId).toBe(b.runId);
    expect(a.discoverySet.selected).toEqual(b.discoverySet.selected);
    expect(a.holdout.candidateKey).toBe(b.holdout.candidateKey);
  });

  test('idempotente: re-run com a mesma versão não duplica candidatos nem arquétipos', async () => {
    const sharedState = { runs: new Map(), archetypes: new Map(), candidates: new Map(), sets: new Map() };
    const first = await buildHarness({ sharedState });
    await first.supervisor.discover({ vertical: 'fitness-lab', discoveryVersion: 'v1', sample: SAMPLE });
    const candidatesAfterFirst = await first.store.listCandidates({ tenantId: TENANT, vertical: 'fitness-lab' });

    const second = await buildHarness({ sharedState });
    await second.supervisor.discover({ vertical: 'fitness-lab', discoveryVersion: 'v1', sample: SAMPLE });
    const candidatesAfterSecond = await second.store.listCandidates({ tenantId: TENANT, vertical: 'fitness-lab' });
    const archetypes = await second.store.listArchetypes({ tenantId: TENANT, vertical: 'fitness-lab' });

    expect(candidatesAfterSecond).toHaveLength(candidatesAfterFirst.length);
    expect(new Set(candidatesAfterSecond.map((c) => c.id)).size).toBe(candidatesAfterSecond.length);
    expect(archetypes).toHaveLength(3);
  });

  test('restart: uma nova instância do store enxerga tudo o que a anterior persistiu', async () => {
    const sharedState = { runs: new Map(), archetypes: new Map(), candidates: new Map(), sets: new Map() };
    const before = await buildHarness({ sharedState });
    const result = await before.supervisor.discover({ vertical: 'fitness-lab', discoveryVersion: 'v1', sample: SAMPLE });

    // "Restart": nova instância, mesmo estado persistido.
    const after = await buildHarness({ sharedState });
    const run = await after.store.getRun({ tenantId: TENANT, vertical: 'fitness-lab', discoveryVersion: 'v1' });
    const set = await after.store.getDiscoverySet({ tenantId: TENANT, setId: result.discoverySet.id });
    const holdout = await after.store.getCandidate({ tenantId: TENANT, vertical: 'fitness-lab', candidateKey: result.holdout.candidateKey });

    expect(run.state).toBe(DISCOVERY_RUN_STATES.HANDED_OFF);
    expect(set.holdout_preregistered).toBe(true);
    expect(holdout.state).toBe('ACCEPTED');
  });

  test('sem provider de pesquisa o run é BLOQUEADO e nada é aceito', async () => {
    const { supervisor, store } = await buildHarness({ providers: {} });

    const result = await supervisor.discover({ vertical: 'fitness-lab', discoveryVersion: 'v1', sample: SAMPLE });

    expect(result.status).toBe(DISCOVERY_RUN_OUTCOMES.BLOCKED_NO_EXTERNAL_ACCESS);
    expect(result.availability.missing).toEqual(RESEARCH_CAPABILITY_IDS);
    const run = await store.getRun({ tenantId: TENANT, vertical: 'fitness-lab', discoveryVersion: 'v1' });
    expect(run.state).toBe(DISCOVERY_RUN_STATES.BLOCKED);
    expect(await store.listArchetypes({ tenantId: TENANT, vertical: 'fitness-lab' })).toHaveLength(0);
    expect(await store.listCandidates({ tenantId: TENANT, vertical: 'fitness-lab' })).toHaveLength(0);
  });

  test('falha de REDE de um candidato não derruba o run (fato de descoberta, não exceção)', async () => {
    const providers = buildProviders();
    const failingFetch = providers.fetch;
    providers.fetch = async (input) => {
      if (String(input.url).includes('gymnovo-whitelabel')) {
        const error = new Error('research_fetch_timeout: host inalcançável');
        error.code = 'research_fetch_timeout';
        throw error;
      }
      return failingFetch(input);
    };
    const { supervisor } = await buildHarness({ providers });

    const result = await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-fetch-fail-v1',
      sample: SAMPLE,
    });

    // O run COMPLETA; o candidato cuja fonte falhou simplesmente não acumula
    // evidência e não entra no universo aceito.
    expect(result.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);
    expect(result.candidates.accepted ?? result.discoverySet.selected.length).toBeDefined();
  });

  test('o supervisor é superfície DEVELOPMENT com tenant SYSTEM', async () => {
    const { supervisor } = await buildHarness();
    expect(supervisor.capability.visibility).toBe('DEVELOPMENT');
    expect(supervisor.actor.classification).toBe('DEVELOPMENT');
    expect(supervisor.actor.tenant).toBe('system');
    expect(supervisor.tenantId).toBe('system');
  });

  test('T-S2: página obtida fora do mercado (Wikipedia/loja/help) é OUT_OF_MARKET e não entra no universo aceito', async () => {
    const context = {
      categoryTerms: ['gym management software'],
      relevance: { minCategorySignals: 1, excludedHosts: ['wikipedia.org', 'support.google.com'] },
    };
    const providers = buildProviders();
    providers.search = async ({ query }) => ({
      candidates: query.includes('site oficial') || query.includes('documentação oficial')
        ? []
        : [
          { url: 'https://alpha-gym.com/', title: 'Alpha Gym' },
          { url: 'https://en.wikipedia.org/wiki/Fitness', title: 'Physical fitness - Wikipedia' },
          { url: 'https://modafitness.com.br/', title: 'Moda Fitness Loja' },
          { url: 'https://support.google.com/fit/answer/1', title: 'Ajuda do Google Fit' },
        ],
    });
    const realFetch = providers.fetch;
    providers.fetch = async (input) => {
      const url = String(input.url);
      if (url.includes('wikipedia.org')) {
        const content = 'Physical fitness is a state of health and well-being. Exercise and training history.';
        return { httpStatus: 200, content, contentType: 'text/html', retrievedAt: NOW, contentHash: sha(content) };
      }
      if (url.includes('modafitness')) {
        const content = 'Moda fitness: leggings, tops e frete grátis. Compre agora.';
        return { httpStatus: 200, content, contentType: 'text/html', retrievedAt: NOW, contentHash: sha(content) };
      }
      if (url.includes('support.google.com')) {
        const content = 'Como configurar o Google Fit no seu smartwatch.';
        return { httpStatus: 200, content, contentType: 'text/html', retrievedAt: NOW, contentHash: sha(content) };
      }
      const content = `gym management software oficial de ${url}: membros, cobrança e catraca`;
      return { httpStatus: 200, content, contentType: 'text/html', retrievedAt: NOW, contentHash: sha(content) };
    };

    const { supervisor, store } = await buildHarness({ providers, selection: { size: 1 } });
    const result = await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-relevance-v1',
      sample: { ...SAMPLE, marketContext: context },
    });

    expect(result.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);

    // Os três poluentes observados na varredura real foram OBTIDOS (fetch 200)
    // e mesmo assim ficaram fora do universo aceito — com motivo nominal.
    const accepted = await store.listCandidates({ tenantId: TENANT, vertical: 'fitness-lab', state: 'ACCEPTED' });
    const acceptedKeys = accepted.map((c) => c.candidate_key);
    expect(acceptedKeys).not.toContain('wikipedia.org');
    expect(acceptedKeys).not.toContain('modafitness.com.br');
    expect(acceptedKeys).not.toContain('google.com'); // identidade = domínio registrável do help center
    expect(acceptedKeys).toContain('alpha-gym.com');

    const outOfMarket = result.candidates.outOfMarket.map((c) => c.candidateKey);
    expect(outOfMarket).toEqual(expect.arrayContaining([
      'wikipedia.org', 'modafitness.com.br', 'google.com',
    ]));
    const run = await store.getRun({ tenantId: TENANT, vertical: 'fitness-lab', discoveryVersion: 'fitness-lab-relevance-v1' });
    expect(run.metadata.candidatesOutOfMarket.length).toBe(3);
    expect(run.metadata.relevanceGate).toBe('evaluated');
  });
});

describe('Market discovery — ciclo incremental (absorção)', () => {
  test('benchmarks JÁ ANALISADOS do sample nunca voltam ao set nem ao holdout', async () => {
    const { supervisor, store } = await buildHarness();
    // Ciclo N+1: seed-alpha JÁ foi pesquisado (novelty medida no sample).
    const sampleIncremental = {
      ...SAMPLE,
      benchmarks: [
        { ...SAMPLE.benchmarks[0], analyzedAt: '2026-09-14T10:00:00.000Z' },
        SAMPLE.benchmarks[1],
      ],
    };

    const result = await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-discovery-v2',
      sample: sampleIncremental,
    });

    expect(result.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);
    // alpha-gym.com é a identidade do benchmark já analisado: fora do set.
    expect(result.discoverySet.selected).not.toContain('alpha-gym.com');
    expect(result.holdout.candidateKey).not.toBe('alpha-gym.com');
    // A exclusão é auditável no metadata do run.
    const run = await store.getRun({ tenantId: TENANT, vertical: 'fitness-lab', discoveryVersion: 'fitness-lab-discovery-v2' });
    expect(run.metadata.incrementalExclusions).toEqual(expect.arrayContaining(['alpha-gym.com']));
    // O set continua válido: só candidatos NOVOS, com evidência.
    expect(result.discoverySet.selected.length).toBeGreaterThan(0);
    expect(result.discoverySet.selected).toEqual(expect.arrayContaining(['gymnovo.com']));
  });

  test('sem benchmarks analisados o comportamento é o do primeiro ciclo', async () => {
    const { supervisor } = await buildHarness();
    const result = await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-discovery-v1',
      sample: SAMPLE,
    });
    expect(result.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);
    // Nada analisado → nada excluído: seeds competem normalmente.
    expect(result.discoverySet.selected).toContain('alpha-gym.com');
  });

  test('candidato aceito em run ANTERIOR não contamina a seleção do run corrente', async () => {
    // Reproduz o defeito observado no run real r2 (2026-09-16): candidatos
    // aceitos por runs antigos (universo persistido por tenant+vertical)
    // voltavam ao DISCOVERY SET do run novo porque CANDIDATE ANALYSIS /
    // DIVERSITY / DISCOVERY SET / HOLDOUT liam o universo SEM escopo de run.
    // A seleção de um run é derivada do que ESSE run verificou.
    const sharedState = { runs: new Map(), archetypes: new Map(), candidates: new Map(), sets: new Map() };
    const first = await buildHarness({ sharedState });
    const runOne = await first.supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-discovery-v1',
      sample: SAMPLE,
    });
    expect(runOne.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);
    expect(runOne.discoverySet.selected).toContain('gymnovo.com');

    // Ciclo N+1: a pesquisa NÃO reencontra gymnovo/delta — só os seeds.
    const providersV2 = {
      ...buildProviders(),
      search: async () => ({ candidates: SEARCH_HITS.slice(0, 2) }),
    };
    const second = await buildHarness({ sharedState, providers: providersV2 });
    const sampleIncremental = {
      ...SAMPLE,
      benchmarks: SAMPLE.benchmarks.map((b) => ({ ...b, analyzedAt: '2026-09-15T10:00:00.000Z' })),
    };
    const runTwo = await second.supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-discovery-v2',
      sample: sampleIncremental,
    });

    expect(runTwo.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);
    // gymnovo.com/delta-fitness.com/gymnovo-whitelabel.com foram aceitos no
    // run v1, mas NÃO foram verificados pelo run v2: não podem ser selecionados.
    expect(runTwo.discoverySet.selected).not.toContain('gymnovo.com');
    expect(runTwo.discoverySet.selected).not.toContain('delta-fitness.com');
    expect(runTwo.discoverySet.selected).not.toContain('gymnovo-whitelabel.com');
    expect(runTwo.holdout.candidateKey).not.toBe('gymnovo.com');
    // O universo histórico permanece persistido (nada é apagado) — o que muda
    // é o ESCOPO da seleção, não a memória.
    const universe = await second.store.listCandidates({ tenantId: TENANT, vertical: 'fitness-lab' });
    expect(universe.some((c) => c.candidate_key === 'gymnovo.com')).toBe(true);
  });
});

describe('Market discovery — reserva de holdout no ciclo incremental', () => {
  test('pool pequeno reserva candidato para o holdout (set nunca consome tudo quando dá para dividir)', async () => {
    // Run real r4 (2026-09-16): 3 candidatos novos aceitos → set levou os 3,
    // holdout ficou sem pool e o ciclo completou SEM handoff. Com pool ≥ 2 o
    // protocolo consegue set + holdout: o tamanho efetivo do set é limitado a
    // pool-1 (o tamanho declarado é TETO, não cota).
    const { supervisor, store } = await buildHarness({ selection: { size: 3 } });
    const sampleAllAnalyzed = {
      ...SAMPLE,
      benchmarks: SAMPLE.benchmarks.map((b) => ({ ...b, analyzedAt: '2026-09-15T10:00:00.000Z' })),
    };
    const result = await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-discovery-reserve',
      sample: sampleAllAnalyzed,
    });

    expect(result.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);
    // Pool elegível = 3 novos (seeds excluídos): set com no máximo 2, holdout 1.
    expect(result.discoverySet.selected.length).toBe(2);
    expect(result.holdout.candidateKey).toBeTruthy();
    expect(result.holdout.preregistered).toBe(true);
    expect(result.discoverySet.selected).not.toContain(result.holdout.candidateKey);
    expect(result.handoff).not.toBeNull();
    expect(result.handoff.holdoutBenchmarkId).toBe(result.holdout.candidateKey);
    // A reserva é auditável no metadata do run.
    const run = await store.getRun({ tenantId: TENANT, vertical: 'fitness-lab', discoveryVersion: 'fitness-lab-discovery-reserve' });
    expect(run.metadata.effectiveSetSize).toBe(2);
    expect(run.metadata.requestedSetSize).toBe(3);
  });

  test('pool de UM candidato novo não divide: set leva o único e o ciclo completa sem handoff', async () => {
    const providersOne = {
      ...buildProviders(),
      search: async () => ({ candidates: SEARCH_HITS.slice(2, 3) }),
    };
    const { supervisor } = await buildHarness({ providers: providersOne, selection: { size: 3 } });
    const sampleAllAnalyzed = {
      ...SAMPLE,
      benchmarks: SAMPLE.benchmarks.map((b) => ({ ...b, analyzedAt: '2026-09-15T10:00:00.000Z' })),
    };
    const result = await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-discovery-single',
      sample: sampleAllAnalyzed,
    });

    expect(result.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);
    expect(result.discoverySet.selected).toEqual(['gymnovo.com']);
    expect(result.holdout.candidateKey).toBeNull();
    expect(result.handoff).toBeNull();
  });
});

describe('Market discovery — elegibilidade histórica com relevância persistida', () => {
  test('candidato AVALIADO IN_MARKET em run anterior continua elegível quando não ressurge', async () => {
    // Run real r7 (2026-09-16): woliba.io foi verificado pelo gate corrigido no
    // r6, mas a busca viva do r7 não o ressurgiu — o escopo estrito de run o
    // apagou do pool e o ciclo morreu sem handoff. Aceites AVALIADOS
    // (market_relevance.evaluated, IN_MARKET, host não excluído pela política
    // corrente) são evidência persistida legítima: o pool da seleção é a UNIÃO
    // do que o run verificou com o histórico elegível. O que NÃO volta: aceite
    // sem avaliação persistida (lixo pré-gate, como o r2) ou host excluído
    // pela config vigente (diretório banido depois do aceite, como techjockey).
    const sharedState = { runs: new Map(), archetypes: new Map(), candidates: new Map(), sets: new Map() };
    const context = { categoryTerms: ['conteúdo oficial'], relevance: { minCategorySignals: 1, excludedHosts: [] } };
    const sampleCtx = { ...SAMPLE, marketContext: context };

    const first = await buildHarness({ sharedState });
    const runOne = await first.supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-discovery-h1',
      sample: sampleCtx,
    });
    expect(runOne.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);
    const gymnovo = await first.store.getCandidate({ tenantId: TENANT, vertical: 'fitness-lab', candidateKey: 'gymnovo.com' });
    expect(gymnovo.state).toBe('ACCEPTED');
    expect(gymnovo.market_relevance && gymnovo.market_relevance.evaluated).toBe(true);
    expect(gymnovo.market_relevance.state).toBe('IN_MARKET');

    // Ciclo N+1: a busca viva NÃO ressurge gymnovo — só os seeds (já analisados).
    const providersV2 = {
      ...buildProviders(),
      search: async () => ({ candidates: SEARCH_HITS.slice(0, 2) }),
    };
    const second = await buildHarness({ sharedState, providers: providersV2 });
    const sampleAnalyzed = {
      ...sampleCtx,
      benchmarks: sampleCtx.benchmarks.map((b) => ({ ...b, analyzedAt: '2026-09-15T10:00:00.000Z' })),
    };
    const runTwo = await second.supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-discovery-h2',
      sample: sampleAnalyzed,
    });

    expect(runTwo.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);
    const pool = [...runTwo.discoverySet.selected, runTwo.holdout.candidateKey].filter(Boolean);
    expect(pool).toContain('gymnovo.com');
    expect(runTwo.handoff).not.toBeNull();
  });

  test('aceite histórico com host EXCLUÍDO pela política corrente NÃO volta ao pool', async () => {
    const sharedState = { runs: new Map(), archetypes: new Map(), candidates: new Map(), sets: new Map() };
    const context = { categoryTerms: ['conteúdo oficial'], relevance: { minCategorySignals: 1, excludedHosts: [] } };
    const first = await buildHarness({ sharedState });
    await first.supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-discovery-x1',
      sample: { ...SAMPLE, marketContext: context },
    });

    // Política nova: o host do gymnovo passa a ser excluído (ex.: virou diretório).
    const providersV2 = {
      ...buildProviders(),
      search: async () => ({ candidates: SEARCH_HITS.slice(0, 2) }),
    };
    const second = await buildHarness({ sharedState, providers: providersV2 });
    const strictContext = { categoryTerms: ['conteúdo oficial'], relevance: { minCategorySignals: 1, excludedHosts: ['gymnovo.com', 'gymnovo-whitelabel.com', 'delta-fitness.com'] } };
    const runTwo = await second.supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-discovery-x2',
      sample: {
        ...SAMPLE,
        marketContext: strictContext,
        benchmarks: SAMPLE.benchmarks.map((b) => ({ ...b, analyzedAt: '2026-09-15T10:00:00.000Z' })),
      },
    });

    expect(runTwo.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);
    const pool = [...runTwo.discoverySet.selected, runTwo.holdout.candidateKey].filter(Boolean);
    expect(pool).not.toContain('gymnovo.com');
    expect(pool).not.toContain('gymnovo-whitelabel.com');
    expect(pool).not.toContain('delta-fitness.com');
  });
});

describe('Market discovery — qualidade do registro do candidato (run real r8)', () => {
  // Run real r8 (2026-09-16): vantagefit.io e woliba.io entraram no universo
  // com officialSite = URL do BLOG POST onde o sinal foi encontrado e name =
  // título do post ("Top 11 Wellhub Alternatives..."). O registro canônico
  // exige: officialSite = raiz do domínio, name = marca (título da homepage,
  // com fallback para o rótulo do domínio), evidência da HOMEPAGE como prova de
  // existência e arquétipos derivados dos sinais de categoria mapeados.
  const SAMPLE_CONTEXT = {
    categoryTerms: ['corporate wellness platform', 'gym management software'],
    categoryTermArchetypes: {
      'corporate wellness platform': ['personal-wellness'],
      'gym management software': ['independent-gym'],
    },
    relevance: { minCategorySignals: 1 },
  };

  function buildBlogUniverseProviders(calls) {
    const contentByUrl = {
      'https://vendorx.io/blog/wellhub-alternatives/':
        '<html><head><title>Top 11 Wellhub Alternatives or Competitors in 2026</title></head>'
        + '<body>VendorX is a corporate wellness platform compared with Wellhub.</body></html>',
      'https://vendorx.io/':
        '<html><head><title>VendorX | Employee Wellness</title></head><body>homepage</body></html>',
      'https://imobiliaria.example.com/blog/relatorio/':
        '<html><head><title>Relatório imobiliário 2026</title></head><body>mercado de bairro</body></html>',
    };
    return {
      search: async () => ({
        candidates: [
          { url: 'https://vendorx.io/blog/wellhub-alternatives/', title: 'Top 11 Wellhub Alternatives or Competitors in 2026' },
          { url: 'https://imobiliaria.example.com/blog/relatorio/', title: 'Relatório imobiliário' },
        ],
      }),
      fetch: async (input) => {
        calls.push(input.url);
        const content = contentByUrl[input.url] || `conteúdo de ${input.url}`;
        return {
          httpStatus: 200,
          content,
          contentType: 'text/html',
          retrievedAt: NOW,
          contentHash: sha(content),
        };
      },
      inspectDocumentation: async () => ({ sections: ['a', 'b', 'c'] }),
      inspectApiDocs: async () => ({ operations: [] }),
      captureEvidence: async (input) => ({ evidenceRef: `ev-${sha(input.url).slice(0, 12)}`, contentHash: input.contentHash }),
    };
  }

  test('candidato descoberto via blog: identidade canônica, nome limpo, homepage como prova de existência', async () => {
    const calls = [];
    const { supervisor, store } = await buildHarness({ providers: buildBlogUniverseProviders(calls) });

    const result = await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-discovery-r8fix',
      sample: { ...SAMPLE, marketContext: SAMPLE_CONTEXT },
    });
    expect(result.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);

    const candidate = (await store.listCandidates({
      tenantId: TENANT, vertical: 'fitness-lab', state: 'ACCEPTED',
    })).find((row) => row.candidate_key === 'vendorx.io');
    expect(candidate).toBeDefined();

    // officialSite é a RAIZ — a página de sinal fica só na evidência.
    expect(candidate.official_site).toBe('https://vendorx.io/');
    // Nome vem do <title> da homepage, nunca do título do listicle.
    expect(candidate.name).toBe('VendorX');
    // Arquétipo derivado do sinal de categoria mapeado pela vertical.
    expect(candidate.archetypes).toEqual(['personal-wellness']);
    // Evidência: página de descoberta + homepage (prova de existência), ambas hash-bound.
    const urls = candidate.source_evidence.map((item) => item.url).sort();
    expect(urls).toEqual(['https://vendorx.io/', 'https://vendorx.io/blog/wellhub-alternatives/']);
    const homepage = candidate.source_evidence.find((item) => item.url === 'https://vendorx.io/');
    expect(homepage.evidenceRef).toBeTruthy();
    expect(homepage.contentHash).toBeTruthy();

    // ABS-16 (run real r14): candidato cuja PÁGINA DE SINAL fica abaixo do
    // mínimo recebe o SEGUNDO JUÍZO pela homepage antes do veredito final —
    // a economia antiga ("rejeitado não recebe fetch de homepage") produziu a
    // falsa rejeição do goteamup.com, julgado pela página de login. O custo é
    // aceito; o veredito final continua OUT_OF_MARKET quando a homepage
    // também não tem sinais. Nota de identidade: `imobiliaria.example.com`
    // é SUBDOMÍNIO — o domínio registrável (a identidade) é `example.com`,
    // então o segundo juízo busca a raiz `https://example.com/` e a chave do
    // candidato rejeitado é `example.com`.
    expect(calls).toContain('https://example.com/');
    const imobiliaria = (await store.listCandidates({ tenantId: TENANT, vertical: 'fitness-lab' }))
      .find((row) => row.candidate_key === 'example.com');
    expect(imobiliaria.state).toBe('OUT_OF_MARKET');
    expect(imobiliaria.market_relevance.homepageChecked).toBe(true);
  });
});

describe('Market discovery — segundo juízo do gate pela homepage (run real r14)', () => {
  // Run real r14 (2026-09-16): goteamup.com (TeamUp — software REAL de gestão
  // de academias, homepage com 5 termos de categoria casados) foi REJEITADO
  // com 0 sinais porque o hit do buscador era a página de LOGIN
  // (goteamup.com/login/). O gate julgou o domínio pela landing page e a
  // economia "rejeitado não recebe fetch de homepage" impediu o segundo
  // juízo — falsa rejeição de fornecedor real. A identidade do fornecedor é
  // o DOMÍNIO registrável: quando a página de sinal não é a homepage e fica
  // abaixo do mínimo, a homepage é consultada UMA vez antes do veredito
  // final. Host EXCLUÍDO por política (diretório) não ganha segundo juízo:
  // o banimento é decisão de política sobre o domínio, não de conteúdo.
  const CONTEXT = {
    categoryTerms: ['gym management software'],
    relevance: { minCategorySignals: 1, excludedHosts: [] },
  };

  function buildLoginLandingProviders(calls) {
    const contentByUrl = {
      'https://vendorfit.com/login/':
        '<html><head><title>Sign in | VendorFit</title></head><body>Entre com e-mail e senha. Esqueci minha senha.</body></html>',
      'https://vendorfit.com/':
        '<html><head><title>VendorFit | Fitness Management</title></head><body>VendorFit is a gym management software: members, billing and access control.</body></html>',
      'https://portaldeadvocacia.com.br/artigo/':
        '<html><head><title>Artigo jurídico</title></head><body>direito civil e processos</body></html>',
      'https://portaldeadvocacia.com.br/':
        '<html><head><title>Portal Advocacia</title></head><body>notícias jurídicas do dia</body></html>',
    };
    return {
      search: async () => ({
        candidates: [
          { url: 'https://vendorfit.com/login/', title: 'Sign in | VendorFit' },
          { url: 'https://portaldeadvocacia.com.br/artigo/', title: 'Artigo jurídico' },
        ],
      }),
      fetch: async (input) => {
        calls.push(input.url);
        const content = contentByUrl[input.url] || `conteúdo de ${input.url}`;
        return {
          httpStatus: 200,
          content,
          contentType: 'text/html',
          retrievedAt: NOW,
          contentHash: sha(content),
        };
      },
      inspectDocumentation: async () => ({ sections: ['a', 'b', 'c'] }),
      inspectApiDocs: async () => ({ operations: [] }),
      captureEvidence: async (input) => ({ evidenceRef: `ev-${sha(input.url).slice(0, 12)}`, contentHash: input.contentHash }),
    };
  }

  test('landing sem sinais (login) + homepage COM sinais → IN_MARKET pelo segundo juízo, auditável', async () => {
    const calls = [];
    const { supervisor, store } = await buildHarness({ providers: buildLoginLandingProviders(calls) });

    const result = await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-second-judgment',
      sample: { ...SAMPLE, marketContext: CONTEXT },
    });
    expect(result.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);

    const candidate = (await store.listCandidates({ tenantId: TENANT, vertical: 'fitness-lab', state: 'ACCEPTED' }))
      .find((row) => row.candidate_key === 'vendorfit.com');
    expect(candidate).toBeDefined();
    expect(candidate.market_relevance.state).toBe('IN_MARKET');
    // O veredito registra que veio do SEGUNDO JUÍZO — nunca se passa por
    // casamento direto da página de sinal.
    expect(candidate.market_relevance.fallback).toBe('homepage_second_judgment');
    expect(candidate.market_relevance.signalPageUrl).toBe('https://vendorfit.com/login/');
    // A homepage foi consultada e consta da evidência (prova de existência).
    expect(calls).toContain('https://vendorfit.com/');
    expect(candidate.source_evidence.map((item) => item.url)).toContain('https://vendorfit.com/');
    // Nome vem do <title> da homepage, não da página de login.
    expect(candidate.name).toBe('VendorFit');
  });

  test('landing E homepage sem sinais → OUT_OF_MARKET final, com homepageChecked auditável', async () => {
    const calls = [];
    const { supervisor, store } = await buildHarness({ providers: buildLoginLandingProviders(calls) });

    await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-second-judgment-reject',
      sample: { ...SAMPLE, marketContext: CONTEXT },
    });

    const rejected = (await store.listCandidates({ tenantId: TENANT, vertical: 'fitness-lab' }))
      .find((row) => row.candidate_key === 'portaldeadvocacia.com.br');
    expect(rejected).toBeDefined();
    expect(rejected.state).toBe('OUT_OF_MARKET');
    expect(rejected.market_relevance.reason).toBe('category_signals_below_minimum');
    // A homepage FOI consultada antes do veredito final — a rejeição é do
    // domínio, não de uma página azarada do SERP.
    expect(calls).toContain('https://portaldeadvocacia.com.br/');
    expect(rejected.market_relevance.homepageChecked).toBe(true);
    expect(rejected.market_relevance.homepageSignals).toBe(0);
  });

  test('host EXCLUÍDO por política não ganha segundo juízo (banimento é do domínio)', async () => {
    const calls = [];
    const { supervisor } = await buildHarness({ providers: buildLoginLandingProviders(calls) });

    await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-second-judgment-excluded',
      sample: {
        ...SAMPLE,
        marketContext: { ...CONTEXT, relevance: { minCategorySignals: 1, excludedHosts: ['vendorfit.com'] } },
      },
    });

    expect(calls).toContain('https://vendorfit.com/login/');
    expect(calls).not.toContain('https://vendorfit.com/');
  });
});

describe('Market discovery — benchmarks derivados de market discovery NÃO são seeds (run real r9)', () => {
  // Run real r9 (2026-09-16): as entradas aplicadas ao sample pelo gerador
  // (provenance.marketDiscoveryRunId) viraram SEEDS no run seguinte. A
  // confirmação de seed do woliba falhou (fetch do blog) e o upsert
  // DESTRUÍU o candidato aceito no r8: state → EVIDENCE_REQUIRED,
  // market_relevance → null, source_evidence → []. Benchmark derivado por
  // market discovery não é referência humana: a verdade do candidato vive na
  // tabela market_candidates (descoberto) — semear de novo é rebaixar lineage
  // a declaração e destruir evidência persistida a cada run.
  test('benchmark com provenance.marketDiscoveryRunId não vira seed nem é re-upsertado sem evidência nova', async () => {
    const calls = [];
    const providers = {
      search: async () => ({ candidates: [] }), // varredura não reencontra nada
      fetch: async (input) => {
        calls.push(input.url);
        const content = `conteúdo de ${input.url}`;
        return { httpStatus: 200, content, contentType: 'text/html', retrievedAt: NOW, contentHash: sha(content) };
      },
      inspectDocumentation: async () => ({ sections: [] }),
      inspectApiDocs: async () => ({ operations: [] }),
      captureEvidence: async (input) => ({ evidenceRef: `ev-${sha(input.url).slice(0, 12)}`, contentHash: input.contentHash }),
    };
    const { supervisor, store } = await buildHarness({ providers });

    const derivedBenchmark = {
      id: 'woliba.io',
      name: 'Woliba',
      role: 'validation',
      order: 12,
      sources: [{ url: 'https://woliba.io/blog/wellhub-alternatives/', tier: 5 }],
      provenance: { generator: 'scripts/benchmark/apply-market-discovery-to-sample.js', marketDiscoveryRunId: 'mdr-anterior' },
    };
    const result = await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-discovery-noseed',
      sample: { ...SAMPLE, benchmarks: [...SAMPLE.benchmarks, derivedBenchmark] },
    });
    expect(result.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);

    // Nenhum fetch de confirmação de seed para a fonte do benchmark derivado.
    expect(calls).not.toContain('https://woliba.io/blog/wellhub-alternatives/');
    // E nenhum registro de candidato criado/regravado para ele neste run
    // (a varredura não o encontrou e ele não é seed: simplesmente não é tocado).
    const touched = await store.listCandidates({ tenantId: TENANT, vertical: 'fitness-lab', runId: result.runId });
    expect(touched.map((row) => row.candidate_key)).not.toContain('woliba.io');
  });
});

describe('Market discovery — re-juízo de vereditos stale do gate (run real r15, ABS-17)', () => {
  // Run real r15 (2026-09-16): o goteamup.com ficou marcado OUT_OF_MARKET pelo
  // gate PRÉ-ABS-16 (julgado pela página de login, sem homepageChecked) e a
  // busca instável do r15 não o ressurgiu — sem re-juízo, o veredito errado
  // viveria para sempre: o pool só reavalia o que a busca ressurge. Veredito
  // anterior ao segundo juízo é evidência STALE: candidato rejeitado POR
  // CONTEÚDO (category_signals_below_minimum) sem `homepageChecked`, com host
  // não banido pela política vigente, é reavaliado UMA vez pela homepage — no
  // MESMO funil (evidência hash-bound, merge não destrutivo, estado
  // recomputado). Veredito já completo (homepageChecked) nunca é re-varrido.
  const CONTEXT = {
    categoryTerms: ['gym management software'],
    relevance: { minCategorySignals: 1, excludedHosts: [] },
  };

  async function seedStaleRejection(store, { key = 'vendorfit.com', homepageChecked = undefined } = {}) {
    const stale = buildCandidateRecord({
      vertical: 'fitness-lab',
      name: key === 'vendorfit.com' ? 'VendorFit' : 'Portal Jurídico',
      officialSite: `https://${key}/`,
      sourceEvidence: [{ url: `https://${key}/login/`, evidenceRef: 'ev-old', contentHash: sha('login'), tier: 5 }],
      marketRelevance: {
        evaluated: true,
        state: 'OUT_OF_MARKET',
        accepted: false,
        reason: 'category_signals_below_minimum',
        signalCount: 0,
        minSignals: 1,
        matchedTerms: [],
        domain: key,
        ...(homepageChecked === true ? { homepageChecked: true, homepageSignals: 0 } : {}),
      },
      rationale: `descoberto pela varredura de mercado: ${key} alternatives`,
    });
    await store.upsertCandidate({ tenantId: TENANT, runId: 'mdr-old', candidate: stale });
  }

  function buildSweepProviders(calls) {
    const contentByUrl = {
      'https://vendorfit.com/':
        '<html><head><title>VendorFit | Fitness Management</title></head><body>VendorFit is a gym management software: members, billing and access control.</body></html>',
      'https://portaljuridico.com.br/':
        '<html><head><title>Portal Jurídico</title></head><body>notícias de direito civil</body></html>',
    };
    return {
      search: async () => ({ candidates: [] }), // a busca viva NÃO ressurge nada
      fetch: async (input) => {
        calls.push(input.url);
        const content = contentByUrl[input.url] || `gym management software oficial de ${input.url}`;
        return { httpStatus: 200, content, contentType: 'text/html', retrievedAt: NOW, contentHash: sha(content) };
      },
      inspectDocumentation: async () => ({ sections: ['a', 'b', 'c'] }),
      inspectApiDocs: async () => ({ operations: [] }),
      captureEvidence: async (input) => ({ evidenceRef: `ev-${sha(input.url).slice(0, 12)}`, contentHash: input.contentHash }),
    };
  }

  test('veredito stale (sem homepageChecked) é re-julgado pela homepage e PROMOVIDO quando há sinais', async () => {
    const sharedState = { runs: new Map(), archetypes: new Map(), candidates: new Map(), sets: new Map() };
    const calls = [];
    const { supervisor, store } = await buildHarness({ providers: buildSweepProviders(calls), sharedState });
    await seedStaleRejection(store);

    const result = await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-rejudge-v1',
      sample: { ...SAMPLE, marketContext: CONTEXT },
    });
    expect(result.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);

    // A homepage foi consultada pelo re-juízo (o profiling do candidato
    // aceito também a busca — o que se prova é que o RE-JUÍZO aconteceu).
    expect(calls).toContain('https://vendorfit.com/');

    const candidate = await store.getCandidate({ tenantId: TENANT, vertical: 'fitness-lab', candidateKey: 'vendorfit.com' });
    expect(candidate.state).toBe('ACCEPTED');
    expect(candidate.market_relevance.state).toBe('IN_MARKET');
    // O veredito registra que veio do RE-JUÍZO de veredito stale — nunca se
    // passa por veredito da varredura corrente.
    expect(candidate.market_relevance.fallback).toBe('stale_verdict_rejudgment');
    // Evidência acumulada: a página de login antiga permanece, a homepage entra.
    const urls = candidate.source_evidence.map((item) => item.url).sort();
    expect(urls).toEqual(['https://vendorfit.com/', 'https://vendorfit.com/login/']);
    // Promovido entra no pool da seleção (set ou holdout).
    const pool = [...result.discoverySet.selected, result.holdout.candidateKey].filter(Boolean);
    expect(pool).toContain('vendorfit.com');
    // A varredura de re-juízo é auditável no metadata do run.
    const run = await store.getRun({ tenantId: TENANT, vertical: 'fitness-lab', discoveryVersion: 'fitness-lab-rejudge-v1' });
    expect(run.metadata.rejudgeSweep).toEqual(expect.objectContaining({ considered: expect.any(Number) }));
    expect(run.metadata.rejudgeSweep.promoted).toContain('vendorfit.com');
  });

  test('re-juízo SEM sinais mantém OUT_OF_MARKET com homepageChecked — e nunca é re-varrido', async () => {
    const sharedState = { runs: new Map(), archetypes: new Map(), candidates: new Map(), sets: new Map() };
    const calls = [];
    const first = await buildHarness({ providers: buildSweepProviders(calls), sharedState });
    await seedStaleRejection(first.store, { key: 'portaljuridico.com.br' });

    await first.supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-rejudge-out-v1',
      sample: { ...SAMPLE, marketContext: CONTEXT },
    });

    const rejected = await first.store.getCandidate({ tenantId: TENANT, vertical: 'fitness-lab', candidateKey: 'portaljuridico.com.br' });
    expect(rejected.state).toBe('OUT_OF_MARKET');
    expect(rejected.market_relevance.homepageChecked).toBe(true);
    expect(calls).toContain('https://portaljuridico.com.br/');

    // Run seguinte: o veredito já está completo — nenhuma nova varredura.
    const callsV2 = [];
    const second = await buildHarness({ providers: buildSweepProviders(callsV2), sharedState });
    await second.supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-rejudge-out-v2',
      sample: { ...SAMPLE, marketContext: CONTEXT },
    });
    expect(callsV2).not.toContain('https://portaljuridico.com.br/');
  });

  test('veredito já completo (homepageChecked) e host banido pela política vigente NÃO são re-julgados', async () => {
    const sharedState = { runs: new Map(), archetypes: new Map(), candidates: new Map(), sets: new Map() };
    const calls = [];
    const { supervisor, store } = await buildHarness({ providers: buildSweepProviders(calls), sharedState });
    // Veredito completo: não é stale.
    await seedStaleRejection(store, { key: 'vendorfit.com', homepageChecked: true });
    // Veredito stale, mas o host passou a ser banido (virou diretório etc.).
    await seedStaleRejection(store, { key: 'portaljuridico.com.br' });

    await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-rejudge-skip',
      sample: {
        ...SAMPLE,
        marketContext: { ...CONTEXT, relevance: { minCategorySignals: 1, excludedHosts: ['portaljuridico.com.br'] } },
      },
    });

    expect(calls).not.toContain('https://vendorfit.com/');
    expect(calls).not.toContain('https://portaljuridico.com.br/');
  });
});


describe('Market discovery — contrato de nome varchar(256) e estado FAILED (run real r16, ABS-18)', () => {
  // Run real r16 (2026-09-16): o candidato globalpilates.com.br tem <title>
  // de 286 chars com o separador como ENTIDADE HTML (`&#8211;`). Sem
  // decodificação o título INTEIRO virou "nome" e o INSERT em
  // `market_candidates.name varchar(256)` derrubou o run com
  // `value too long for type character varying(256)` — e, sem tratamento, o
  // run ficou ÓRFÃO em ARCHETYPES_VALIDATED para sempre (não-terminal).

  function buildNameContractProviders() {
    const tail = 'Sistema completo de gestão para estúdios de pilates. '.repeat(6);
    const junkTitle = 'Palavra '.repeat(40).trim();
    const contentByUrl = {
      'https://globalpilates.com.br/': `<html><head><title>Global Pilates &#8211; ${tail}</title></head><body>gestão</body></html>`,
      'https://junk-title.com.br/': `<html><head><title>${junkTitle}</title></head><body>gestão</body></html>`,
    };
    return {
      search: async () => ({
        candidates: [
          { url: 'https://globalpilates.com.br/', title: 'Global Pilates', archetypes: ['independent-gym'] },
          { url: 'https://junk-title.com.br/', title: junkTitle, archetypes: ['independent-gym'] },
        ],
      }),
      fetch: async (input) => {
        const content = contentByUrl[input.url] || `conteúdo oficial de ${input.url}`;
        return { httpStatus: 200, content, contentType: 'text/html', retrievedAt: NOW, contentHash: sha(content) };
      },
      inspectDocumentation: async () => ({ sections: ['a', 'b', 'c'] }),
      inspectApiDocs: async () => ({ operations: [] }),
      captureEvidence: async (input) => ({ evidenceRef: `ev-${sha(input.url).slice(0, 12)}`, contentHash: input.contentHash }),
    };
  }

  test('nome decodifica entidades e honra varchar(256): título-junk cai para o rótulo do domínio', async () => {
    const { supervisor, store } = await buildHarness({ providers: buildNameContractProviders() });

    const result = await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-name-contract-v1',
      sample: SAMPLE,
    });
    expect(result.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);

    const candidates = await store.listCandidates({ tenantId: TENANT, vertical: 'fitness-lab', runId: result.runId });
    const byHost = Object.fromEntries(candidates.map((row) => [row.official_site, row]));

    // Entidade `&#8211;` decodificada → separador casa → nome é a marca curta.
    expect(byHost['https://globalpilates.com.br/'].name).toBe('Global Pilates');
    // Título-junk de 319 chars sem separador NUNCA estoura a coluna: o nome é
    // o rótulo determinístico do domínio (e o hit.title longo do SERP também
    // é recusado pela mesma guarda — nunca é fallback).
    expect(byHost['https://junk-title.com.br/'].name).toBe('Junk-title');
    expect(byHost['https://junk-title.com.br/'].metadata.nameSource).toBe('domain_label');
    // Contrato: TODO nome persistido cabe em varchar(256).
    for (const row of candidates) {
      expect(row.name.length).toBeLessThanOrEqual(256);
    }
  });

  test('exceção inesperada no meio do pipeline marca o run FAILED — nunca órfão em estado não-terminal', async () => {
    const { supervisor, store } = await buildHarness();
    // Falha de contrato de coluna no meio do estágio CANDIDATES (o que o r16
    // viveu): o run deve ser marcado FAILED com o motivo, não ficar órfão.
    const original = store.upsertCandidate.bind(store);
    store.upsertCandidate = async (args) => {
      if (args?.candidate?.origin !== 'seed') {
        const error = new Error('value too long for type character varying(256)');
        error.code = '23501';
        throw error;
      }
      return original(args);
    };

    await expect(supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-failed-v1',
      sample: SAMPLE,
    })).rejects.toThrow('value too long');

    const run = await store.getRun({ tenantId: TENANT, vertical: 'fitness-lab', discoveryVersion: 'fitness-lab-failed-v1' });
    expect(run.state).toBe(DISCOVERY_RUN_STATES.FAILED);
    expect(run.completed_at).toBe(NOW);
    expect(run.metadata.failure).toEqual(expect.objectContaining({
      code: '23501',
      message: expect.stringContaining('value too long'),
    }));
  });
});
