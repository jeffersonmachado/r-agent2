'use strict';

/**
 * T-MR1/T-MR4/T-MR5 — SUPERFÍCIE HTTP REAL do Market Discovery.
 *
 * Antes deste módulo o marketDiscoverySupervisor era apenas biblioteca +
 * capability: nenhum chamador de runtime existia. Este arquivo prova:
 *
 *   1. as rotas existem e são DEVELOPMENT/SYSTEM-only (PRODUCTION → 403,
 *      tenant operacional → 403 `benchmark_research_system_tenant_required`);
 *   2. POST /api/market-discovery/runs executa a pipeline REAL (providers
 *      injetados, store injetado) e devolve o handoff;
 *   3. GET /runs e GET /runs/:runId leem o ESTADO PERSISTIDO — uma segunda
 *      aplicação sobre um store novo (mesmo backing = restart de processo)
 *      devolve o run completo (T-MR4);
 *   4. T-MR5: o holdout é pré-registrado ANTES de qualquer pesquisa profunda
 *      — provado contra o estado persistido produzido pela rota real, e o
 *      handoff HTTP recusa um set sem pré-registro;
 *   5. T-MR2: POST /runs/:runId/handoff abre o run de benchmark research
 *      carregando `marketDiscoveryRunId` como proveniência persistida.
 */

const http = require('http');
const express = require('express');
const crypto = require('crypto');

const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const { RESEARCH_CAPABILITY_IDS } = require('../../../api/services/benchmark/researchCapabilities');
const { createBenchmarkResearchService } = require('../../../api/services/benchmark/benchmarkResearchService');
const { createMarketDiscoveryMemoryStore } = require('../../helpers/marketDiscoveryMemoryStore');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');
const { createMarketDiscoveryRoutes } = require('../../../api/modules/market-discovery/routes');
const {
  DISCOVERY_RUN_STATES,
  DISCOVERY_RUN_OUTCOMES,
} = require('../../../api/services/marketDiscovery/marketDiscoverySupervisor');

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TENANT = 'system';
const VERTICAL = 'fitness-lab';

function sha(content) {
  return crypto.createHash('sha256').update(String(content)).digest('hex');
}

const SAMPLE = {
  vertical: VERTICAL,
  sampleVersion: 'runtime-routes-v1',
  archetypes: [
    { id: 'independent-gym', importance: 'REQUIRED', name: 'Academia independente' },
    { id: 'financial-billing', importance: 'REQUIRED', name: 'Financeiro e cobrança' },
  ],
  benchmarks: [
    {
      id: 'seed-alpha',
      name: 'Alpha Gym',
      archetype: 'independent-gym',
      independenceGroup: 'alpha',
      sources: [{ tier: 5, url: 'https://alpha-gym.com/' }],
    },
    {
      id: 'seed-beta',
      name: 'Beta Fit',
      archetype: 'financial-billing',
      independenceGroup: 'beta',
      sources: [{ tier: 5, url: 'https://beta-fit.com/' }],
    },
  ],
};

const SEARCH_HITS = [
  { url: 'https://alpha-gym.com/', title: 'Alpha Gym', country: 'BR', archetypes: ['independent-gym'], independenceGroup: 'alpha' },
  { url: 'https://beta-fit.com/', title: 'Beta Fit', country: 'BR', archetypes: ['financial-billing'], independenceGroup: 'beta' },
  { url: 'https://gymnovo.com/', title: 'GymNovo', country: 'US', archetypes: ['financial-billing'], independenceGroup: 'gymnovo' },
  { url: 'https://delta-fitness.com/', title: 'Delta Fitness', country: 'IE', archetypes: ['independent-gym'], independenceGroup: 'delta' },
];

function buildProviders() {
  return {
    search: async () => ({ candidates: SEARCH_HITS }),
    fetch: async (input) => {
      const content = `conteúdo oficial de ${input.url}`;
      return { httpStatus: 200, content, contentType: 'text/html', retrievedAt: '2026-09-15T12:00:00.000Z', contentHash: sha(content) };
    },
    inspectDocumentation: async () => ({ sections: ['Matrículas', 'Cobrança', 'Catraca', 'App', 'Relatórios', 'Planos', 'Turmas', 'CRM'] }),
    inspectApiDocs: async () => ({ operations: ['GET /members', 'POST /billing'] }),
    captureEvidence: async (input) => ({ evidenceRef: `ev-${sha(input.url).slice(0, 12)}`, contentHash: input.contentHash }),
  };
}

/** Relógio que avança 1ms por chamada: prova ORDEM estrita entre estágios. */
function tickingClock(start = '2026-09-15T12:00:00.000Z') {
  let tick = Date.parse(start);
  return () => new Date(tick++).toISOString();
}

function buildApp({ classification, tenant = TENANT, sharedState, benchmarkState } = {}) {
  const store = createMarketDiscoveryMemoryStore({ state: sharedState });
  const benchmarkStore = createBenchmarkResearchMemoryStore({ state: benchmarkState });
  const registry = createToolRegistry({ logger: silent });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.agent = { platformClassification: classification, tenantId: tenant, userId: 'u-1', username: 'engineer' };
    res.locals.agent = req.agent;
    next();
  });
  app.use(createMarketDiscoveryRoutes({
    buildDeps: () => ({
      requireAuth: (req) => ({ valid: true, agent: req.agent }),
      sendJson: (res, code, payload) => res.status(code).json(payload),
      badRequest: (res, message) => res.status(400).json({ error: 'bad_request', message }),
      hasJsonContentType: (req) => String(req.headers['content-type'] || '').includes('application/json'),
      parseJsonBody: async (req) => req.body || {},
      logger: silent,
    }),
    resolveDiscoveryDeps: () => ({
      store,
      registry,
      benchmarkStore,
      providers: buildProviders(),
      now: tickingClock(),
      // 4 candidatos aceitos, set de 2: sobra universo para o holdout.
      selection: { size: 2 },
    }),
  }));
  return { app, store, benchmarkStore };
}

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postJson(base, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return { status: response.status, body: await response.json() };
}

describe('T-MR1 — rotas de runtime do market discovery', () => {
  test('o módulo expõe as rotas canônicas', () => {
    const router = createMarketDiscoveryRoutes({ buildDeps: () => ({}), resolveDiscoveryDeps: () => ({}) });
    const paths = router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
    expect(paths).toEqual(expect.arrayContaining([
      'POST /api/market-discovery/runs',
      'GET /api/market-discovery/runs',
      'GET /api/market-discovery/runs/:runId',
      'POST /api/market-discovery/runs/:runId/handoff',
    ]));
  });

  test('PRODUCTION é recusado com 403 em todas as rotas', async () => {
    const { app } = buildApp({ classification: 'PRODUCTION' });
    await withServer(app, async (base) => {
      for (const request of [
        () => postJson(base, '/api/market-discovery/runs', { vertical: VERTICAL, sample: SAMPLE }),
        () => fetch(`${base}/api/market-discovery/runs`),
        () => fetch(`${base}/api/market-discovery/runs/mdr-qualquer`),
        () => postJson(base, '/api/market-discovery/runs/mdr-qualquer/handoff', {}),
      ]) {
        const response = await request();
        const status = response.status;
        const body = typeof response.json === 'function' ? await response.json() : response.body;
        expect(status).toBe(403);
        expect(body.error).toBe('classification_required');
      }
    });
  });

  test('tenant operacional é recusado (descoberta de mercado é SYSTEM/INTERNAL)', async () => {
    const { app } = buildApp({ classification: 'DEVELOPMENT', tenant: 'cliente-x' });
    await withServer(app, async (base) => {
      const response = await postJson(base, '/api/market-discovery/runs', { vertical: VERTICAL, sample: SAMPLE });
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('benchmark_research_system_tenant_required');
    });
  });

  test('SUPPORT é recusado (superfície de engenharia, não de suporte)', async () => {
    const { app } = buildApp({ classification: 'SUPPORT' });
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/market-discovery/runs`);
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe('classification_required');
    });
  });
});

describe('T-MR1 — POST /runs executa a pipeline real e persiste', () => {
  test('run completo: HANDED_OFF com handoff compatível com benchmark research', async () => {
    const { app } = buildApp({ classification: 'DEVELOPMENT' });
    await withServer(app, async (base) => {
      const started = await postJson(base, '/api/market-discovery/runs', {
        vertical: VERTICAL,
        discoveryVersion: 'runtime-v1',
        sample: SAMPLE,
      });
      expect(started.status).toBe(200);
      expect(started.body.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);
      expect(started.body.runId).toMatch(/^mdr-/);
      expect(started.body.handoff).toEqual(expect.objectContaining({
        tenantId: TENANT,
        vertical: VERTICAL,
        discoveryRunId: started.body.runId,
        holdoutBenchmarkId: expect.any(String),
      }));
      expect(started.body.handoff.benchmarkIds.length).toBeGreaterThan(0);

      const listed = await fetch(`${base}/api/market-discovery/runs?vertical=${VERTICAL}`);
      expect(listed.status).toBe(200);
      const listBody = await listed.json();
      expect(listBody.runs.map((run) => run.id)).toContain(started.body.runId);

      const fetched = await fetch(`${base}/api/market-discovery/runs/${started.body.runId}`);
      expect(fetched.status).toBe(200);
      const runBody = await fetched.json();
      expect(runBody.run.state).toBe(DISCOVERY_RUN_STATES.HANDED_OFF);
      expect(runBody.discoverySet.selected_candidates).toEqual(started.body.handoff.benchmarkIds);
      expect(runBody.discoverySet.holdout_preregistered).toBe(true);
    });
  });

  test('GET de run inexistente é 404 (nunca 200 vazio)', async () => {
    const { app } = buildApp({ classification: 'DEVELOPMENT' });
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/market-discovery/runs/mdr-inexistente`);
      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe('market_discovery_run_not_found');
    });
  });
});

describe('T-MR4 — o estado do run sobrevive ao restart do processo', () => {
  test('uma NOVA instância da aplicação (store novo, mesmo backing) devolve o run', async () => {
    // O backing compartilhado simula o Postgres: o que sobrevive ao restart é
    // o estado DURÁVEL, nunca memória de processo.
    const backing = { runs: new Map(), archetypes: new Map(), candidates: new Map(), sets: new Map() };
    const first = buildApp({ classification: 'DEVELOPMENT', sharedState: backing });
    await withServer(first.app, async (base) => {
      const started = await postJson(base, '/api/market-discovery/runs', {
        vertical: VERTICAL,
        discoveryVersion: 'restart-v1',
        sample: SAMPLE,
      });
      expect(started.status).toBe(200);

      // RESTART: nova aplicação, novo store, novo registry — MESMO backing
      // persistido. Nada do primeiro processo é reutilizado além do estado
      // durável (o que o Postgres garante em produção).
      const second = buildApp({ classification: 'DEVELOPMENT', sharedState: backing });
      await withServer(second.app, async (base2) => {
        const fetched = await fetch(`${base2}/api/market-discovery/runs/${started.body.runId}`);
        expect(fetched.status).toBe(200);
        const body = await fetched.json();
        expect(body.run.state).toBe(DISCOVERY_RUN_STATES.HANDED_OFF);
        expect(body.run.metadata.handoff.discoveryRunId).toBe(started.body.runId);
        expect(body.discoverySet.holdout_preregistered).toBe(true);
      });
    });
  });
});

describe('T-MR5 — holdout pré-registrado ANTES de qualquer pesquisa profunda (rota real)', () => {
  test('o estado persistido prova a ordem: pré-registro estritamente anterior à abertura', async () => {
    const { app, store } = buildApp({ classification: 'DEVELOPMENT' });
    await withServer(app, async (base) => {
      const started = await postJson(base, '/api/market-discovery/runs', {
        vertical: VERTICAL,
        discoveryVersion: 'holdout-order-v1',
        sample: SAMPLE,
      });
      expect(started.status).toBe(200);

      const set = await store.getDiscoverySet({ tenantId: TENANT, setId: started.body.handoff.discoverySetId });
      expect(set.holdout_preregistered).toBe(true);
      expect(Date.parse(set.holdout_selected_at)).toBeLessThan(Date.parse(set.opened_at));

      // O candidato holdout NUNCA recebeu deep_research_at nesta pipeline: a
      // pesquisa profunda pertence ao subsistema de benchmark research, depois
      // do handoff.
      const holdout = await store.getCandidate({ tenantId: TENANT, vertical: VERTICAL, candidateKey: set.holdout_candidate_id });
      expect(holdout.deep_research_at).toBeNull();

      // E o handoff persistido declara o instante do pré-registro.
      const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL, discoveryVersion: 'holdout-order-v1' });
      expect(run.metadata.handoff.holdoutPreregisteredAt).toBe(set.holdout_selected_at);
    });
  });

  test('handoff HTTP recusa discovery set SEM pré-registro de holdout', async () => {
    const { app, store } = buildApp({ classification: 'DEVELOPMENT' });
    // Run "cru" com set sem pré-registro: simula um run que tentou pular a
    // ordem. A rota de handoff deve recusar fail-closed.
    const run = await store.openRun({ tenantId: TENANT, vertical: VERTICAL, discoveryVersion: 'no-holdout-v1' });
    await store.upsertCandidate({
      tenantId: TENANT,
      runId: run.id,
      candidate: { vertical: VERTICAL, candidateKey: 'alpha-gym.com', name: 'Alpha Gym', state: 'ACCEPTED', sourceEvidence: [{ url: 'https://alpha-gym.com/', evidenceRef: 'ev-1' }] },
    });
    const set = await store.recordDiscoverySet({
      tenantId: TENANT,
      runId: run.id,
      set: { vertical: VERTICAL, discoverySetVersion: 'no-holdout-v1', selectedCandidates: ['alpha-gym.com'] },
    });
    await store.updateRunState({
      tenantId: TENANT,
      runId: run.id,
      state: DISCOVERY_RUN_STATES.HANDED_OFF,
      metadata: {
        handoff: {
          tenantId: TENANT,
          vertical: VERTICAL,
          researchVersion: 'no-holdout-v1-deep-research',
          benchmarkIds: ['alpha-gym.com'],
          holdoutBenchmarkId: null,
          discoverySetId: set.id,
          discoveryRunId: run.id,
          holdoutPreregisteredAt: null,
        },
      },
    });

    await withServer(app, async (base) => {
      const response = await postJson(base, `/api/market-discovery/runs/${run.id}/handoff`, {});
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('market_discovery_holdout_not_preregistered');
    });
  });
});

describe('T-MR2 — lineage Market Discovery → Benchmark Research pela rota real', () => {
  test('handoff abre o run de benchmark com marketDiscoveryRunId persistido', async () => {
    const { app, benchmarkStore } = buildApp({ classification: 'DEVELOPMENT' });
    await withServer(app, async (base) => {
      const started = await postJson(base, '/api/market-discovery/runs', {
        vertical: VERTICAL,
        discoveryVersion: 'lineage-v1',
        sample: SAMPLE,
      });
      expect(started.status).toBe(200);

      const handedOff = await postJson(base, `/api/market-discovery/runs/${started.body.runId}/handoff`, {});
      expect(handedOff.status).toBe(200);
      expect(handedOff.body.lineage).toEqual(expect.objectContaining({
        source: 'market-discovery',
        marketDiscoveryRunId: started.body.runId,
        discoverySetId: started.body.handoff.discoverySetId,
      }));
      expect(handedOff.body.benchmarkRun.discoverySet).toEqual(started.body.handoff.benchmarkIds);
      expect(handedOff.body.benchmarkRun.holdoutBenchmarkId).toBe(started.body.handoff.holdoutBenchmarkId);

      // A proveniência está PERSISTIDA no run de benchmark (metadata JSONB).
      const benchmarkRun = await benchmarkStore.getRun({ tenantId: TENANT, vertical: VERTICAL, researchVersion: 'lineage-v1-deep-research' });
      expect(benchmarkRun.metadata.lineage).toEqual(expect.objectContaining({
        marketDiscoveryRunId: started.body.runId,
        discoverySetId: started.body.handoff.discoverySetId,
        holdoutPreregisteredAt: expect.any(String),
      }));
    });
  });
});
