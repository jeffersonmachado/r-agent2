'use strict';

/**
 * Phase 5 — Tenant Intelligence Core
 * HTTP contract tests for all routes beyond the basic 5 already in
 * intelligenceRoutes.test.js.  Covers: PUT /goals/:id, GET /insights,
 * GET /insights/:id/evidence, POST /metrics/snapshots, plus auth/permission
 * guard regression for each endpoint family.
 */

jest.mock('../../api/core/tenant-intelligence/TenantIntelligenceService', () => {
  const serviceMock = {
    searchStrategic: jest.fn(async () => ({ ok: true, answer: { summary: {} } })),
    getOperationalState: jest.fn(async () => ({ ok: true, state: { health: { status: 'healthy', score: 100 } } })),
    listGoals: jest.fn(async () => ({ items: [], total: 0 })),
    createGoal: jest.fn(async () => ({ goal: { id: 'g-1' }, evaluation: { computedStatus: 'on_track' } })),
    updateGoal: jest.fn(async () => ({
      ok: true,
      goal: { id: 'g-1', current_value: 42 },
      evaluation: { computedStatus: 'on_track', progressPercent: 84, delta: -8 },
    })),
    collectMetricSnapshots: jest.fn(async () => ({
      ok: true,
      snapshots: [{ id: 'snap-1', metric_key: 'event_ledger.total_events', value: 100 }],
      period: { type: 'month', start: '2025-01-01T00:00:00Z', end: '2025-02-01T00:00:00Z' },
    })),
    listInsights: jest.fn(async () => ({
      items: [{ id: 'ins-1', type: 'goal_off_track', title: 'Meta fora', confidence: 0.9, impact: 'high' }],
      total: 1,
    })),
    listEvidenceByInsight: jest.fn(async () => ({
      items: [{ id: 'ev-1', evidence_type: 'metric_snapshot', source_type: 'tenant_metric_snapshot' }],
      total: 1,
    })),
    listRecommendations: jest.fn(async () => ({ items: [], total: 0 })),
  };

  return {
    getTenantIntelligenceService: jest.fn(() => serviceMock),
    __serviceMock: serviceMock,
  };
});

const intelligenceServiceModule = require('../../api/core/tenant-intelligence/TenantIntelligenceService');
const { handleIntelligenceRoutes } = require('../../api/modules/intelligence/handleIntelligenceRoutes');

function getService() {
  const calls = intelligenceServiceModule.getTenantIntelligenceService.mock.results || [];
  return calls.length ? calls[calls.length - 1]?.value : null;
}

function makeDeps(overrides = {}) {
  return {
    requireAuth: jest.fn(() => ({ valid: true })),
    requirePermission: jest.fn(() => ({ allowed: true })),
    requireTenant: jest.fn(() => 'tenant-test'),
    sendJson: jest.fn(),
    badRequest: jest.fn(),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({})),
    logger: { error: jest.fn() },
    ...overrides,
  };
}

async function handle(method, pathname, depsOverrides = {}) {
  const deps = makeDeps(depsOverrides);
  const res = {};
  const handled = await handleIntelligenceRoutes({
    req: { url: `${pathname}` },
    res,
    method,
    pathname,
    deps,
  });
  return { handled, deps, res };
}

// ---------------------------------------------------------------------------
// Auth guard (applies to all intelligence routes)
// ---------------------------------------------------------------------------
describe('auth guard — todas as rotas intelligence', () => {
  const routes = [
    ['POST', '/api/intelligence/search'],
    ['POST', '/api/intelligence/operational-state'],
    ['GET', '/api/intelligence/operational-state'],
    ['GET', '/api/intelligence/goals'],
    ['POST', '/api/intelligence/goals'],
    ['PUT', '/api/intelligence/goals/g-1'],
    ['POST', '/api/intelligence/metrics/snapshots'],
    ['GET', '/api/intelligence/insights'],
    ['GET', '/api/intelligence/insights/ins-1/evidence'],
    ['GET', '/api/intelligence/recommendations'],
  ];

  test.each(routes)('%s %s retorna 401 sem auth valida', async (method, pathname) => {
    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'token_invalid' })) });
    const res = {};
    const handled = await handleIntelligenceRoutes({ req: { url: pathname }, res, method, pathname, deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });
});

// ---------------------------------------------------------------------------
// Rota nao tratada
// ---------------------------------------------------------------------------
describe('rotas nao tratadas', () => {
  test('/api/intelligence/other retorna false', async () => {
    const { handled } = await handle('GET', '/api/intelligence/other');
    expect(handled).toBe(false);
  });

  test('/api/qualquer retorna false', async () => {
    const { handled } = await handle('GET', '/api/qualquer');
    expect(handled).toBe(false);
  });
});

function restoreServiceMocks() {
  intelligenceServiceModule.getTenantIntelligenceService.mockImplementation(
    () => intelligenceServiceModule.__serviceMock,
  );
  const svc = intelligenceServiceModule.__serviceMock;
  svc.searchStrategic.mockResolvedValue({ ok: true, answer: { summary: {} } });
  svc.getOperationalState.mockResolvedValue({ ok: true, state: { health: { status: 'healthy', score: 100 } } });
  svc.listGoals.mockResolvedValue({ items: [], total: 0 });
  svc.createGoal.mockResolvedValue({ goal: { id: 'g-1' }, evaluation: { computedStatus: 'on_track' } });
  svc.updateGoal.mockResolvedValue({
    ok: true,
    goal: { id: 'g-1', current_value: 42 },
    evaluation: { computedStatus: 'on_track', progressPercent: 84, delta: -8 },
  });
  svc.collectMetricSnapshots.mockResolvedValue({
    ok: true,
    snapshots: [{ id: 'snap-1', metric_key: 'event_ledger.total_events', value: 100 }],
    period: { type: 'month', start: '2025-01-01T00:00:00Z', end: '2025-02-01T00:00:00Z' },
  });
  svc.listInsights.mockResolvedValue({
    items: [{ id: 'ins-1', type: 'goal_off_track', title: 'Meta fora', confidence: 0.9, impact: 'high' }],
    total: 1,
  });
  svc.listEvidenceByInsight.mockResolvedValue({
    items: [{ id: 'ev-1', evidence_type: 'metric_snapshot', source_type: 'tenant_metric_snapshot' }],
    total: 1,
  });
  svc.listRecommendations.mockResolvedValue({ items: [], total: 0 });
}


// ---------------------------------------------------------------------------
// PUT /api/intelligence/goals/:id
// ---------------------------------------------------------------------------
describe('PUT /api/intelligence/goals/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    restoreServiceMocks();
  });

  test('atualiza meta e retorna 200 com evaluation', async () => {
    const { handled, deps, res } = await handle('PUT', '/api/intelligence/goals/g-1', {
      parseJsonBody: jest.fn(async () => ({ current_value: 42 })),
    });
    expect(handled).toBe(true);
    const svc = getService();
    expect(svc.updateGoal).toHaveBeenCalledWith({
      tenantId: 'tenant-test',
      goalId: 'g-1',
      updates: { current_value: 42 },
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true }));
  });

  test('retorna 404 quando goal nao encontrada', async () => {
    intelligenceServiceModule.__serviceMock.updateGoal.mockResolvedValueOnce({
      ok: false,
      error: 'goal_not_found',
    });
    const { handled, deps, res } = await handle('PUT', '/api/intelligence/goals/g-missing', {
      parseJsonBody: jest.fn(async () => ({ status: 'inactive' })),
    });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, expect.objectContaining({ error: 'goal_not_found' }));
  });

  test('retorna 400 sem Content-Type correto', async () => {
    const { handled, deps } = await handle('PUT', '/api/intelligence/goals/g-1', {
      hasJsonContentType: jest.fn(() => false),
    });
    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /api/intelligence/insights
// ---------------------------------------------------------------------------
describe('GET /api/intelligence/insights', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    restoreServiceMocks();
  });

  test('lista insights e retorna 200', async () => {
    const { handled, deps, res } = await handle('GET', '/api/intelligence/insights');
    expect(handled).toBe(true);
    const svc = getService();
    expect(svc.listInsights).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-test' }),
    );
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true, total: 1 }));
  });

  test('passa status e limit da query string', async () => {
    const { handled } = await handle('GET', '/api/intelligence/insights');
    // URL sem query; verifica que defaults sao passados
    const svc = getService();
    expect(svc.listInsights).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
    );
    expect(handled).toBe(true);
  });

  test('retorna 403 sem permissao analytics:read', async () => {
    const { handled, deps, res } = await handle('GET', '/api/intelligence/insights', {
      requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })),
    });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  test('retorna 500 em erro inesperado', async () => {
    intelligenceServiceModule.__serviceMock.listInsights.mockRejectedValueOnce(new Error('db fail'));
    const { handled, deps, res } = await handle('GET', '/api/intelligence/insights');
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 500, expect.objectContaining({ error: 'internal_error' }));
  });
});

// ---------------------------------------------------------------------------
// GET /api/intelligence/insights/:id/evidence
// ---------------------------------------------------------------------------
describe('GET /api/intelligence/insights/:id/evidence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    restoreServiceMocks();
  });

  test('retorna evidencias do insight', async () => {
    const { handled, deps, res } = await handle(
      'GET',
      '/api/intelligence/insights/ins-1/evidence',
    );
    expect(handled).toBe(true);
    const svc = getService();
    expect(svc.listEvidenceByInsight).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-test', insightId: 'ins-1' }),
    );
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true, total: 1 }));
  });

  test('extrai insightId corretamente de pathname profundo', async () => {
    await handle('GET', '/api/intelligence/insights/ins-deep-1/evidence');
    const svc = getService();
    expect(svc.listEvidenceByInsight).toHaveBeenCalledWith(
      expect.objectContaining({ insightId: 'ins-deep-1' }),
    );
  });

  test('retorna 403 sem permissao', async () => {
    const { handled, deps, res } = await handle(
      'GET',
      '/api/intelligence/insights/ins-1/evidence',
      { requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })) },
    );
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  test('retorna 500 em erro inesperado', async () => {
    intelligenceServiceModule.__serviceMock.listEvidenceByInsight.mockRejectedValueOnce(new Error('fail'));
    const { handled, deps, res } = await handle('GET', '/api/intelligence/insights/ins-1/evidence');
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 500, expect.objectContaining({ error: 'internal_error' }));
  });
});

// ---------------------------------------------------------------------------
// POST /api/intelligence/metrics/snapshots
// ---------------------------------------------------------------------------
describe('POST /api/intelligence/metrics/snapshots', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    restoreServiceMocks();
  });

  test('coleta snapshots e retorna 200 com ok:true', async () => {
    const { handled, deps, res } = await handle(
      'POST',
      '/api/intelligence/metrics/snapshots',
      { parseJsonBody: jest.fn(async () => ({ period: 'week' })) },
    );
    expect(handled).toBe(true);
    const svc = getService();
    expect(svc.collectMetricSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-test', period: 'week' }),
    );
    expect(deps.sendJson).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({ ok: true }),
    );
  });

  test('usa period month como default', async () => {
    await handle('POST', '/api/intelligence/metrics/snapshots', {
      parseJsonBody: jest.fn(async () => ({})),
    });
    const svc = getService();
    expect(svc.collectMetricSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({ period: 'month' }),
    );
  });

  test('retorna 400 sem Content-Type correto', async () => {
    const { handled, deps } = await handle('POST', '/api/intelligence/metrics/snapshots', {
      hasJsonContentType: jest.fn(() => false),
    });
    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalled();
  });

  test('retorna 403 sem permissao analytics:read', async () => {
    const { handled, deps, res } = await handle(
      'POST',
      '/api/intelligence/metrics/snapshots',
      { requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })) },
    );
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  test('retorna 500 em erro inesperado', async () => {
    intelligenceServiceModule.__serviceMock.collectMetricSnapshots.mockRejectedValueOnce(new Error('ledger_down'));
    const { handled, deps, res } = await handle(
      'POST',
      '/api/intelligence/metrics/snapshots',
      { parseJsonBody: jest.fn(async () => ({ period: 'month' })) },
    );
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 500, expect.objectContaining({ error: 'internal_error' }));
  });
});

// ---------------------------------------------------------------------------
// GET /api/intelligence/goals
// ---------------------------------------------------------------------------
describe('GET /api/intelligence/goals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    restoreServiceMocks();
  });

  test('retorna 200 com lista vazia', async () => {
    const { handled, deps, res } = await handle('GET', '/api/intelligence/goals');
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true, total: 0 }));
  });

  test('retorna 403 sem permissao', async () => {
    const { handled, deps, res } = await handle('GET', '/api/intelligence/goals', {
      requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })),
    });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });
});

// ---------------------------------------------------------------------------
// POST /api/intelligence/operational-state
// ---------------------------------------------------------------------------
describe('POST /api/intelligence/operational-state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    restoreServiceMocks();
  });

  test('retorna 200 com estado operacional', async () => {
    const { handled, deps, res } = await handle('POST', '/api/intelligence/operational-state', {
      parseJsonBody: jest.fn(async () => ({ period: 'week' })),
    });
    expect(handled).toBe(true);
    const svc = getService();
    expect(svc.getOperationalState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-test',
        period: 'week',
        options: expect.objectContaining({
          refreshMetrics: false,
          includeEvidence: false,
          mode: 'read',
        }),
      }),
    );
    expect(deps.sendJson).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({ ok: true }),
    );
  });

  test('mode refresh habilita refreshMetrics', async () => {
    await handle('POST', '/api/intelligence/operational-state', {
      parseJsonBody: jest.fn(async () => ({ mode: 'refresh' })),
    });
    const svc = getService();
    expect(svc.getOperationalState).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          refreshMetrics: true,
          mode: 'refresh',
        }),
      }),
    );
  });

  test('retorna 400 sem Content-Type correto', async () => {
    const { handled, deps } = await handle('POST', '/api/intelligence/operational-state', {
      hasJsonContentType: jest.fn(() => false),
    });
    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /api/intelligence/operational-state
// ---------------------------------------------------------------------------
describe('GET /api/intelligence/operational-state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    restoreServiceMocks();
  });

  test('retorna 200 com estado operacional', async () => {
    const deps = makeDeps();
    const res = {};
    const handled = await handleIntelligenceRoutes({
      req: {
        url: '/api/intelligence/operational-state?period=week&mode=refresh&refreshMetrics=true&includeEvidence=true',
      },
      res,
      method: 'GET',
      pathname: '/api/intelligence/operational-state',
      deps,
    });

    expect(handled).toBe(true);
    const svc = getService();
    expect(svc.getOperationalState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-test',
        period: 'week',
        options: expect.objectContaining({
          mode: 'refresh',
          refreshMetrics: true,
          includeEvidence: true,
        }),
      }),
    );
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true }));
  });

  test('retorna 403 sem permissao', async () => {
    const deps = makeDeps({
      requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })),
    });
    const res = {};
    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/intelligence/operational-state' },
      res,
      method: 'GET',
      pathname: '/api/intelligence/operational-state',
      deps,
    });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  test('retorna 500 em erro inesperado', async () => {
    intelligenceServiceModule.__serviceMock.getOperationalState.mockRejectedValueOnce(new Error('state_fail'));
    const deps = makeDeps();
    const res = {};
    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/intelligence/operational-state' },
      res,
      method: 'GET',
      pathname: '/api/intelligence/operational-state',
      deps,
    });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 500, expect.objectContaining({ error: 'internal_error' }));
  });
});
