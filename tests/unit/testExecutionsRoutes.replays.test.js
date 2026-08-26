'use strict';

const { createTestExecutionsRoutes } = require('../../api/modules/test-executions/routes');

function getRouteHandler(router, method, routePath) {
  const layer = router.stack.find(
    (entry) => entry.route && entry.route.path === routePath && entry.route.methods[method]
  );
  if (!layer) {
    throw new Error(`Route ${method.toUpperCase()} ${routePath} not found`);
  }
  return layer.route.stack[0].handle;
}

describe('test-executions replay routes', () => {
  test('GET /api/test-executions/qa-waves/journeys retorna jornadas pelo endpoint unificado', async () => {
    const deps = {
      // Stub espelha o requireAuth real: em sucesso popula req.agent
      // (auditor → SUPPORT, mínimo exigido pelas rotas de replay).
      requireAuth: jest.fn((req) => {
        req.agent = { id: 'a1', username: 'auditor', role: 'auditor', tenantId: 'tenant-x' };
        return { valid: true, agent: req.agent };
      }),
      sendJson: jest.fn(),
      logger: { error: jest.fn() },
      listQaWaveJourneys: jest.fn(() => ({ domains: [{ id: 'fitness', journeys: [] }] })),
    };

    const router = createTestExecutionsRoutes({ buildDeps: () => deps });
    const handler = getRouteHandler(router, 'get', '/api/test-executions/qa-waves/journeys');

    await handler({ query: {} }, {});

    expect(deps.listQaWaveJourneys).toHaveBeenCalledWith('tenant-x');
    expect(deps.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      { domains: [{ id: 'fitness', journeys: [] }] }
    );
  });

  test('GET /api/test-executions/qa-waves/journey-status retorna status agregado pelo endpoint unificado', async () => {
    const deps = {
      // Stub espelha o requireAuth real: em sucesso popula req.agent
      // (auditor → SUPPORT, mínimo exigido pelas rotas de replay).
      requireAuth: jest.fn((req) => {
        req.agent = { id: 'a1', username: 'auditor', role: 'auditor', tenantId: 'tenant-x' };
        return { valid: true, agent: req.agent };
      }),
      sendJson: jest.fn(),
      logger: { error: jest.fn() },
      listQaWaveJourneyStatus: jest.fn(() => ({ items: [{ journeyId: 'leads', status: 'OK' }] })),
    };

    const router = createTestExecutionsRoutes({ buildDeps: () => deps });
    const handler = getRouteHandler(router, 'get', '/api/test-executions/qa-waves/journey-status');

    await handler({ query: {} }, {});

    expect(deps.listQaWaveJourneyStatus).toHaveBeenCalledWith('tenant-x');
    expect(deps.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      { items: [{ journeyId: 'leads', status: 'OK' }] }
    );
  });

  test('GET /api/test-executions/qa-waves/scenarios repassa filtros e retorna cenários pelo endpoint unificado', async () => {
    const deps = {
      // Stub espelha o requireAuth real: em sucesso popula req.agent
      // (auditor → SUPPORT, mínimo exigido pelas rotas de replay).
      requireAuth: jest.fn((req) => {
        req.agent = { id: 'a1', username: 'auditor', role: 'auditor', tenantId: 'tenant-x' };
        return { valid: true, agent: req.agent };
      }),
      sendJson: jest.fn(),
      logger: { error: jest.fn() },
      listQaWaveScenarios: jest.fn(() => ({ items: [{ id: 'scenario-1' }] })),
    };

    const router = createTestExecutionsRoutes({ buildDeps: () => deps });
    const handler = getRouteHandler(router, 'get', '/api/test-executions/qa-waves/scenarios');

    const req = { query: { waveId: 'wave-01', journey: 'leads', status: 'active', source: 'manual' } };
    const res = {};

    await handler(req, res);

    expect(deps.listQaWaveScenarios).toHaveBeenCalledWith({
      waveId: 'wave-01',
      journey: 'leads',
      status: 'active',
      source: 'manual',
      tenantId: 'tenant-x',
    });
    expect(deps.sendJson).toHaveBeenCalledWith(
      res,
      200,
      { items: [{ id: 'scenario-1' }] }
    );
  });

  test('GET /api/test-executions/qa-waves/step-status repassa filtros e retorna status de passos pelo endpoint unificado', async () => {
    const deps = {
      // Stub espelha o requireAuth real: em sucesso popula req.agent
      // (auditor → SUPPORT, mínimo exigido pelas rotas de replay).
      requireAuth: jest.fn((req) => {
        req.agent = { id: 'a1', username: 'auditor', role: 'auditor', tenantId: 'tenant-x' };
        return { valid: true, agent: req.agent };
      }),
      sendJson: jest.fn(),
      logger: { error: jest.fn() },
      listQaWaveStepStatus: jest.fn(() => ({ items: [{ journeyId: 'leads', totalScenarios: 3 }] })),
    };

    const router = createTestExecutionsRoutes({ buildDeps: () => deps });
    const handler = getRouteHandler(router, 'get', '/api/test-executions/qa-waves/step-status');

    const req = { query: { journeyId: 'leads' } };
    const res = {};

    await handler(req, res);

    expect(deps.listQaWaveStepStatus).toHaveBeenCalledWith({ journeyId: 'leads', tenantId: 'tenant-x' });
    expect(deps.sendJson).toHaveBeenCalledWith(
      res,
      200,
      { items: [{ journeyId: 'leads', totalScenarios: 3 }] }
    );
  });

  test('GET /api/test-executions/replays repassa filtros para listReplayFiles e responde com pagination', async () => {
    const deps = {
      // Stub espelha o requireAuth real: em sucesso popula req.agent
      // (auditor → SUPPORT, mínimo exigido pelas rotas de replay).
      requireAuth: jest.fn((req) => {
        req.agent = { id: 'a1', username: 'auditor', role: 'auditor', tenantId: 'tenant-x' };
        return { valid: true, agent: req.agent };
      }),
      sendJson: jest.fn(),
      logger: { error: jest.fn() },
      listReplayFiles: jest.fn(() => ({
        total: 2,
        files: [{ filename: 'replay-1.json' }],
        offset: 1,
        limit: 1,
      })),
    };

    const router = createTestExecutionsRoutes({ buildDeps: () => deps });
    const handler = getRouteHandler(router, 'get', '/api/test-executions/replays');

    const req = {
      query: {
        limit: '1',
        offset: '1',
        search: 'qa_wave',
        result: 'failed',
        dateRange: 'week',
        sortBy: 'duration',
        sortOrder: 'asc',
        source: 'qa-waves',
        waveId: 'wave-01',
        journeyId: 'journey-01',
        scenarioId: 'scenario-01',
        seedId: 'seed-01',
        executionId: 'exec-01',
      },
      token: 'token',
    };
    const res = {};

    await handler(req, res);

    expect(deps.listReplayFiles).toHaveBeenCalledWith({
      limit: '1',
      offset: '1',
      search: 'qa_wave',
      result: 'failed',
      dateRange: 'week',
      sortBy: 'duration',
      sortOrder: 'asc',
      source: 'qa-waves',
      waveId: 'wave-01',
      journeyId: 'journey-01',
      scenarioId: 'scenario-01',
      seedId: 'seed-01',
      executionId: 'exec-01',
      tenantId: 'tenant-x',
    });

    expect(deps.sendJson).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({
        total: 2,
        files: [{ filename: 'replay-1.json' }],
        pagination: {
          total: 2,
          limit: 1,
          offset: 1,
          hasMore: false,
        },
        filters: {
          search: 'qa_wave',
          result: 'failed',
          dateRange: 'week',
          sortBy: 'duration',
          sortOrder: 'asc',
          source: 'qa-waves',
          waveId: 'wave-01',
          journeyId: 'journey-01',
          scenarioId: 'scenario-01',
          seedId: 'seed-01',
          executionId: 'exec-01',
          kind: '',
        },
      })
    );
  });

  test('DELETE /api/test-executions/replays/:filename remove replay pelo endpoint unificado', async () => {
    const deps = {
      // Stub espelha o requireAuth real: em sucesso popula req.agent
      // (auditor → SUPPORT, mínimo exigido pelas rotas de replay).
      requireAuth: jest.fn((req) => {
        req.agent = { id: 'a1', username: 'auditor', role: 'auditor', tenantId: 'tenant-x' };
        return { valid: true, agent: req.agent };
      }),
      sendJson: jest.fn(),
      logger: { error: jest.fn() },
      deleteReplayFile: jest.fn(() => ({
        success: true,
        deletedFilename: 'replay-1.json',
        message: 'Replay "replay-1.json" removido com sucesso',
      })),
    };

    const router = createTestExecutionsRoutes({ buildDeps: () => deps });
    const handler = getRouteHandler(router, 'delete', '/api/test-executions/replays/:filename');

    const req = { params: { filename: 'replay-1.json' } };
    const res = {};

    await handler(req, res);

    expect(deps.deleteReplayFile).toHaveBeenCalledWith('replay-1.json', 'tenant-x');
    expect(deps.sendJson).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({
        success: true,
        deletedFilename: 'replay-1.json',
      })
    );
  });

  test('DELETE /api/test-executions/replays remove todos os replays pelo endpoint unificado', async () => {
    const deps = {
      // Stub espelha o requireAuth real: em sucesso popula req.agent
      // (auditor → SUPPORT, mínimo exigido pelas rotas de replay).
      requireAuth: jest.fn((req) => {
        req.agent = { id: 'a1', username: 'auditor', role: 'auditor', tenantId: 'tenant-x' };
        return { valid: true, agent: req.agent };
      }),
      sendJson: jest.fn(),
      logger: { error: jest.fn() },
      deleteAllReplayFiles: jest.fn(() => ({
        success: true,
        deletedCount: 3,
        deletedRootCount: 2,
        deletedSystemCount: 1,
        message: 'Replays removidos com sucesso',
      })),
    };

    const router = createTestExecutionsRoutes({ buildDeps: () => deps });
    const handler = getRouteHandler(router, 'delete', '/api/test-executions/replays');

    const req = {};
    const res = {};

    await handler(req, res);

    expect(deps.deleteAllReplayFiles).toHaveBeenCalledTimes(1);
    expect(deps.sendJson).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({
        success: true,
        deletedCount: 3,
      })
    );
  });
});
