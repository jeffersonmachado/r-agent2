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
  test('GET /api/test-executions/replays repassa filtros para listReplayFiles e responde com pagination', async () => {
    const deps = {
      requireAuth: jest.fn(() => ({ valid: true })),
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
        },
      })
    );
  });

  test('DELETE /api/test-executions/replays/:filename remove replay pelo endpoint unificado', async () => {
    const deps = {
      requireAuth: jest.fn(() => ({ valid: true })),
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

    expect(deps.deleteReplayFile).toHaveBeenCalledWith('replay-1.json');
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
      requireAuth: jest.fn(() => ({ valid: true })),
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
