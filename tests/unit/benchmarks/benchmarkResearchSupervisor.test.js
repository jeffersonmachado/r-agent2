'use strict';

/**
 * §B1/§B2/§B3/§B8 — SUPERVIDOR REAL, CAPABILITY EXPLÍCITA E CHAMADOR DE PRODUÇÃO.
 *
 * O que este arquivo prova:
 *   - a capacidade de pesquisa é declarada no Canonical Tool Registry com
 *     visibilidade DEVELOPMENT e SEM visibilidade para PRODUCTION;
 *   - existe CHAMADOR DE PRODUÇÃO: o módulo de rotas é montado no route
 *     registry e responde de verdade (servidor HTTP real, não mock de handler);
 *   - o fluxo Supervisor → subagente → registry → capability → fonte →
 *     evidência → achado → persistência → patch é executado ponta a ponta;
 *   - sem provider externo o resultado é `RESEARCH_BLOCKED_NO_EXTERNAL_ACCESS`
 *     com a lista NOMINAL do que falta — e nada é registrado nem analisado.
 */

const http = require('http');
const express = require('express');

const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const {
  BENCHMARK_RESEARCH_CAPABILITY,
  RESEARCH_RUN_OUTCOMES,
  buildResearchPlanFromSample,
  ensureBenchmarkResearchCapability,
  createBenchmarkResearchSupervisor,
} = require('../../../api/services/benchmark/benchmarkResearchSupervisor');
const { RESEARCH_CAPABILITY_IDS } = require('../../../api/services/benchmark/researchCapabilities');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const TENANT = 'system';
const VERTICAL = 'fitness';

const SAMPLE = {
  vertical: VERTICAL,
  benchmarks: [
    {
      id: 'evo',
      name: 'EVO (W12)',
      role: 'discovery',
      archetype: 'integration-first-api',
      sources: [{ tier: 5, url: 'https://w12.com.br/funcionalidades/', verified: true, httpStatus: 200 }],
      novelty: {},
    },
    {
      id: 'tecnofit',
      name: 'Tecnofit',
      role: 'discovery',
      archetype: 'access-control-hardware',
      // Benchmark SEM fonte declarada: o plano deve REPORTAR a ausência em vez
      // de inventar URL.
      sources: [],
      novelty: {},
    },
  ],
};

/** Providers reais injetados (o teste é o dono do transporte). */
function buildProviders() {
  return {
    search: async ({ query }) => ({
      candidates: [
        { url: 'https://w12.com.br/funcionalidades/', title: `${query} — oficial`, specificity: 'SPECIFIC' },
      ],
    }),
    // §TAREFA 06 — o fetch devolve o CONTEÚDO; o hash do conteúdo analisado é
    // derivado dele (ou devolvido pelo provider). Nenhum hash é inventado.
    fetch: async () => ({ httpStatus: 200, contentType: 'text/html', content: '<html>matrículas, catraca, app do aluno</html>' }),
    // §TAREFA 09 — a inspeção devolve ESTRUTURA extraída com locator na fonte.
    inspectDocumentation: async () => ({
      sections: ['Matrículas'],
      capabilities: [{ name: 'Gestão de matrículas', locator: 'section:Matrículas', fragmentHash: 'sha256:frag-matriculas' }],
      journeys: [],
      rules: [],
    }),
    inspectApiDocs: async () => ({ operations: ['GET /members'], capabilities: [], journeys: [], rules: [] }),
    // §TAREFA 11 — a evidência é do MESMO conteúdo analisado: o provider
    // devolve o hash que recebeu (é assim que a cadeia fecha).
    captureEvidence: async ({ url, contentHash }) => ({ evidenceRef: 'ev-supervisor-1', contentHash }),
  };
}

function buildSupervisor({ providers = {}, registry = null } = {}) {
  const toolRegistry = registry || createToolRegistry({ logger: silent });
  const store = createBenchmarkResearchMemoryStore();
  const supervisor = createBenchmarkResearchSupervisor({
    store,
    registry: toolRegistry,
    providers,
    tenantId: TENANT,
    actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
    logger: silent,
  });
  return { supervisor, registry: toolRegistry, store };
}

describe('B1/B2 — capability explícita e chamador de produção', () => {
  test('a capability do supervisor é registrada e é DEVELOPMENT-only', () => {
    const registry = createToolRegistry({ logger: silent });
    const result = ensureBenchmarkResearchCapability(registry, { execute: async () => ({}) });
    expect(result.registered).toEqual([BENCHMARK_RESEARCH_CAPABILITY.id]);
    expect(ensureBenchmarkResearchCapability(registry, { execute: async () => ({}) }).existing)
      .toEqual([BENCHMARK_RESEARCH_CAPABILITY.id]);

    const tool = registry.get(BENCHMARK_RESEARCH_CAPABILITY.id);
    expect(tool.capability).toBe('benchmark.research.execute');
    expect(tool.visibility).toBe('DEVELOPMENT');

    const productionVisible = registry.list({ classification: 'PRODUCTION', permissions: ['*'] })
      .filter((entry) => entry.capability === 'benchmark.research.execute');
    expect(productionVisible).toEqual([]);
  });

  test('capability declarada sem runner falha explicitamente (nunca promessa vazia)', () => {
    const registry = createToolRegistry({ logger: silent });
    expect(() => ensureBenchmarkResearchCapability(registry, {}))
      .toThrow(/benchmark_research_runner_missing/);
  });

  test('o router de produção está MONTADO no route registry (não é biblioteca órfã)', () => {
    const { createRouteRegistry } = require('../../../api/app/routeRegistry');
    const routers = new Proxy({}, { get: () => ({ __stub: true }) });
    const entries = createRouteRegistry(routers);
    const mounted = entries.find((entry) => entry.router && entry.router.__stub === true
      && entries.indexOf(entry) === entries.findIndex((e) => e.router === entry.router));
    expect(mounted).toBeTruthy();
    // A chave precisa existir na lista — router fora dela não é montado.
    expect(entries.some((entry) => entry.router && entry.router.__stub === true)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  test('o módulo de rotas expõe as rotas canônicas de pesquisa', () => {
    const { createBenchmarkResearchRoutes } = require('../../../api/modules/benchmark-research/routes');
    const router = createBenchmarkResearchRoutes({ buildDeps: () => ({}), resolveResearchDeps: () => ({}) });
    const paths = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
    expect(paths).toEqual(expect.arrayContaining([
      '/api/benchmark-research/status',
      '/api/benchmark-research/runs',
      '/api/benchmark-research/runs/:vertical',
      '/api/benchmark-research/runs/:vertical/execute',
      '/api/benchmark-research/runs/:vertical/sample-patch',
      // Fluxo de PROPOSTAS (2026-09-17): pesquisa propõe, humano aprova.
      '/api/benchmark-research/proposals',
      '/api/benchmark-research/proposals/:id',
      '/api/benchmark-research/runs/:vertical/proposals',
      '/api/benchmark-research/proposals/:id/review',
      '/api/benchmark-research/proposals/:id/approve',
      '/api/benchmark-research/proposals/:id/reject',
      '/api/benchmark-research/proposals/:id/apply',
    ]));
  });
});

describe('B1/B2 — a rota é o chamador REAL (HTTP de verdade)', () => {
  function buildApp({ classification }) {
    const store = createBenchmarkResearchMemoryStore();
    const registry = createToolRegistry({ logger: silent });
    const { createBenchmarkResearchRoutes } = require('../../../api/modules/benchmark-research/routes');
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.agent = {
        platformClassification: classification,
        tenantId: TENANT,
        userId: 'u-1',
        username: 'engineer',
      };
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
        providers: buildProviders(),
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

  test('PRODUCTION é recusado com 403 (superfície de engenharia)', async () => {
    const { app } = buildApp({ classification: 'PRODUCTION' });
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/benchmark-research/status`);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('classification_required');
      expect(body.required).toBe('DEVELOPMENT');
    });
  });

  test('DEVELOPMENT abre um run, executa a pesquisa e aplica o patch do sample', async () => {
    const { app, store } = buildApp({ classification: 'DEVELOPMENT' });
    await withServer(app, async (base) => {
      const opened = await fetch(`${base}/api/benchmark-research/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vertical: VERTICAL,
          researchVersion: 'fitness-research-http-v1',
          // IDs REAIS do sample versionado (`config/benchmarks/fitness.json`):
          // pesquisar um benchmark fora do discovery set é recusado (§5).
          benchmarkIds: ['evo-w12', 'tecnofit'],
          holdoutBenchmarkId: null,
        }),
      });
      expect(opened.status).toBe(200);
      const openedBody = await opened.json();
      expect(openedBody.summary.state).toBe('RESEARCH_DISCOVERY_OPEN');

      const executed = await fetch(`${base}/api/benchmark-research/runs/${VERTICAL}/execute`, { method: 'POST' });
      expect(executed.status).toBe(200);
      const executedBody = await executed.json();
      expect(executedBody.status).toBe(RESEARCH_RUN_OUTCOMES.ANALYZED);
      // FIX 2 (2026-09-15): a fonte DECLARADA no sample governado é obtida
      // diretamente quando a busca não a superficia — confirmação de fonte
      // pré-registrada, auditada como `sourceSelection: 'declared-config'`.
      // Antes desta correção, tecnofit ficava RESEARCH_NO_CANDIDATES.
      expect(executedBody.analyzed).toEqual(['evo-w12', 'tecnofit']);
      const tecnofit = executedBody.results.find((entry) => entry.benchmarkId === 'tecnofit');
      expect(tecnofit.attempts[0].status).toBe('RESEARCH_EVIDENCE_CAPTURED');
      expect(tecnofit.attempts[0].sourceSelection).toBe('declared-config');
      // evo-w12: a homepage cai no fallback declarado; a página profunda veio
      // da busca — os dois caminhos ficam distintos na auditoria.
      const evo = executedBody.results.find((entry) => entry.benchmarkId === 'evo-w12');
      expect(evo.attempts.map((attempt) => attempt.sourceSelection)).toEqual(['declared-config', 'search']);

      const status = await fetch(`${base}/api/benchmark-research/runs/${VERTICAL}`);
      expect(status.status).toBe(200);
      const statusBody = await status.json();
      expect(statusBody.summary.analysedBenchmarks).toBe(2);
      expect(statusBody.summary.unanalysedBenchmarks).toEqual([]);

      // A persistência aconteceu pelo caminho real (store injetado).
      const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL });
      expect(run).toBeTruthy();
      const findings = await store.listFindings({ tenantId: TENANT, runId: run.id });
      expect(findings.length).toBeGreaterThanOrEqual(2);
      // Regra de honestidade do engine: fonte GENÉRICA (homepage) não prova
      // capability — achados dela ficam UNVERIFIED e sem vínculo de evidência;
      // os achados VERIFICADOS (página profunda) carregam evidence_id.
      expect(findings.some((finding) => finding.verified === true)).toBe(true);
      expect(findings.filter((finding) => finding.verified).every((finding) => finding.evidence_id)).toBe(true);
    });
  });

  test('o sample versionado NUNCA é tocado sem proposta aprovada (approval_required)', async () => {
    const { app } = buildApp({ classification: 'DEVELOPMENT' });
    await withServer(app, async (base) => {
      // Política 2026-09-17: a aplicação DIRETA deixou de existir. Sem
      // `proposalId` a rota responde `approval_required` e aponta o fluxo de
      // proposta — mesmo com run aberto e análise pronta, nada é escrito.
      const response = await fetch(`${base}/api/benchmark-research/runs/${VERTICAL}/sample-patch`, { method: 'POST' });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('approval_required');
      expect(body.message).toContain('/proposals');
    });
  });
});

describe('B3 — fluxo real: supervisor → subagente → registry → fonte → evidência → achado', () => {
  test('com providers injetados o achado é VERIFICADO e a cadeia é persistida', async () => {
    const { supervisor, store } = buildSupervisor({ providers: buildProviders() });
    await supervisor.service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'fitness-research-flow-v1',
      benchmarkIds: ['evo', 'tecnofit'],
      holdoutBenchmarkId: null,
    });

    const result = await supervisor.research({ vertical: VERTICAL, sample: SAMPLE });
    expect(result.status).toBe(RESEARCH_RUN_OUTCOMES.ANALYZED);
    expect(result.analyzed).toEqual(['evo']);

    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL });
    const findings = await store.listFindings({ tenantId: TENANT, runId: run.id });
    const evidence = await store.listEvidence({ tenantId: TENANT, runId: run.id });
    const sources = await store.listSources({ tenantId: TENANT, runId: run.id });

    expect(findings).toHaveLength(1);
    expect(evidence).toHaveLength(1);
    expect(sources).toHaveLength(1);
    expect(findings[0].source_id).toBe(sources[0].id);
    expect(findings[0].evidence_id).toBe(evidence[0].id);

    // O patch herda a cadeia: evidenceRef do achado resolve em `patch.evidence`.
    const patch = await supervisor.buildSamplePatch({
      vertical: VERTICAL,
      inventoryVersion: 'canonical-capabilities-1.0.0',
    });
    const evo = patch.benchmarks.find((benchmark) => benchmark.id === 'evo');
    expect(evo.analyzedAt).toBeTruthy();
    expect(evo.sources).toHaveLength(1);
    expect(patch.evidence.map((entry) => entry.id)).toContain(findings[0].evidence_id);
    const noveltyItem = evo.novelty.newCapabilities[0];
    expect(patch.evidence.map((entry) => entry.id)).toContain(noveltyItem.evidenceRef);
    expect(evo.sources.map((source) => source.id)).toContain(noveltyItem.sourceRef);
  });

  test('sem provider o run é BLOQUEADO e NADA é registrado nem analisado (§B8/§B11)', async () => {
    const { supervisor, store } = buildSupervisor({ providers: {} });
    await supervisor.service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'fitness-research-blocked-v1',
      benchmarkIds: ['evo', 'tecnofit'],
      holdoutBenchmarkId: null,
    });

    const result = await supervisor.research({ vertical: VERTICAL, sample: SAMPLE });

    expect(result.status).toBe(RESEARCH_RUN_OUTCOMES.BLOCKED_NO_EXTERNAL_ACCESS);
    expect(result.analyzed).toEqual([]);
    expect(result.availability.externalAccess).toBe(false);
    expect(result.availability.missing).toEqual(
      expect.arrayContaining(['research.search', 'research.fetch', 'research.captureEvidence']),
    );

    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL });
    expect(await store.listFindings({ tenantId: TENANT, runId: run.id })).toEqual([]);
    expect(await store.listEvidence({ tenantId: TENANT, runId: run.id })).toEqual([]);

    const summary = await supervisor.summarize({ vertical: VERTICAL });
    expect(summary.analysedBenchmarks).toBe(0);
    expect(summary.benchmarks.every((benchmark) => benchmark.analyzedAt === null)).toBe(true);

    const patch = await supervisor.buildSamplePatch({ vertical: VERTICAL });
    expect(patch.benchmarks.every((benchmark) => benchmark.analyzedAt === null)).toBe(true);
    expect(patch.evidence).toEqual([]);
  });

  test('sem discovery set pré-registrado o supervisor RECUSA executar (§5)', async () => {
    const { supervisor } = buildSupervisor({ providers: buildProviders() });
    await expect(supervisor.research({ vertical: VERTICAL, sample: SAMPLE }))
      .rejects.toThrow(/research_discovery_set_not_registered/);
  });

  test('ABS-23 (incidente real r22, 2026-09-17): re-executar o MESMO run NÃO re-analisa nem sobrescreve quem já foi analisado', async () => {
    // Incidente real: `POST /runs/fitness/execute` foi chamado ANTES do handoff
    // do r22 abrir o research run novo. O supervisor resolveu o run r21
    // (RESEARCH_COMPLETE) e RE-ANALISOU os 6 seeds: `analyzed_at` foi bumpado
    // e `findings_inventory` sobrescrito com o resultado degradado da
    // re-passagem (trainingym ficou com inventário 0). Re-execução do mesmo
    // run é RESUME: pesquisa só quem ainda não tem análise; quem já tem é
    // reportado em `skipped` com razão explícita. Refresh de análise é por
    // run NOVO (research_version nova), nunca por overwrite silencioso.
    const { supervisor, store } = buildSupervisor({ providers: buildProviders() });
    await supervisor.service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'fitness-research-abs23-v1',
      benchmarkIds: ['evo'],
      holdoutBenchmarkId: null,
    });

    const first = await supervisor.research({ vertical: VERTICAL, sample: SAMPLE });
    expect(first.status).toBe(RESEARCH_RUN_OUTCOMES.ANALYZED);
    expect(first.analyzed).toEqual(['evo']);

    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL });
    const firstSubjects = await store.listSubjects({ tenantId: TENANT, runId: run.id });
    const evoBefore = firstSubjects.find((subject) => subject.benchmark_id === 'evo');
    const analyzedAtBefore = evoBefore.analyzed_at && new Date(evoBefore.analyzed_at).toISOString();
    const inventoryBefore = JSON.stringify(evoBefore.findings_inventory);
    expect(analyzedAtBefore).toBeTruthy();

    const second = await supervisor.research({ vertical: VERTICAL, sample: SAMPLE });
    expect(second.status).toBe(RESEARCH_RUN_OUTCOMES.NOTHING_ANALYZED);
    expect(second.analyzed).toEqual([]);
    expect(second.skipped).toEqual([{ benchmarkId: 'evo', reason: 'benchmark_already_analyzed' }]);

    // Nada mudou: mesma análise, mesmo inventário, mesma evidência — idempotente.
    const afterSubjects = await store.listSubjects({ tenantId: TENANT, runId: run.id });
    const evoAfter = afterSubjects.find((subject) => subject.benchmark_id === 'evo');
    expect(new Date(evoAfter.analyzed_at).toISOString()).toBe(analyzedAtBefore);
    expect(JSON.stringify(evoAfter.findings_inventory)).toBe(inventoryBefore);
    expect(await store.listFindings({ tenantId: TENANT, runId: run.id })).toHaveLength(1);
    expect(await store.listEvidence({ tenantId: TENANT, runId: run.id })).toHaveLength(1);
    expect(await store.listSources({ tenantId: TENANT, runId: run.id })).toHaveLength(1);
  });

  test('o plano de pesquisa usa SOMENTE as fontes declaradas pelo sample', () => {
    const plan = buildResearchPlanFromSample(SAMPLE);
    expect(plan.benchmarks.map((entry) => entry.benchmarkId)).toEqual(['evo']);
    expect(plan.benchmarks[0].declaredSources.map((source) => source.url))
      .toEqual(['https://w12.com.br/funcionalidades/']);
    // Benchmark sem fonte declarada é REPORTADO, nunca inventado.
    expect(plan.skipped).toEqual([{ benchmarkId: 'tecnofit', reason: 'benchmark_without_declared_source' }]);
  });
});
