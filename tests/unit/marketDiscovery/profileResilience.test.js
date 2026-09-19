'use strict';

/**
 * REGRESSÃO (2026-09-19) — falha de rede em UM candidato derrubava a varredura.
 *
 * O run real de `beauty` (2026-09-19) morreu com
 * `mcp_call_failed: mcp-research/research_inspect_documentation: fetch failed`
 * DEPOIS de descobrir 67 candidatos e percorrer o profiling — 26 minutos de
 * pesquisa real convertidos em zero achados por causa de UM host que não
 * respondeu.
 *
 * O módulo já declara a doutrina correta (`gatherEvidence`): "um único host
 * inalcançável não pode abortar a varredura inteira. O motivo tipado do
 * provider vai em `reason` e o candidato simplesmente não acumula evidência."
 * O profiling simplesmente não seguia a própria regra: `research.inspectDocumentation`
 * e `research.inspectApiDocs` eram chamados SEM try/catch.
 *
 * O teste roda a ROTA REAL com providers injetados em que a inspeção falha
 * para UM candidato, e exige: run COMPLETO, perfil do candidato ruim registrado
 * como não-perfilado com motivo tipado, e o outro candidato PERFILADO.
 */

const http = require('http');
const crypto = require('crypto');
const express = require('express');

const { createMarketDiscoveryMemoryStore } = require('../../helpers/marketDiscoveryMemoryStore');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');
const { createMarketDiscoveryRoutes } = require('../../../api/modules/market-discovery/routes');
const {
  DISCOVERY_RUN_OUTCOMES,
  DISCOVERY_RUN_STATES,
} = require('../../../api/services/marketDiscovery/marketDiscoverySupervisor');

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TENANT = 'system';
const VERTICAL = 'resilience-lab';

const BROKEN_HOST = 'https://beta-lab.com/';
const HEALTHY_HOST = 'https://alpha-lab.com/';

// Sample SEM `marketContext`: o gate de relevância devolve NOT_EVALUABLE
// (`accepted: true`) e o teste fica focado em resiliência, não em relevância.
const SAMPLE = { vertical: VERTICAL, sampleVersion: 'profile-resilience-v1' };

function sha256(content) {
  return crypto.createHash('sha256').update(String(content)).digest('hex');
}

function buildProviders() {
  return {
    search: async () => ({
      candidates: [
        { url: HEALTHY_HOST, title: 'Alpha Lab' },
        { url: BROKEN_HOST, title: 'Beta Lab' },
      ],
    }),
    fetch: async (input) => {
      const content = `conteúdo oficial de ${input.url}`;
      return {
        httpStatus: 200,
        content,
        contentType: 'text/html',
        retrievedAt: '2026-09-19T00:00:00.000Z',
        contentHash: `sha256:${sha256(content)}`,
      };
    },
    captureEvidence: async (input) => ({
      evidenceRef: `ev-${sha256(input.url || 'x').slice(0, 16)}`,
      contentHash: input.contentHash,
    }),
    inspectDocumentation: async (input) => {
      // O host ruim falha EXATAMENTE como o serviço real falhou: erro de rede.
      if (String(input.url).includes('beta-lab.com')) {
        const error = new Error('fetch failed');
        error.code = 'mcp_call_failed';
        throw error;
      }
      return { sections: ['Agenda', 'Clientes', 'Financeiro', 'Relatórios'] };
    },
    inspectApiDocs: async () => ({ operations: ['GET /a', 'POST /b'] }),
  };
}

function buildApp({ store, benchmarkStore, providers }) {
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
    resolveDiscoveryDeps: () => ({ store, benchmarkStore, providers }),
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

describe('market discovery — um host ruim não derruba a varredura', () => {
  test('a inspeção que falha vira candidato NÃO perfilado com motivo tipado, e o run COMPLETA', async () => {
    const store = createMarketDiscoveryMemoryStore();
    const providers = buildProviders();
    const app = buildApp({ store, benchmarkStore: createBenchmarkResearchMemoryStore(), providers });

    let response = null;
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/market-discovery/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vertical: VERTICAL, sample: SAMPLE }),
      });
      response = { status: res.status, body: await res.json() };
    });

    // Antes da correção: HTTP 400 `market_discovery_failed` com
    // `mcp_call_failed: ... research_inspect_documentation: fetch failed`.
    expect(response.status).toBe(200);
    expect(response.body.status).toBe(DISCOVERY_RUN_OUTCOMES.COMPLETED);

    const runs = await store.listRuns({ tenantId: TENANT, vertical: VERTICAL });
    expect(runs.length).toBeGreaterThan(0);
    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL, runId: runs[0].id });
    const profiles = run?.metadata?.profiles || [];

    const broken = profiles.find((p) => /beta-lab/.test(String(p.candidateKey || '')));
    const healthy = profiles.find((p) => /alpha-lab/.test(String(p.candidateKey || '')));

    // O candidato do host ruim é REGISTRADO como não-perfilado, com o motivo.
    expect(broken).toBeDefined();
    expect(broken.profiled).toBe(false);
    expect(String(broken.reason)).toMatch(/^inspect_failed: /);

    // E o candidato saudável segue sendo perfilado no MESMO run.
    expect(healthy).toBeDefined();
    expect(healthy.profiled).toBe(true);
  });

  test('o run alcança o estágio de análise de candidatos (não para no primeiro erro)', async () => {
    const store = createMarketDiscoveryMemoryStore();
    const app = buildApp({
      store,
      benchmarkStore: createBenchmarkResearchMemoryStore(),
      providers: buildProviders(),
    });

    await withServer(app, async (base) => {
      await fetch(`${base}/api/market-discovery/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vertical: VERTICAL, sample: SAMPLE }),
      });
    });

    const runs = await store.listRuns({ tenantId: TENANT, vertical: VERTICAL });
    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL, runId: runs[0].id });
    const reached = new Set(
      (run?.metadata?.pipeline || []).slice(0, 3).concat([run?.state]),
    );
    // O estado terminal registrado é POSTERIOR a CANDIDATES_ANALYZED.
    expect([
      DISCOVERY_RUN_STATES.CANDIDATES_ANALYZED,
      DISCOVERY_RUN_STATES.DIVERSITY_EVALUATED,
      DISCOVERY_RUN_STATES.DISCOVERY_SET_SELECTED,
      DISCOVERY_RUN_STATES.HOLDOUT_PREREGISTERED,
      DISCOVERY_RUN_STATES.HANDED_OFF,
    ]).toContain(run?.state);
    expect(reached.size).toBeGreaterThan(0);
  });
});
