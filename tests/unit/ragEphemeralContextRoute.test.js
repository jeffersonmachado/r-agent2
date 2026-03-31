const { handleRagEphemeralRoutes } = require('../../api/modules/rag-documents/rag/ragEphemeralRoutes');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../api/middleware/requireExecutionId', () => ({
  requireExecutionId: (body, res, badRequest) => {
    const executionId = body?.executionId ? String(body.executionId).trim() : '';
    if (!executionId) {
      badRequest(res, 'executionId inválido');
      return null;
    }
    return executionId;
  },
}));

describe('POST /rag/ephemeral/context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeReq(overrides = {}) {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer fake-token' },
      agent: { id: 'a1', username: 'admin', tenantId: 'system', role: 'owner' },
      tenantId: 'system',
      ...overrides,
    };
  }

  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn((req) => {
        req.agent = req.agent || { id: 'a1', username: 'admin', tenantId: 'system', role: 'owner' };
        return { valid: true, agent: req.agent };
      }),
      requirePermission: jest.fn(() => ({ allowed: true })),
      isSuperAdmin: jest.fn(() => false),
      parseJsonBody: jest.fn(async (req) => ({})),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
      ...overrides,
    };
  }

  test('retorna 200 e persiste contexto efêmero', async () => {
    const req = makeReq();
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        tenantId: 'system',
        executionId: 'exec-test-1',
        chunks: [
          { sourceType: 'uploaded_file', sourceId: 'f1', text: 'Texto suficientemente grande para passar na validação 1' },
          { sourceType: 'web_scraping', sourceId: 'u1', text: 'Texto suficientemente grande para passar na validação 2' },
        ],
        replace: true,
      })),
    });

    // Mock the ephemeralRagContextService at require time
    jest.doMock('../../api/services/ephemeralRagContextService', () => ({
      upsertEphemeralContext: jest.fn(async () => ({
        ok: true, stored: 2, ttlSeconds: 1800, key: 'ctx:system:exec-test-1', used: 'memory', stats: { received: 2 },
      })),
    }));

    const handled = await handleRagEphemeralRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/rag/ephemeral/context',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({
        ok: true,
        tenantId: 'system',
        executionId: 'exec-test-1',
        stored: 2,
      })
    );
  });

  test('retorna 400 quando executionId é inválido', async () => {
    const req = makeReq();
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ tenantId: 'system', executionId: '',chunks: [] })),
      badRequest: jest.fn(() => {}),
    });

    const handled = await handleRagEphemeralRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/rag/ephemeral/context',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'executionId inválido');
  });
});
