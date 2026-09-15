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
      sources: [{ tier: 5, url: 'https://alpha.example.com/' }],
      dimensions: { geography: 'BR', customerSize: 'small' },
    },
    {
      id: 'seed-beta',
      name: 'Beta Fit',
      archetype: 'financial-billing',
      independenceGroup: 'beta',
      sources: [{ tier: 5, url: 'https://beta.example.com/' }],
      dimensions: { geography: 'BR', customerSize: 'medium' },
    },
  ],
};

/** Universo que a "pesquisa" encontra: 2 seeds + 1 novo + 1 white-label do novo. */
const SEARCH_HITS = [
  { url: 'https://alpha.example.com/', title: 'Alpha Gym', country: 'BR', archetypes: ['independent-gym'] },
  { url: 'https://beta.example.com/', title: 'Beta Fit', country: 'BR', archetypes: ['financial-billing'] },
  { url: 'https://gymnovo.example.com/', title: 'GymNovo', country: 'US', archetypes: ['student-digital-experience'], segments: ['boutique'], independenceGroup: 'gymnovo' },
  { url: 'https://wl.gymnovo.example.com/', title: 'GymNovo WhiteLabel', country: 'US', archetypes: ['student-digital-experience'], cloneOf: 'gymnovo', independenceGroup: 'wl-proprio' },
  { url: 'https://delta.example.com/', title: 'Delta Fitness', country: 'IE', archetypes: ['independent-gym'], segments: ['rede'], independenceGroup: 'delta' },
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

async function buildHarness({ providers = buildProviders(), sharedState } = {}) {
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
    selection: { size: 3 },
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
    const gymnovo = await store.getCandidate({ tenantId: TENANT, vertical: 'fitness-lab', candidateKey: 'gymnovo' });
    expect(gymnovo.state).toBe('ACCEPTED');
    expect(gymnovo.origin).toBe('research');
    expect(gymnovo.profiled_at).toBe(NOW);
    expect(gymnovo.deep_research_at).toBeNull(); // profiling NUNCA é pesquisa profunda

    // Clone/white-label não conta como diversidade real.
    expect(result.diversity.totalCandidates).toBe(5);
    expect(result.diversity.independentCount).toBe(4);
    expect(result.diversity.clones).toEqual([
      { candidateKey: 'gymnovo-whitelabel', cloneOf: 'gymnovo' },
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

  test('o supervisor é superfície DEVELOPMENT com tenant SYSTEM', async () => {
    const { supervisor } = await buildHarness();
    expect(supervisor.capability.visibility).toBe('DEVELOPMENT');
    expect(supervisor.actor.classification).toBe('DEVELOPMENT');
    expect(supervisor.actor.tenant).toBe('system');
    expect(supervisor.tenantId).toBe('system');
  });
});
