'use strict';

/**
 * T-B3 — SATURATION REACHABILITY: a saturação aparente é ALCANÇÁVEL em produção.
 *
 * GAP (auditoria 2026-09-15): `markApparentSaturation` existia no serviço mas
 * NÃO tinha chamador de produção — nenhuma rota, nenhum supervisor. Consequência:
 * `assertHoldoutNotAnalyzedEarly` bloqueava para sempre a análise do holdout
 * pelo caminho vivo da API (proteção vira beco sem saída).
 *
 * Contrato:
 *   1. o supervisor marca a saturação aparente AUTOMATICAMENTE quando
 *      `evaluateSaturation` sobre a janela analisada passa nos thresholds da
 *      política (capability + journey + businessRule = PASS);
 *   2. existe rota DEVELOPMENT `POST /api/benchmark-research/runs/:vertical/apparent-saturation`
 *      (o módulo endereça runs por `:vertical` — mesma convenção das demais rotas);
 *   3. ANTES da saturação, `assertHoldoutNotAnalyzedEarly` continua bloqueando;
 *      DEPOIS, a análise do holdout é legalmente possível.
 */

const http = require('http');
const express = require('express');

const engine = require('../../../qa/benchmarks/benchmarkSufficiencyEngine');
const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const {
  createBenchmarkResearchSupervisor,
  RESEARCH_RUN_OUTCOMES,
} = require('../../../api/services/benchmark/benchmarkResearchSupervisor');
const { RESEARCH_BLOCKERS } = require('../../../api/services/benchmark/benchmarkResearchService');
const { RESEARCH_CAPABILITY_IDS } = require('../../../api/services/benchmark/researchCapabilities');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TENANT = 'system';
const VERTICAL = 'fitness';
const CONTENT_HASH = 'sha256:saturation-fixture-v1';

const SAMPLE = {
  vertical: VERTICAL,
  sampleVersion: 'saturation-reachability-v1',
  inventoryVersion: 'inv-1',
  canonicalInventoryBaseline: 10,
  canonicalJourneyInventoryBaseline: 5,
  canonicalBusinessRuleInventoryBaseline: 5,
  benchmarks: [
    {
      id: 'alpha', name: 'Alpha', role: 'discovery', order: 1, archetype: 'a1',
      independenceGroup: 'g-alpha', sources: [{ url: 'https://alpha.test/docs', tier: 5 }], novelty: {},
    },
    {
      id: 'beta', name: 'Beta', role: 'discovery', order: 2, archetype: 'a1',
      independenceGroup: 'g-beta', sources: [{ url: 'https://beta.test/docs', tier: 5 }], novelty: {},
    },
    {
      id: 'hold', name: 'Hold', role: 'validation', order: 3, archetype: 'a2',
      independenceGroup: 'g-hold', sources: [{ url: 'https://hold.test/docs', tier: 5 }], novelty: {},
    },
  ],
};

/** Providers que encontram as fontes declaradas e NÃO extraem novidade alguma. */
function zeroFindingProviders() {
  return {
    search: async () => ({
      candidates: [
        { url: 'https://alpha.test/docs', title: 'alpha docs', specificity: 'SPECIFIC' },
        { url: 'https://beta.test/docs', title: 'beta docs', specificity: 'SPECIFIC' },
        { url: 'https://hold.test/docs', title: 'hold docs', specificity: 'SPECIFIC' },
      ],
    }),
    fetch: async ({ url }) => ({
      httpStatus: 200, contentType: 'text/html', content: `<html>${url}</html>`, contentHash: CONTENT_HASH,
    }),
    inspectDocumentation: async () => ({ sections: ['Recursos'], capabilities: [], journeys: [], rules: [] }),
    inspectApiDocs: async () => ({ operations: [], capabilities: [], journeys: [], rules: [] }),
    captureEvidence: async ({ url, contentHash }) => ({ evidenceRef: `ev:${url}`, contentHash }),
  };
}

function buildSupervisor({ store = null } = {}) {
  const researchStore = store || createBenchmarkResearchMemoryStore();
  const supervisor = createBenchmarkResearchSupervisor({
    store: researchStore,
    registry: createToolRegistry({ logger: silent }),
    providers: zeroFindingProviders(),
    tenantId: TENANT,
    actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
    logger: silent,
  });
  return { supervisor, store: researchStore };
}

async function openRun(supervisor) {
  return supervisor.service.openDiscoverySet({
    tenantId: TENANT,
    vertical: VERTICAL,
    researchVersion: 'saturation-reachability-v1',
    benchmarkIds: ['alpha', 'beta', 'hold'],
    holdoutBenchmarkId: 'hold',
  });
}

describe('T-B3 — supervisor marca a saturação aparente automaticamente', () => {
  test('máquina de estados completa: openRun → discovery analisado → saturação aparente → holdout analisado', async () => {
    const { supervisor } = buildSupervisor();
    await openRun(supervisor);

    // ANTES: o holdout está protegido — análise cedo é violação de ordem.
    await expect(supervisor.service.markAnalyzed({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'hold',
      marketArchetypeMapping: { archetype: 'a2' },
    })).rejects.toThrow(new RegExp(RESEARCH_BLOCKERS.HOLDOUT_ORDER_VIOLATION));

    const first = await supervisor.research({ vertical: VERTICAL, sample: SAMPLE });
    expect(first.status).toBe(RESEARCH_RUN_OUTCOMES.ANALYZED);
    expect(first.analyzed).toEqual(expect.arrayContaining(['alpha', 'beta']));
    // O holdout NÃO foi analisado nesta passagem: a ordem foi respeitada e a
    // recusa é reportada nominalmente.
    expect(first.analyzed).not.toContain('hold');
    const holdResult = first.results.find((entry) => entry.benchmarkId === 'hold');
    expect(String(holdResult.analysisRefused || '')).toMatch(/research_holdout_analyzed_before_saturation/);

    // AUTO-MARCAÇÃO: a janela analisada passou nos thresholds da política.
    expect(first.saturation).toBeTruthy();
    expect(first.saturation.marked).toBe(true);
    const summary = await supervisor.summarize({ vertical: VERTICAL });
    expect(summary.saturationReached).toBe(true);

    // DEPOIS: a análise do holdout é legalmente possível — e acontece.
    const second = await supervisor.research({ vertical: VERTICAL, sample: SAMPLE });
    expect(second.analyzed).toContain('hold');

    const finalSummary = await supervisor.summarize({ vertical: VERTICAL });
    expect(finalSummary.analysedBenchmarks).toBe(3);
    expect(finalSummary.state).toBe('RESEARCH_COMPLETE');
    expect(finalSummary.benchmarks.find((benchmark) => benchmark.id === 'hold').analyzedAt).toBeTruthy();
  });

  test('janela insuficiente NÃO marca saturação (ausência de trabalho nunca é saturação)', async () => {
    const { supervisor } = buildSupervisor();
    await openRun(supervisor);

    const partialSample = {
      ...SAMPLE,
      benchmarks: SAMPLE.benchmarks.filter((benchmark) => benchmark.id !== 'beta'),
    };
    const result = await supervisor.research({ vertical: VERTICAL, sample: partialSample });

    expect(result.saturation.marked).toBe(false);
    const summary = await supervisor.summarize({ vertical: VERTICAL });
    expect(summary.saturationReached).toBe(false);

    // E o holdout continua bloqueado.
    await expect(supervisor.service.markAnalyzed({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'hold',
      marketArchetypeMapping: { archetype: 'a2' },
    })).rejects.toThrow(new RegExp(RESEARCH_BLOCKERS.HOLDOUT_ORDER_VIOLATION));
  });

  test('a marcação automática corresponde ao que o engine mede sobre a janela', async () => {
    const { supervisor } = buildSupervisor();
    await openRun(supervisor);
    const result = await supervisor.research({ vertical: VERTICAL, sample: SAMPLE });
    expect(result.saturation.gates).toEqual({ capability: 'PASS', journey: 'PASS', businessRule: 'PASS' });
    expect(engine.RATE_STATES.MEASURED).toBeDefined();
  });
});

describe('T-B3 — rota DEVELOPMENT de saturação aparente (chamador de produção)', () => {
  const { createBenchmarkResearchRoutes } = require('../../../api/modules/benchmark-research/routes');

  function buildApp({ classification, providers = null }) {
    const store = createBenchmarkResearchMemoryStore();
    const registry = createToolRegistry({ logger: silent });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.agent = { platformClassification: classification, tenantId: TENANT, userId: 'u-1', username: 'engineer' };
      res.locals.agent = req.agent;
      next();
    });
    app.use(createBenchmarkResearchRoutes({
      buildDeps: () => ({
        requireAuth: (req) => ({ valid: true, agent: req.agent }),
        requirePermission: () => ({ allowed: true }),
        sendJson: (res, code, payload) => res.status(code).json(payload),
        badRequest: (res, message) => res.status(400).json({ error: 'bad_request', message }),
        hasJsonContentType: (req) => String(req.headers['content-type'] || '').includes('application/json'),
        parseJsonBody: async (req) => req.body || {},
        logger: silent,
      }),
      resolveResearchDeps: () => ({
        store,
        registry,
        providers: providers || zeroFindingProviders(),
        tenantId: TENANT,
        actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
      }),
    }));
    return { app, store };
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

  test('a rota existe no módulo', () => {
    const router = createBenchmarkResearchRoutes({ buildDeps: () => ({}), resolveResearchDeps: () => ({}) });
    const paths = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
    expect(paths).toContain('/api/benchmark-research/runs/:vertical/apparent-saturation');
  });

  test('PRODUCTION é recusado com 403', async () => {
    const { app } = buildApp({ classification: 'PRODUCTION' });
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/benchmark-research/runs/${VERTICAL}/apparent-saturation`, { method: 'POST' });
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe('classification_required');
    });
  });

  test('DEVELOPMENT marca a saturação e o holdout passa a ser analisável', async () => {
    const { app, store } = buildApp({ classification: 'DEVELOPMENT' });
    await withServer(app, async (base) => {
      const opened = await fetch(`${base}/api/benchmark-research/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vertical: VERTICAL,
          researchVersion: 'saturation-route-v1',
          benchmarkIds: ['alpha', 'beta', 'hold'],
          holdoutBenchmarkId: 'hold',
        }),
      });
      expect(opened.status).toBe(200);

      // Antes da marcação: holdout bloqueado.
      const summaryBefore = await (await fetch(`${base}/api/benchmark-research/runs/${VERTICAL}`)).json();
      expect(summaryBefore.summary.saturationReached).toBe(false);

      const marked = await fetch(`${base}/api/benchmark-research/runs/${VERTICAL}/apparent-saturation`, { method: 'POST' });
      expect(marked.status).toBe(200);
      const markedBody = await marked.json();
      expect(markedBody.saturationReached).toBe(true);
      expect(markedBody.summary.saturationReached).toBe(true);
    });

    // Efeito real no estado: o serviço agora ACEITA a análise do holdout.
    const { createBenchmarkResearchService } = require('../../../api/services/benchmark/benchmarkResearchService');
    const service = createBenchmarkResearchService({ store });
    for (const axis of ['CAPABILITY_AXIS', 'JOURNEY_AXIS', 'BUSINESS_RULE_AXIS']) {
      await service.setAxisState({
        tenantId: TENANT, vertical: VERTICAL, benchmarkId: 'hold', axis, state: 'RESEARCHED_NO_FINDINGS',
      });
    }
    await service.recordInspections({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'hold',
      inspections: { documentation: true, api: true },
    });
    await service.recordSourceInspection({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'hold',
      source: {
        url: 'https://hold.test/docs', tier: 5, specificity: 'SPECIFIC',
        verified: true, httpStatus: 200, contentHash: CONTENT_HASH,
      },
      evidenceRef: 'ev:https://hold.test/docs',
      analyzedContentHash: CONTENT_HASH,
      axisStatuses: {
        CAPABILITY_AXIS: 'RESEARCHED_NO_FINDINGS',
        JOURNEY_AXIS: 'RESEARCHED_NO_FINDINGS',
        BUSINESS_RULE_AXIS: 'RESEARCHED_NO_FINDINGS',
      },
    });
    const analyzed = await service.markAnalyzed({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'hold',
      marketArchetypeMapping: { archetype: 'a2' },
    });
    expect(analyzed.analyzedAt).toBeTruthy();
  });
});
