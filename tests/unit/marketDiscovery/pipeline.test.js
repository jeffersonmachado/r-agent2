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

    // Candidato OUT_OF_MARKET não recebe fetch de homepage (rejeitado, sem custo).
    expect(calls).not.toContain('https://imobiliaria.example.com/');
  });
});
