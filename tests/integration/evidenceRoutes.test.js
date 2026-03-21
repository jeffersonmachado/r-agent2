'use strict';

describe('evidence routes integration', () => {
  let serviceMock;
  let createEvidenceRoutes;

  beforeEach(() => {
    jest.resetModules();
    serviceMock = {
      getEntityHistory: jest.fn(async () => ({ ok: true, identity: null, timeline: [], evidence: null })),
      searchEvidence: jest.fn(async () => ({ ok: true, identity: null, best: null, alternatives: [], reasoning: { matchedBy: [], score: 0 } })),
      findBestEvidenceForContextWithFallback: jest.fn(async () => ({
        ok: true,
        identity: { entityType: 'customer', entityId: 'cust-1', confidence: 0.96 },
        best: {
          id: 'evd-1',
          origin_locator: {
            sourceType: 'channel_message',
            sourceId: 'msg-1',
            ticketId: 't1',
            conversationId: 'c1',
            channelMessageId: 'msg-1',
            locator: 'conversation:c1:message:msg-1',
            canOpenDirectly: true,
          },
        },
        alternatives: [],
        timeline: [],
        reasoning: { matchedBy: ['text_overlap'], score: 88, strategy: 'fallback_transient' },
        sourceInfo: { strategyUsed: 'fallback_transient', origin: { sourceType: 'channel_message' } },
      })),
      backfillEvidenceForEntity: jest.fn(async () => ({ ok: true, extracted: 2 })),
      backfillEvidenceForTenant: jest.fn(async () => ({ ok: true, processed: 4 })),
      getEvidenceMetricsSnapshot: jest.fn(() => ({
        contextualSearches: 3,
        persistedHits: 1,
        fallbackHits: 1,
        emptyResults: 1,
      })),
    };
    jest.doMock('../../api/services/evidenceService', () => serviceMock);
    ({ createEvidenceRoutes } = require('../../api/modules/evidence/routes'));
  });

  function makeRes() {
    return {
      statusCode: 200,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.payload = body;
        return this;
      },
    };
  }

  function findHandler(router, method, path) {
    const layer = router.stack.find((entry) => (
      entry.route
      && entry.route.path === path
      && entry.route.methods[String(method).toLowerCase()]
    ));
    if (!layer) throw new Error(`Route not found: ${method} ${path}`);
    return layer.route.stack[0].handle;
  }

  async function invokeRoute({ method, path, url = path, body = null, headers = {} }) {
    const router = createEvidenceRoutes({
      buildDeps: () => ({
        requireAuth: () => ({ valid: true }),
        requireTenant: (req) => req.headers['x-tenant-id'] || null,
        sendJson: (res, status, payload) => res.status(status).json(payload),
        parseJsonBody: async (req) => req.body || {},
      }),
    });
    const handler = findHandler(router, method, path);
    const req = {
      method,
      url,
      headers: {
        authorization: 'Bearer t1',
        'x-tenant-id': 'tenant1',
        ...headers,
      },
      body,
    };
    const res = makeRes();
    await handler(req, res, (err) => {
      if (err) throw err;
    });
    return res;
  }

  test('POST /api/evidence/contextual-search valida payload mínimo', async () => {
    const res = await invokeRoute({
      method: 'POST',
      path: '/api/evidence/contextual-search',
      body: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toBe('invalid_request');
  });

  test('POST /api/evidence/contextual-search encapsula busca híbrida', async () => {
    const res = await invokeRoute({
      method: 'POST',
      path: '/api/evidence/contextual-search',
      body: {
        context: { ticketId: 't1', conversationId: 'c1' },
        query: 'cliente questiona aumento',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(serviceMock.findBestEvidenceForContextWithFallback).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant1',
      context: expect.objectContaining({ ticketId: 't1', conversationId: 'c1' }),
      query: 'cliente questiona aumento',
    }));
    expect(res.payload.sourceInfo.strategyUsed).toBe('fallback_transient');
  });

  test('GET /api/evidence/entity/history e POST /api/evidence/backfill seguem operacionais', async () => {
    const history = await invokeRoute({
      method: 'GET',
      path: '/api/evidence/entity/history',
      url: '/api/evidence/entity/history?ticketId=t1&limit=3',
    });
    const backfill = await invokeRoute({
      method: 'POST',
      path: '/api/evidence/backfill',
      body: { scope: 'entity', ticketId: 't1', dryRun: true },
    });

    expect(history.statusCode).toBe(200);
    expect(serviceMock.getEntityHistory).toHaveBeenCalled();
    expect(backfill.statusCode).toBe(200);
    expect(serviceMock.backfillEvidenceForEntity).toHaveBeenCalled();
  });

  test('GET /api/evidence/metrics expõe snapshot operacional', async () => {
    const res = await invokeRoute({
      method: 'GET',
      path: '/api/evidence/metrics',
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.metrics).toBeTruthy();
  });
});
