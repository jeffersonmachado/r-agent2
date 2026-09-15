'use strict';

/**
 * T-MR2 — LINEAGE Market Discovery → Benchmark Research (nível de serviço).
 *
 * O discovery set produzido por um run de mercado ABRE um run de benchmark
 * research (`openDiscoverySet` com os benchmarkIds + holdout pré-registrado)
 * carregando `marketDiscoveryRunId` como proveniência PERSISTIDA no metadata
 * do run de benchmark. Sem isso, a cadeia mercado → benchmark seria narrativa:
 * dois subsistemas vizinhos sem vínculo auditável.
 *
 * Provas:
 *   1. `openDiscoverySet` persiste `metadata.lineage` quando a lineage é
 *      declarada — e recusa lineage malformada (sem runId de origem);
 *   2. `discoveryHandoff.openBenchmarkResearchRun` executa a cadeia completa
 *      sobre stores reais (memória de teste com o MESMO contrato do Postgres):
 *      run de mercado → handoff → run de benchmark com lineage;
 *   3. o handoff é fail-closed: set inexistente, set de OUTRO run ou set sem
 *      pré-registro de holdout são recusados antes de abrir qualquer run.
 */

const crypto = require('crypto');

const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const { createBenchmarkResearchService } = require('../../../api/services/benchmark/benchmarkResearchService');
const { createMarketDiscoverySupervisor } = require('../../../api/services/marketDiscovery/marketDiscoverySupervisor');
const { createDiscoveryHandoff, LINEAGE_ERROR_CODES } = require('../../../api/services/marketDiscovery/discoveryHandoff');
const { createMarketDiscoveryMemoryStore } = require('../../helpers/marketDiscoveryMemoryStore');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TENANT = 'system';
const VERTICAL = 'fitness-lab';

function sha(content) {
  return crypto.createHash('sha256').update(String(content)).digest('hex');
}

const SAMPLE = {
  vertical: VERTICAL,
  archetypes: [
    { id: 'independent-gym', importance: 'REQUIRED', name: 'Academia independente' },
    { id: 'financial-billing', importance: 'REQUIRED', name: 'Financeiro e cobrança' },
  ],
  benchmarks: [
    { id: 'seed-alpha', name: 'Alpha Gym', archetype: 'independent-gym', independenceGroup: 'alpha', sources: [{ tier: 5, url: 'https://alpha-gym.com/' }] },
    { id: 'seed-beta', name: 'Beta Fit', archetype: 'financial-billing', independenceGroup: 'beta', sources: [{ tier: 5, url: 'https://beta-fit.com/' }] },
  ],
};

const SEARCH_HITS = [
  { url: 'https://alpha-gym.com/', title: 'Alpha Gym', country: 'BR', archetypes: ['independent-gym'], independenceGroup: 'alpha' },
  { url: 'https://beta-fit.com/', title: 'Beta Fit', country: 'BR', archetypes: ['financial-billing'], independenceGroup: 'beta' },
  { url: 'https://gymnovo.com/', title: 'GymNovo', country: 'US', archetypes: ['financial-billing'], independenceGroup: 'gymnovo' },
];

function buildProviders() {
  return {
    search: async () => ({ candidates: SEARCH_HITS }),
    fetch: async (input) => {
      const content = `docs oficiais de ${input.url}`;
      return { httpStatus: 200, content, contentType: 'text/html', contentHash: sha(content) };
    },
    inspectDocumentation: async () => ({ sections: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] }),
    inspectApiDocs: async () => ({ operations: ['GET /members'] }),
    captureEvidence: async (input) => ({ evidenceRef: `ev-${sha(input.url).slice(0, 12)}`, contentHash: input.contentHash }),
  };
}

function tickingClock(start = '2026-09-15T12:00:00.000Z') {
  let tick = Date.parse(start);
  return () => new Date(tick++).toISOString();
}

async function runMarketDiscovery({ marketStore } = {}) {
  const store = marketStore || createMarketDiscoveryMemoryStore();
  const registry = createToolRegistry({ logger: silent });
  const supervisor = createMarketDiscoverySupervisor({
    store,
    registry,
    providers: buildProviders(),
    tenantId: TENANT,
    now: tickingClock(),
    logger: silent,
    selection: { size: 2 },
  });
  const result = await supervisor.discover({ vertical: VERTICAL, discoveryVersion: 'lineage-svc-v1', sample: SAMPLE });
  return { store, result };
}

describe('openDiscoverySet — campo de lineage', () => {
  test('persiste metadata.lineage com marketDiscoveryRunId', async () => {
    const store = createBenchmarkResearchMemoryStore();
    const service = createBenchmarkResearchService({ store, now: tickingClock() });
    await service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'lineage-direct-v1',
      benchmarkIds: ['alpha', 'beta'],
      holdoutBenchmarkId: 'gamma',
      lineage: {
        source: 'market-discovery',
        marketDiscoveryRunId: 'mdr-origem',
        discoverySetId: 'mds-origem',
        holdoutPreregisteredAt: '2026-09-15T12:00:00.000Z',
      },
    });
    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL, researchVersion: 'lineage-direct-v1' });
    expect(run.metadata.lineage).toEqual({
      source: 'market-discovery',
      marketDiscoveryRunId: 'mdr-origem',
      discoverySetId: 'mds-origem',
      holdoutPreregisteredAt: '2026-09-15T12:00:00.000Z',
    });
  });

  test('recusa lineage sem marketDiscoveryRunId (proveniência incompleta não é lineage)', async () => {
    const store = createBenchmarkResearchMemoryStore();
    const service = createBenchmarkResearchService({ store, now: tickingClock() });
    await expect(service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'lineage-invalid-v1',
      benchmarkIds: ['alpha'],
      lineage: { source: 'market-discovery' },
    })).rejects.toMatchObject({ code: 'market_discovery_lineage_invalid' });
    // Nada foi persistido.
    expect(await store.getRun({ tenantId: TENANT, vertical: VERTICAL, researchVersion: 'lineage-invalid-v1' })).toBeNull();
  });

  test('sem lineage o run abre normalmente e sem proveniência fabricada', async () => {
    const store = createBenchmarkResearchMemoryStore();
    const service = createBenchmarkResearchService({ store, now: tickingClock() });
    await service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'no-lineage-v1',
      benchmarkIds: ['alpha'],
    });
    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL, researchVersion: 'no-lineage-v1' });
    expect(run.metadata?.lineage).toBeUndefined();
  });
});

describe('discoveryHandoff — cadeia mercado → benchmark executável', () => {
  test('run de mercado abre run de benchmark com lineage persistida e vínculo recíproco', async () => {
    const { store, result } = await runMarketDiscovery();
    expect(result.status).toBe('MARKET_DISCOVERY_COMPLETED');

    const benchmarkStore = createBenchmarkResearchMemoryStore();
    const benchmarkService = createBenchmarkResearchService({ store: benchmarkStore, now: tickingClock('2026-09-15T13:00:00.000Z') });
    const handoff = createDiscoveryHandoff({ marketStore: store, benchmarkService, now: tickingClock('2026-09-15T14:00:00.000Z') });

    const opened = await handoff.openBenchmarkResearchRun({ tenantId: TENANT, handoff: result.handoff });
    expect(opened.lineage).toEqual(expect.objectContaining({
      source: 'market-discovery',
      marketDiscoveryRunId: result.runId,
      discoverySetId: result.discoverySet.id,
      holdoutPreregisteredAt: expect.any(String),
    }));
    expect(opened.benchmarkRun.discoverySet).toEqual(result.discoverySet.selected);
    expect(opened.benchmarkRun.holdoutBenchmarkId).toBe(result.holdout.candidateKey);

    // Lineage persistida no run de benchmark.
    const benchmarkRun = await benchmarkStore.getRun({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: result.handoff.researchVersion,
    });
    expect(benchmarkRun.metadata.lineage.marketDiscoveryRunId).toBe(result.runId);

    // Vínculo recíproco: o discovery set de mercado registra o handoff aberto.
    const set = await store.getDiscoverySet({ tenantId: TENANT, setId: result.discoverySet.id });
    expect(set.metadata.benchmarkResearchHandoff).toEqual(expect.objectContaining({
      researchVersion: result.handoff.researchVersion,
      lineage: expect.objectContaining({ marketDiscoveryRunId: result.runId }),
    }));
  });

  test('recusa handoff de outro run (proveniência não confere com o set persistido)', async () => {
    const { store, result } = await runMarketDiscovery();
    const benchmarkService = createBenchmarkResearchService({ store: createBenchmarkResearchMemoryStore(), now: tickingClock() });
    const handoff = createDiscoveryHandoff({ marketStore: store, benchmarkService, now: tickingClock() });

    await expect(handoff.openBenchmarkResearchRun({
      tenantId: TENANT,
      handoff: { ...result.handoff, discoveryRunId: 'mdr-adulterado' },
    })).rejects.toMatchObject({ code: LINEAGE_ERROR_CODES.LINEAGE_MISMATCH });
  });

  test('recusa set sem pré-registro de holdout ANTES de abrir o run de benchmark', async () => {
    const store = createMarketDiscoveryMemoryStore();
    const benchmarkStore = createBenchmarkResearchMemoryStore();
    const benchmarkService = createBenchmarkResearchService({ store: benchmarkStore, now: tickingClock() });
    const handoff = createDiscoveryHandoff({ marketStore: store, benchmarkService, now: tickingClock() });

    const run = await store.openRun({ tenantId: TENANT, vertical: VERTICAL, discoveryVersion: 'sem-holdout-v1' });
    await store.upsertCandidate({
      tenantId: TENANT,
      runId: run.id,
      candidate: { vertical: VERTICAL, candidateKey: 'alpha-gym.com', name: 'Alpha Gym', state: 'ACCEPTED', sourceEvidence: [{ url: 'https://alpha-gym.com/', evidenceRef: 'ev-1' }] },
    });
    const set = await store.recordDiscoverySet({
      tenantId: TENANT,
      runId: run.id,
      set: { vertical: VERTICAL, discoverySetVersion: 'sem-holdout-v1', selectedCandidates: ['alpha-gym.com'] },
    });

    await expect(handoff.openBenchmarkResearchRun({
      tenantId: TENANT,
      handoff: {
        tenantId: TENANT,
        vertical: VERTICAL,
        researchVersion: 'sem-holdout-v1-deep-research',
        benchmarkIds: ['alpha-gym.com'],
        holdoutBenchmarkId: null,
        discoverySetId: set.id,
        discoveryRunId: run.id,
        holdoutPreregisteredAt: null,
      },
    })).rejects.toMatchObject({ code: LINEAGE_ERROR_CODES.HOLDOUT_NOT_PREREGISTERED });

    // Fail-closed: NENHUM run de benchmark foi aberto.
    expect(await benchmarkStore.getRun({ tenantId: TENANT, vertical: VERTICAL })).toBeNull();
  });
});
