'use strict';

/**
 * REGRESSÃO (2026-09-19) — o Market Discovery não resolvia provider de pesquisa.
 *
 * DOIS defeitos independentes, ambos silenciosos, provados aqui pela ROTA REAL:
 *
 *  1. WIRING DO PRINCIPAL. No caminho PADRÃO (sem providers injetados) a rota
 *     chamava `defaultResearchProviders(..., { actor: undefined })`. A resolução
 *     de provider externo do registry exige `actor.tenant` (binding de tenant em
 *     `src/core/mcp/capability-resolution.js`) e filtra por
 *     classificação/permissão. Com `actor` undefined TODO proxy de MCP externo
 *     era descartado e o run terminava
 *     `MARKET_DISCOVERY_BLOCKED_NO_EXTERNAL_ACCESS` com `externalAccess: false`
 *     — mesmo com o MCP research vivo. O benchmark research, que passava
 *     `buildResearchPrincipal()`, funcionava: era um defeito de UM chamador.
 *
 *  2. PROJEÇÃO DE OUTPUT. O adapter genérico de MCP devolve
 *     `{ remote, tool, content, text }` — o payload real chega como TEXTO JSON
 *     em `text`. Os consumidores governados leem campos ESTRUTURADOS
 *     (`candidates`, `content`, `httpStatus`, `contentHash`, `evidenceRef`).
 *     Sem projeção o run terminava `COMPLETED` com ZERO candidatos e nenhum
 *     erro em lugar nenhum (o pior modo de falha possível).
 *
 * O teste roda a rota com um registry contendo UM proxy `external_mcp` ligado ao
 * tenant `system`, SEM providers injetados — e exige candidatos de verdade no
 * `marketScan` persistido.
 */

const http = require('http');
const crypto = require('crypto');
const express = require('express');

const { RESEARCH_CAPABILITIES } = require('../../../api/services/benchmark/researchCapabilities');
const { createMarketDiscoveryMemoryStore } = require('../../helpers/marketDiscoveryMemoryStore');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');
const { createMarketDiscoveryRoutes } = require('../../../api/modules/market-discovery/routes');
const {
  DISCOVERY_RUN_OUTCOMES,
  DISCOVERY_RUN_STATES,
} = require('../../../api/services/marketDiscovery/marketDiscoverySupervisor');

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TENANT = 'system';
const VERTICAL = 'wiring-lab';

const SEARCH_HITS = [
  { url: 'https://alpha-lab.com/', title: 'Alpha Lab' },
  { url: 'https://beta-lab.com/', title: 'Beta Lab' },
];

const SAMPLE = { vertical: VERTICAL, sampleVersion: 'provider-wiring-v1' };

function sha256(content) {
  return crypto.createHash('sha256').update(String(content)).digest('hex');
}

/** Payload DECLARADO de cada capability — o que o serviço de pesquisa real devolve. */
function payloadFor(capability, input = {}) {
  if (capability === 'research.search') {
    return { query: input.query || null, candidates: SEARCH_HITS };
  }
  if (capability === 'research.fetch') {
    const content = `conteúdo oficial de ${input.url}`;
    return {
      url: input.url,
      httpStatus: 200,
      content,
      contentType: 'text/html',
      retrievedAt: '2026-09-19T00:00:00.000Z',
      contentHash: sha256(content),
    };
  }
  if (capability === 'research.inspectDocumentation') {
    return { sections: ['Agenda', 'Clientes', 'Financeiro'] };
  }
  if (capability === 'research.inspectApiDocs') {
    return { operations: ['GET /appointments', 'POST /billing'] };
  }
  if (capability === 'research.captureEvidence') {
    return { evidenceRef: `ev-${sha256(input.url || 'x').slice(0, 16)}`, contentHash: input.contentHash };
  }
  throw new Error(`capability não suportada no fixture: ${capability}`);
}

/**
 * Registry FAKE que imita o contrato observável do Canonical Tool Registry para
 * as 5 capabilities de pesquisa servidas por UMA conexão de MCP externo:
 * `list` (com filtros de ator), `get` (canônico com metadata) e `execute`
 * (devolvendo a peça CRUA do adapter — texto JSON em `text`, como o real).
 */
function createRegistryWithExternalResearchTool({ boundTenant = TENANT, rawTextFor = null } = {}) {
  const tools = RESEARCH_CAPABILITIES.map((definition) => {
    const id = `mcp.twiringlabx.mcp-research.${definition.runner}`;
    return {
      descriptor: { id, capability: definition.capability, sideEffects: false },
      canonical: {
        id,
        capability: definition.capability,
        sideEffects: false,
        metadata: { source: 'external_mcp', tenantId: boundTenant, connection: 'mcp-research' },
      },
    };
  });
  const byId = new Map(tools.map((tool) => [tool.descriptor.id, tool.canonical]));

  return {
    seenListFilters: [],
    executions: [],
    registered: [],
    // `ensureResearchCapabilities` exige `register` no contrato do registry.
    register(tool) {
      this.registered.push(tool);
      return tool;
    },
    list(filters) {
      this.seenListFilters.push(filters || {});
      // Somente os proxOES de MCP externo: é o caminho de provider sob teste.
      return tools.map((tool) => tool.descriptor);
    },
    get(id) {
      return byId.get(id) || null;
    },
    async execute(id, input, context) {
      const canonical = byId.get(id) || null;
      const capability = canonical?.capability || null;
      this.executions.push({ id, capability, input, context });
      const override = typeof rawTextFor === 'function' ? rawTextFor({ capability, input }) : null;
      const text = override === null || override === undefined
        ? JSON.stringify(payloadFor(capability, input))
        : String(override);
      return {
        output: {
          remote: 'mcp-research',
          tool: 'mcp-research',
          content: [{ type: 'text', text }],
          text,
        },
      };
    },
  };
}

function buildApp({ registry, store, benchmarkStore }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.agent = { platformClassification: 'DEVELOPMENT', tenantId: TENANT, userId: 'u-1', username: 'engineer' };
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
      // SEM `providers`: força o caminho PADRÃO (registry + principal), que é
      // onde o defeito de wiring vivia.
      store,
      benchmarkStore,
      registry,
    }),
  }));
  return app;
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

async function getJson(base, path) {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: await response.json() };
}

describe('market discovery — resolução de provider no caminho PADRÃO', () => {
  test('o principal passado à resolução carrega o tenant SYSTEM (binding de provider externo)', async () => {
    const registry = createRegistryWithExternalResearchTool();
    const store = createMarketDiscoveryMemoryStore();
    const app = buildApp({ registry, store, benchmarkStore: createBenchmarkResearchMemoryStore() });

    await withServer(app, async (base) => {
      await postJson(base, '/api/market-discovery/runs', { vertical: VERTICAL, sample: SAMPLE });
    });

    // O registry é consultado COM classificação e permissões do principal —
    // `actor` undefined deixava ambos indefinidos.
    expect(registry.seenListFilters.length).toBeGreaterThan(0);
    const filters = registry.seenListFilters[0];
    expect(filters.classification).toBe('DEVELOPMENT');
    expect(Array.isArray(filters.permissions)).toBe(true);
    expect(filters.permissions).toContain('research.search');
  });

  test('o run NÃO é bloqueado e a pesquisa externa é executada', async () => {
    const registry = createRegistryWithExternalResearchTool();
    const store = createMarketDiscoveryMemoryStore();
    const app = buildApp({ registry, store, benchmarkStore: createBenchmarkResearchMemoryStore() });

    await withServer(app, async (base) => {
      const created = await postJson(base, '/api/market-discovery/runs', { vertical: VERTICAL, sample: SAMPLE });

      // Defeito (1): antes da correção era BLOCKED_NO_EXTERNAL_ACCESS com
      // externalAccess=false e `missing` listando as 5 capabilities.
      expect(created.body.status).not.toBe(DISCOVERY_RUN_OUTCOMES.BLOCKED_NO_EXTERNAL_ACCESS);
      expect(created.body.availability?.externalAccess).toBe(true);
      expect(created.body.availability?.missing).toEqual([]);

      // O tenant do contexto de execução é o da conexão (fail closed no adapter).
      expect(registry.executions.length).toBeGreaterThan(0);
      for (const execution of registry.executions) {
        expect(execution.context.tenantId).toBe(TENANT);
      }
    });
  });

  test('os candidatos do payload JSON CHEGAM ao marketScan (projeção de output)', async () => {
    const registry = createRegistryWithExternalResearchTool();
    const store = createMarketDiscoveryMemoryStore();
    const app = buildApp({ registry, store, benchmarkStore: createBenchmarkResearchMemoryStore() });

    let runId = null;
    await withServer(app, async (base) => {
      const created = await postJson(base, '/api/market-discovery/runs', { vertical: VERTICAL, sample: SAMPLE });
      runId = created.body.runId;
      if (!runId) {
        throw new Error(`POST /runs não devolveu runId: ${JSON.stringify(created.body)}`);
      }
    });

    // Defeito (2): sem a projeção, `output.candidates` era undefined e TODAS as
    // queries registravam hits=0 com o run COMPLETED.
    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL, runId });
    const marketScan = run?.metadata?.marketScan || [];
    expect(marketScan.length).toBeGreaterThan(0);
    for (const scan of marketScan) {
      expect(scan.hits).toBe(SEARCH_HITS.length);
    }
  });

  test('payload NÃO estruturado do provider falha de forma TIPADA e visível (nunca hits=0 silencioso)', async () => {
    const registry = createRegistryWithExternalResearchTool({
      rawTextFor: ({ capability }) => (capability === 'research.search' ? 'nao json' : null),
    });
    const store = createMarketDiscoveryMemoryStore();
    const app = buildApp({ registry, store, benchmarkStore: createBenchmarkResearchMemoryStore() });

    let response = null;
    await withServer(app, async (base) => {
      response = await postJson(base, '/api/market-discovery/runs', { vertical: VERTICAL, sample: SAMPLE });
    });

    // A ausência de dado tem de ser VISÍVEL: erro tipado, nunca um run
    // "COMPLETED" com zero resultados e nenhum erro.
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('research_tool_output_unparsed');

    // E o run fica marcado como FAILED no estado persistido.
    const runs = await store.listRuns({ tenantId: TENANT, vertical: VERTICAL });
    expect(runs.some((run) => run.state === DISCOVERY_RUN_STATES.FAILED)).toBe(true);
  });
});
