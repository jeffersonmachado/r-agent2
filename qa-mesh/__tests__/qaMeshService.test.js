'use strict';

const { createQaMeshRoutes } = require('../../api/modules/qa-mesh/routes');

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function findRouteHandler(router, method, routePath) {
  const layer = router.stack.find(
    (item) => item.route && item.route.path === routePath && item.route.methods[method.toLowerCase()]
  );
  if (!layer) {
    throw new Error(`Route not found: ${method} ${routePath}`);
  }
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function buildDepsFactory(overrides = {}) {
  return () => ({
    requireAuth(req) {
      req.agent = overrides.agent || { role: 'viewer' };
      return { valid: true, agent: req.agent };
    },
    requirePermission(req) {
      return overrides.permission || { allowed: req.agent?.role === 'admin' };
    },
    sendJson(res, status, body) {
      res.status(status).json(body);
    },
    badRequest(res, message) {
      res.status(400).json({ error: 'bad_request', message });
    },
    hasJsonContentType(req) {
      return String(req.headers?.['content-type'] || '').includes('application/json');
    },
    parseJsonBody(req) {
      return Promise.resolve(req.body || {});
    },
    logger: { error: jest.fn() },
    getRegistry: jest.fn(() => []),
    refreshMeshRegistry: jest.fn(() => []),
    getLatestExecution: jest.fn(() => null),
    getMeshHistory: jest.fn(() => []),
    getOfficialReference: jest.fn(() => null),
    getMeshSchedulerStatus: jest.fn(() => ({ enabled: true })),
    getExecutionById: jest.fn(() => null),
    getQueuedExecutionStatus: jest.fn(() => ({ executionId: 'meshq-1', status: 'running', progress: 50 })),
    queueMeshRun: jest.fn(() => ({ executionId: 'meshq-run', status: 'queued' })),
    queueScenarioReplay: jest.fn(() => ({ executionId: 'meshq-replay', status: 'queued' })),
    ...overrides.extra,
  });
}

describe('qa-mesh routes', () => {
  test('bloqueia POST /qa-mesh/run para perfis sem autorização', async () => {
    const router = createQaMeshRoutes({
      buildDeps: buildDepsFactory({
        agent: { role: 'analyst' },
        permission: { allowed: false, error: 'sem permissão' },
      }),
    });
    const handler = findRouteHandler(router, 'POST', '/qa-mesh/run');
    const req = { headers: { 'content-type': 'application/json' }, body: {} };
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  test('aceita POST /qa-mesh/run de admin e responde 202 com executionId', async () => {
    const router = createQaMeshRoutes({
      buildDeps: buildDepsFactory({
        agent: { role: 'admin' },
        permission: { allowed: true },
      }),
    });
    const handler = findRouteHandler(router, 'POST', '/qa-mesh/run');
    const req = { headers: { 'content-type': 'application/json' }, body: { domain: 'core' } };
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(202);
    expect(res.body.executionId).toBe('meshq-run');
    expect(res.body.status).toBe('queued');
  });

  test('retorna status assíncrono por executionId', async () => {
    const router = createQaMeshRoutes({
      buildDeps: buildDepsFactory({
        agent: { role: 'supervisor' },
        permission: { allowed: true },
      }),
    });
    const handler = findRouteHandler(router, 'GET', '/qa-mesh/execution/:id/status');
    const req = { headers: {}, params: { id: 'meshq-1' } };
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.executionId).toBe('meshq-1');
    expect(res.body.status).toBe('running');
    expect(res.body.progress).toBe(50);
  });

  test('encaminha officialOnly no histórico do qa-mesh', async () => {
    const getMeshHistory = jest.fn(() => []);
    const router = createQaMeshRoutes({
      buildDeps: buildDepsFactory({
        agent: { role: 'supervisor' },
        permission: { allowed: true },
        extra: { getMeshHistory },
      }),
    });
    const handler = findRouteHandler(router, 'GET', '/qa-mesh/history');
    const req = { headers: {}, query: { limit: '5', domain: 'beauty', officialOnly: '1' } };
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(getMeshHistory).toHaveBeenCalledWith({ limit: 5, domain: 'beauty', officialOnly: true });
  });

  test('retorna referência oficial dedicada do qa-mesh', async () => {
    const getOfficialReference = jest.fn(() => ({ executionId: 'mesh-pipeline-1', historyPath: '/tmp/mesh-pipeline-1.json' }));
    const router = createQaMeshRoutes({
      buildDeps: buildDepsFactory({
        agent: { role: 'supervisor' },
        permission: { allowed: true },
        extra: { getOfficialReference },
      }),
    });
    const handler = findRouteHandler(router, 'GET', '/qa-mesh/official-reference');
    const req = { headers: {}, query: {} };
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.executionId).toBe('mesh-pipeline-1');
    expect(getOfficialReference).toHaveBeenCalled();
  });

  test('aceita replay universal para supervisor', async () => {
    const router = createQaMeshRoutes({
      buildDeps: buildDepsFactory({
        agent: { role: 'supervisor' },
        permission: { allowed: true },
      }),
    });
    const handler = findRouteHandler(router, 'POST', '/qa-mesh/replay/:scenarioId');
    const req = { headers: {}, params: { scenarioId: 'scenario-123' } };
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(202);
    expect(res.body.executionId).toBe('meshq-replay');
    expect(res.body.status).toBe('queued');
  });

  test('retorna 409 quando replay exige pipeline oficial', async () => {
    const error = new Error('Execute: npm run pipeline');
    error.code = 'PIPELINE_REQUIRED';
    const router = createQaMeshRoutes({
      buildDeps: buildDepsFactory({
        agent: { role: 'supervisor' },
        permission: { allowed: true },
        extra: {
          queueScenarioReplay: jest.fn(() => {
            throw error;
          }),
        },
      }),
    });
    const handler = findRouteHandler(router, 'POST', '/qa-mesh/replay/:scenarioId');
    const req = { headers: {}, params: { scenarioId: 'scenario-123' } };
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('pipeline_required');
  });
});
