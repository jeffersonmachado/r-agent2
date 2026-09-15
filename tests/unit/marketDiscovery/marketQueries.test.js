'use strict';

/**
 * FIX 3 (2026-09-15) — qualidade das queries de descoberta de mercado.
 *
 * A varredura REAL da vertical fitness com queries genéricas
 * (`fitness software gestão mercado fornecedores`) descobriu lojas de roupa e
 * páginas de Wikipedia: o termo "fitness" não denota a CATEGORIA de mercado.
 * As queries agora derivam do contexto de mercado DECLARADO no config da
 * vertical (`marketContext`) — config-driven, determinístico, nunca hardcoded
 * por fornecedor no código.
 */

const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const { RESEARCH_CAPABILITY_IDS } = require('../../../api/services/benchmark/researchCapabilities');
const {
  createMarketDiscoverySupervisor,
  DISCOVERY_RUN_OUTCOMES,
  buildDiscoveryPrincipal,
} = require('../../../api/services/marketDiscovery/marketDiscoverySupervisor');
const {
  buildMarketQueries,
  competitorQueryName,
  DEFAULT_COMPETITOR_PATTERNS,
} = require('../../../api/services/marketDiscovery/marketQueries');
const { createMarketDiscoveryMemoryStore } = require('../../helpers/marketDiscoveryMemoryStore');

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TENANT = 'system';
const NOW = '2026-09-15T12:00:00.000Z';

const SAMPLE = {
  vertical: 'fitness-lab',
  archetypes: [
    { id: 'independent-gym', importance: 'REQUIRED', name: 'Academia independente', evidence: 'texto histórico' },
  ],
  marketContext: {
    categoryTerms: [
      'gym management software',
      'software para academia gestão',
    ],
    competitorPatterns: ['{competitor} alternatives'],
  },
  benchmarks: [
    {
      id: 'seed-alpha',
      name: 'Alpha Gym (AG Suite)',
      archetype: 'independent-gym',
      independenceGroup: 'alpha',
      sources: [{ tier: 5, url: 'https://alpha-gym.com/' }],
    },
    {
      id: 'seed-beta',
      name: 'Beta Fit',
      archetype: 'independent-gym',
      independenceGroup: 'beta',
      sources: [{ tier: 5, url: 'https://beta-fit.com/' }],
    },
  ],
};

describe('marketQueries — derivação config-driven e determinística', () => {
  test('termos de categoria primeiro (ordem declarada), depois padrões por concorrente (ordem do sample)', () => {
    const queries = buildMarketQueries({ vertical: 'fitness-lab', sample: SAMPLE });
    expect(queries).toEqual([
      'gym management software',
      'software para academia gestão',
      'Alpha Gym alternatives',
      'Beta Fit alternatives',
    ]);
  });

  test('o nome do concorrente vem do sample sem o parêntese de aliases', () => {
    expect(competitorQueryName({ name: 'EVO (W12 / ABC Evo)' })).toBe('EVO');
    expect(competitorQueryName({ name: 'Next Fit' })).toBe('Next Fit');
  });

  test('sem competitorPatterns declarado usa o default alternatives/competitors', () => {
    const sample = {
      ...SAMPLE,
      marketContext: { categoryTerms: ['gym management software'] },
      benchmarks: [{ id: 'a', name: 'Alpha Gym', sources: [] }],
    };
    expect(DEFAULT_COMPETITOR_PATTERNS).toEqual(['{competitor} alternatives', '{competitor} competitors']);
    expect(buildMarketQueries({ vertical: 'fitness-lab', sample })).toEqual([
      'gym management software',
      'Alpha Gym alternatives',
      'Alpha Gym competitors',
    ]);
  });

  test('determinístico e sem duplicatas exatas', () => {
    const a = buildMarketQueries({ vertical: 'fitness-lab', sample: SAMPLE });
    const b = buildMarketQueries({ vertical: 'fitness-lab', sample: SAMPLE });
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  test('sem marketContext o fallback genérico anterior é preservado', () => {
    expect(buildMarketQueries({ vertical: 'fitness', sample: { vertical: 'fitness', benchmarks: [] } }))
      .toEqual(['fitness software gestão mercado fornecedores', 'fitness platform competitors official']);
    expect(buildMarketQueries({ vertical: 'fitness', sample: null }))
      .toEqual(['fitness software gestão mercado fornecedores', 'fitness platform competitors official']);
  });

  test('o config REAL da vertical fitness produz queries de categoria de mercado', () => {
    // eslint-disable-next-line global-require
    const fitness = require('../../../config/benchmarks/fitness.json');
    const queries = buildMarketQueries({ vertical: 'fitness', sample: fitness });
    expect(queries.slice(0, 3)).toEqual([
      'gym management software',
      'fitness studio management platform',
      'gym membership management software',
    ]);
    expect(queries).toContain('software para academia gestão');
    expect(queries).toContain('EVO alternatives');
    expect(queries).toContain('Zen Planner competitors');
    // Nenhuma query genérica residual da vertical crua.
    expect(queries).not.toContain('fitness software gestão mercado fornecedores');
  });
});

describe('marketDiscoverySupervisor — varredura usa as queries do contexto declarado', () => {
  // A busca de MERCADO não retorna candidatos (o que interessa é medir as
  // queries); a confirmação dos seeds usa a URL declarada e fecha a cadeia
  // para que o pipeline complete com um discovery set não vazio.
  function buildProviders({ seenQueries }) {
    return {
      search: async ({ query }) => {
        seenQueries.push(query);
        return { candidates: [] };
      },
      fetch: async (input) => {
        const content = `conteúdo oficial de ${input.url}`;
        return { httpStatus: 200, content, contentType: 'text/html', contentHash: `sha256:${content.length}-fake` };
      },
      inspectDocumentation: async () => ({ sections: ['Matrículas', 'Cobrança', 'Catraca'] }),
      inspectApiDocs: async () => ({ operations: ['GET /members'] }),
      captureEvidence: async (input) => ({ evidenceRef: `ev-${input.url}`, contentHash: input.contentHash }),
    };
  }

  test('sem marketQueries explícitas, o MARKET scan executa as queries derivadas do sample', async () => {
    const seenQueries = [];
    const registry = createToolRegistry({ logger: silent });
    const store = createMarketDiscoveryMemoryStore();
    const supervisor = createMarketDiscoverySupervisor({
      store,
      registry,
      providers: buildProviders({ seenQueries }),
      tenantId: TENANT,
      actor: buildDiscoveryPrincipal(),
      now: () => NOW,
      logger: silent,
      selection: { size: 1 },
    });

    const result = await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-queries-v1',
      sample: SAMPLE,
    });

    expect(result.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);
    const expected = buildMarketQueries({ vertical: 'fitness-lab', sample: SAMPLE });
    expect(seenQueries.slice(0, expected.length)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(2);

    const run = await store.getRun({ tenantId: TENANT, vertical: 'fitness-lab', discoveryVersion: 'fitness-lab-queries-v1' });
    expect(run.metadata.marketScan.map((entry) => entry.query)).toEqual(expected);
  });

  test('marketQueries explícitas continuam tendo precedência (override do chamador)', async () => {
    const seenQueries = [];
    const registry = createToolRegistry({ logger: silent });
    const store = createMarketDiscoveryMemoryStore();
    const supervisor = createMarketDiscoverySupervisor({
      store,
      registry,
      providers: buildProviders({ seenQueries }),
      tenantId: TENANT,
      actor: buildDiscoveryPrincipal(),
      now: () => NOW,
      logger: silent,
      selection: { size: 1 },
    });

    await supervisor.discover({
      vertical: 'fitness-lab',
      discoveryVersion: 'fitness-lab-queries-override-v1',
      sample: SAMPLE,
      marketQueries: ['query customizada do chamador'],
    });

    expect(seenQueries[0]).toBe('query customizada do chamador');
  });
});
