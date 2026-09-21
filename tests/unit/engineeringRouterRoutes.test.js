'use strict';

/**
 * Testes das rotas REST do Engineering Model Router V1 — servidor HTTP real (sem supertest,
 * seguindo a ausência dessa dependência no projeto): `express()` + `http.createServer` +
 * `fetch` contra uma porta efêmera. `requireAuth`/classification são mockados no nível de
 * dependência (mesmo padrão de `buildDeps` usado em produção), não no Express em si.
 */

const express = require('express');
const http = require('http');
const { createEngineeringRouterRoutes } = require('../../api/modules/engineering-router/routes');

function buildDepsFactory(overrides = {}) {
  const base = {
    requireAuth: () => ({ valid: true }),
    sendJson: (res, status, body) => { res.status(status).json(body); },
    badRequest: (res, message) => { res.status(400).json({ error: 'bad_request', message }); },
    hasJsonContentType: () => true,
    parseJsonBody: async (req) => req.body,
    logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    engineeringTaskService: {
      computeOverview: async () => ({ totals: { total: 0, green: 0, red: 0, running: 0, blocked: 0, releaseBlockers: 0 }, activeTasks: [] }),
      listTasks: async () => [],
      createTask: async (input) => ({ id: 'task-1', ...input }),
      getTask: async (id) => (id === 'task-1' ? { id: 'task-1', status: 'CREATED' } : null),
      transitionTask: async () => ({ id: 'task-1', status: 'CANCELLED' }),
      listAttempts: async () => [],
      listTestRuns: async () => [],
      listReviews: async () => [],
      listTelemetry: async () => [],
    },
    engineeringRouterService: { runTask: async () => ({ status: 'GREEN' }) },
    engineeringModelStatsService: { listModelsWithStats: async () => [] },
    releaseClosureService: { getReleaseClosure: async () => ({ cleanReleaseState: false }) },
  };
  return { ...base, ...overrides };
}

function startServer(deps) {
  const app = express();
  app.use(express.json());
  app.use(createEngineeringRouterRoutes({ buildDeps: () => deps }));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, () => resolve(server));
  });
}

function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

describe('engineering-router routes', () => {
  let server;
  let deps;

  afterEach((done) => {
    if (server) server.close(done);
    else done();
  });

  test('401 quando requireAuth falha', async () => {
    deps = buildDepsFactory({ requireAuth: () => ({ valid: false, error: 'sem token' }) });
    server = await startServer(deps);
    const res = await fetch(`${baseUrl(server)}/engineering/overview`);
    expect(res.status).toBe(401);
  });

  test('403 quando classification não é DEVELOPMENT', async () => {
    // checkClassification real é usado pela rota (não mockado) — sem req.agent, a
    // classificação resolvida é PRODUCTION (default), então DEVELOPMENT é negado.
    deps = buildDepsFactory();
    server = await startServer(deps);
    const res = await fetch(`${baseUrl(server)}/engineering/overview`);
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe('classification_required');
  });

  test('GET /engineering/overview retorna 200 para usuário DEVELOPMENT', async () => {
    deps = buildDepsFactory({ requireAuth: (req) => { req.agent = { platformClassification: 'DEVELOPMENT' }; return { valid: true }; } });
    server = await startServer(deps);
    const res = await fetch(`${baseUrl(server)}/engineering/overview`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals).toBeDefined();
  });

  test('POST /engineering/tasks valida taskType inválido', async () => {
    deps = buildDepsFactory({ requireAuth: (req) => { req.agent = { platformClassification: 'DEVELOPMENT' }; return { valid: true }; } });
    server = await startServer(deps);
    const res = await fetch(`${baseUrl(server)}/engineering/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x', taskType: 'NAO_EXISTE' }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /engineering/tasks cria task válida', async () => {
    deps = buildDepsFactory({ requireAuth: (req) => { req.agent = { platformClassification: 'DEVELOPMENT' }; return { valid: true }; } });
    server = await startServer(deps);
    const res = await fetch(`${baseUrl(server)}/engineering/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'corrigir bug', taskType: 'BUG_FIX' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe('task-1');
  });

  test('GET /engineering/tasks/:id 404 quando não existe', async () => {
    deps = buildDepsFactory({ requireAuth: (req) => { req.agent = { platformClassification: 'DEVELOPMENT' }; return { valid: true }; } });
    server = await startServer(deps);
    const res = await fetch(`${baseUrl(server)}/engineering/tasks/nao-existe`);
    expect(res.status).toBe(404);
  });

  test('POST /engineering/tasks/:id/run responde 202 e dispara execução em background', async () => {
    let ran = false;
    deps = buildDepsFactory({
      requireAuth: (req) => { req.agent = { platformClassification: 'DEVELOPMENT' }; return { valid: true }; },
      engineeringRouterService: { runTask: async () => { ran = true; return { status: 'GREEN' }; } },
    });
    server = await startServer(deps);
    const res = await fetch(`${baseUrl(server)}/engineering/tasks/task-1/run`, { method: 'POST' });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('ACCEPTED');
    await new Promise((r) => setTimeout(r, 20));
    expect(ran).toBe(true);
  });

  test('ERV1-CLOSE-006: run nunca repassa o tenant do agente como credentialScope, só como eventAudienceTenantId', async () => {
    let capturedOptions = null;
    deps = buildDepsFactory({
      requireAuth: (req) => {
        // Tenant de um cliente real qualquer — não pode influenciar qual credencial de IA o
        // Router usa para gerar/revisar o patch.
        req.agent = { platformClassification: 'DEVELOPMENT', tenantId: 'tenant-cliente-real' };
        return { valid: true };
      },
      engineeringRouterService: {
        runTask: async (taskId, options) => { capturedOptions = options; return { status: 'GREEN' }; },
      },
    });
    server = await startServer(deps);
    const res = await fetch(`${baseUrl(server)}/engineering/tasks/task-1/run`, { method: 'POST' });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 20));

    expect(capturedOptions).not.toBeNull();
    expect(capturedOptions.eventAudienceTenantId).toBe('tenant-cliente-real');
    expect(capturedOptions).not.toHaveProperty('credentialScope');
    expect(capturedOptions).not.toHaveProperty('tenantId');
  });

  test('GET /engineering/release-closure nunca declara clean state falso-positivo por padrão do mock', async () => {
    deps = buildDepsFactory({ requireAuth: (req) => { req.agent = { platformClassification: 'DEVELOPMENT' }; return { valid: true }; } });
    server = await startServer(deps);
    const res = await fetch(`${baseUrl(server)}/engineering/release-closure`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cleanReleaseState).toBe(false);
  });
});
