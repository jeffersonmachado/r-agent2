'use strict';

/**
 * E2E (sem rede): o PROVIDER NATIVO de pesquisa, com transporte injetado,
 * atende a cadeia completa Supervisor → subagente → Canonical Tool Registry →
 * capability `research.*` → fonte → evidência → achado → persistência.
 *
 * Prova também a precedência de resolução: o provider nativo é selecionado
 * ANTES de qualquer provider externo (`native_preferred`).
 */

const crypto = require('crypto');

const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const { createNativeResearchProvider } = require('../../../api/services/research/nativeResearchProvider');
const {
  RESEARCH_RUN_OUTCOMES,
  createBenchmarkResearchSupervisor,
} = require('../../../api/services/benchmark/benchmarkResearchSupervisor');
const {
  RESEARCH_CAPABILITY_IDS,
  executeResearchCapability,
} = require('../../../api/services/benchmark/researchCapabilities');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const TENANT = 'system';
const VERTICAL = 'fitness';
const SOURCE_URL = 'https://w12.com.br/funcionalidades/';

const DDG_FIXTURE = `<html><body>
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fw12.com.br%2Ffuncionalidades%2F">EVO W12 — Funcionalidades oficiais</a>
</body></html>`;

const SITE_FIXTURE = `<html><body>
<h1>Funcionalidades</h1>
<p>Gestão de matrículas e planos para academias</p>
<h2>Cobrança</h2>
<p>Cobrança recorrente de mensalidades com multa por atraso</p>
<h2>App do aluno</h2>
<p>Onboarding passo a passo e congelamento de contrato</p>
</body></html>`;

const SAMPLE = {
  vertical: VERTICAL,
  benchmarks: [
    {
      id: 'evo',
      name: 'EVO (W12)',
      role: 'discovery',
      archetype: 'integration-first-api',
      sources: [{ tier: 5, url: SOURCE_URL }],
      novelty: {},
    },
  ],
};

function fakeTransport() {
  const calls = [];
  const transport = async ({ url }) => {
    calls.push(url);
    if (url.startsWith('https://html.duckduckgo.com/')) {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(DDG_FIXTURE, 'utf8') };
    }
    if (url === SOURCE_URL) {
      return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(SITE_FIXTURE, 'utf8') };
    }
    return { status: 404, headers: {}, body: Buffer.from('not found', 'utf8') };
  };
  return { transport, calls };
}

function buildStack() {
  const { transport, calls } = fakeTransport();
  const providers = createNativeResearchProvider({
    transport,
    resolveAddresses: async () => ['93.184.216.34'],
    now: () => 1_700_000_000_000,
    sleep: async () => {},
    logger: silent,
  });
  const registry = createToolRegistry({ logger: silent });
  const store = createBenchmarkResearchMemoryStore();
  const actor = { classification: 'DEVELOPMENT', permissions: [...RESEARCH_CAPABILITY_IDS] };
  const supervisor = createBenchmarkResearchSupervisor({
    store,
    registry,
    providers,
    tenantId: TENANT,
    actor,
    logger: silent,
  });
  return { supervisor, registry, store, providers, calls, actor };
}

describe('E2E — provider nativo remove RESEARCH_BLOCKED_NO_EXTERNAL_ACCESS', () => {
  test('a cadeia real pesquisa, captura evidência com hash e ANALISA o benchmark', async () => {
    const { supervisor, store, calls } = buildStack();
    await supervisor.service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'fitness-native-e2e-v1',
      benchmarkIds: ['evo'],
      holdoutBenchmarkId: null,
    });

    const result = await supervisor.research({ vertical: VERTICAL, sample: SAMPLE });

    expect(result.status).toBe(RESEARCH_RUN_OUTCOMES.ANALYZED);
    expect(result.analyzed).toEqual(['evo']);
    expect(result.availability.externalAccess).toBe(true);
    expect(result.availability.reason).toBe('research_provider_available');
    expect(result.availability.missing).toEqual([]);

    const attempt = result.results[0].attempts[0];
    expect(attempt.status).toBe('RESEARCH_EVIDENCE_CAPTURED');

    // A rede (injetada) foi usada de verdade: busca + fetch da fonte declarada.
    expect(calls.some((url) => url.startsWith('https://html.duckduckgo.com/'))).toBe(true);
    expect(calls).toContain(SOURCE_URL);

    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL });
    const findings = await store.listFindings({ tenantId: TENANT, runId: run.id });
    const evidence = await store.listEvidence({ tenantId: TENANT, runId: run.id });
    const sources = await store.listSources({ tenantId: TENANT, runId: run.id });

    expect(findings.length).toBeGreaterThan(0);
    expect(sources).toHaveLength(1);
    expect(sources[0].http_status).toBe(200);
    expect(evidence.length).toBeGreaterThan(0);

    // O hash persistido é o do CONTEÚDO que o provider devolveu.
    const expectedHash = `sha256:${crypto.createHash('sha256').update(SITE_FIXTURE, 'utf8').digest('hex')}`;
    expect(evidence[0].content_hash).toBe(expectedHash);
    expect(findings.every((finding) => finding.metadata?.contentHash === expectedHash)).toBe(true);
    expect(findings.every((finding) => finding.verified === true)).toBe(true);
  });

  test('resolução de provider é NATIVE-FIRST pelo registry (native_preferred)', async () => {
    const { registry, actor } = buildStack();
    // Registra as capabilities com os runners nativos (como o supervisor faz).
    const { providers } = buildStack();
    const { ensureResearchCapabilities } = require('../../../api/services/benchmark/researchCapabilities');
    ensureResearchCapabilities(registry, providers);

    const tool = registry.get('rap.research.fetch');
    expect(tool.metadata.provider).toBe('native');

    const result = await executeResearchCapability({
      registry,
      capability: 'research.fetch',
      tenantId: TENANT,
      actor,
      input: { url: SOURCE_URL },
    });
    expect(result.provider).toBe('native');
    expect(result.reason).toBe('native_preferred');
    expect(result.output.httpStatus).toBe(200);
    expect(result.output.contentHash).toBe(
      `sha256:${crypto.createHash('sha256').update(SITE_FIXTURE, 'utf8').digest('hex')}`,
    );
  });

  test('o módulo de rotas de produção NÃO injeta o provider NATIVO por padrão (fail closed)', async () => {
    // §P0 RAP_CORE_RESEARCH_EGRESS (2026-09-18) — CONTRATO INVERTIDO.
    //
    // Antes: o default do módulo de rotas era o provider NATIVO, ou seja, o
    // caminho padrão de pesquisa pública do Core era egress direto para a
    // Internet, fora do Canonical Tool Registry, fora do MCP Control Plane e
    // fora de qualquer revogação por configuração.
    //
    // Agora: o default é o REGISTRY (tools de MCP externo) e o nativo exige
    // opt-in EXPLÍCITO (`RESEARCH_NATIVE_PROVIDER_ENABLED=1`). Sem provider
    // governado e sem opt-in, o registry fica SEM as capabilities `research.*` e
    // o status reporta a ausência NOMINAL — nunca um provider silencioso.
    const http = require('http');
    const express = require('express');
    const { createBenchmarkResearchRoutes } = require('../../../api/modules/benchmark-research/routes');
    const store = createBenchmarkResearchMemoryStore();
    const registry = createToolRegistry({ logger: silent });

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.agent = { platformClassification: 'DEVELOPMENT', tenantId: TENANT, userId: 'u-1', username: 'engineer' };
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
        tenantId: TENANT,
        actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
      }),
    }));

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      const response = await fetch(`http://127.0.0.1:${port}/api/benchmark-research/status`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.availability.externalAccess).toBe(false);
      // A ausência é NOMINAL: as capabilities exigidas em sequência aparecem
      // uma a uma. (`research.inspectApiDocs` só entra na lista quando o
      // benchmark declara superfície de API — por isso o `arrayContaining`.)
      expect(body.availability.missing).toEqual(expect.arrayContaining([
        'research.search',
        'research.fetch',
        'research.inspectDocumentation',
        'research.captureEvidence',
      ]));
      // Nenhuma capability nativa foi registrada por conta própria: o egress
      // nativo não é mais um efeito colateral do wiring.
      expect(registry.get('rap.research.fetch')).toBeFalsy();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('o provider NATIVO só é injetado com opt-in EXPLÍCITO', async () => {
    const { isNativeResearchProviderEnabled } = require('../../../api/services/research/governedResearchProviders');
    // Sem a variável, o wiring governado não devolve o nativo.
    expect(isNativeResearchProviderEnabled({})).toBe(false);
    // Com ela, o opt-in é reconhecido — e é auditado em log pelo módulo.
    expect(isNativeResearchProviderEnabled({ RESEARCH_NATIVE_PROVIDER_ENABLED: '1' })).toBe(true);
  });
});
