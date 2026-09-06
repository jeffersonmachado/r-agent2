'use strict';

/**
 * Rotas do loop Recommendation -> Action -> Outcome.
 * Mesmo padrao de intelligenceRoutes.test.js (service mockado, handler real).
 */

jest.mock('../../api/core/tenant-intelligence/TenantIntelligenceService', () => {
  const serviceMock = {
    searchStrategic: jest.fn(async () => ({ ok: true, answer: { summary: {} } })),
    getOperationalState: jest.fn(async () => ({ ok: true, state: {} })),
    listGoals: jest.fn(async () => ({ items: [], total: 0 })),
    createGoal: jest.fn(async () => ({ goal: { id: 'goal-1' } })),
    updateGoal: jest.fn(async () => ({ ok: true })),
    collectMetricSnapshots: jest.fn(async () => ({ ok: true, snapshots: [] })),
    listInsights: jest.fn(async () => ({ items: [], total: 0 })),
    listEvidenceByInsight: jest.fn(async () => ({ items: [], total: 0 })),
    listRecommendations: jest.fn(async () => ({ items: [], total: 0 })),
    applyRecommendation: jest.fn(async () => ({
      ok: true,
      recommendation: { id: 'reco-1', status: 'applied', metadata: { application: { appliedBy: 'admin-user' } } },
    })),
    dismissRecommendation: jest.fn(async () => ({
      ok: true,
      recommendation: { id: 'reco-1', status: 'dismissed' },
    })),
    evaluateRecommendationOutcome: jest.fn(async () => ({
      ok: true,
      recommendation: { id: 'reco-1', status: 'completed' },
      outcome: { outcome: 'improved', metrics: [] },
    })),
    applyAllOpenRecommendations: jest.fn(async () => ({
      ok: true,
      applied: 2,
      failed: 0,
      results: [
        { recommendationId: 'reco-1', ok: true },
        { recommendationId: 'reco-2', ok: true },
      ],
    })),
  };

  return {
    getTenantIntelligenceService: jest.fn(() => serviceMock),
    __serviceMock: serviceMock,
  };
});

const intelligenceServiceModule = require('../../api/core/tenant-intelligence/TenantIntelligenceService');
const { handleIntelligenceRoutes } = require('../../api/modules/intelligence/handleIntelligenceRoutes');
const { hasPermission } = require('../../api/services/rbacService');

function getService() {
  return intelligenceServiceModule.__serviceMock;
}

function createDeps(overrides = {}) {
  return {
    requireAuth: jest.fn(() => ({ valid: true })),
    requirePermission: jest.fn(() => ({ allowed: true })),
    requireTenant: jest.fn(() => 'tenant-1'),
    sendJson: jest.fn(),
    badRequest: jest.fn(),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({})),
    logger: { error: jest.fn() },
    ...overrides,
  };
}

function buildCtx({ pathname, deps, agent = { username: 'admin-user', id: 'agent-1' } }) {
  return {
    req: { url: pathname, agent },
    res: {},
    method: 'POST',
    pathname,
    deps,
  };
}

describe('recommendation action routes (apply/dismiss/outcome)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    intelligenceServiceModule.getTenantIntelligenceService.mockImplementation(() => getService());
    getService().applyRecommendation.mockResolvedValue({
      ok: true,
      recommendation: { id: 'reco-1', status: 'applied', metadata: { application: { appliedBy: 'admin-user' } } },
    });
    getService().dismissRecommendation.mockResolvedValue({
      ok: true,
      recommendation: { id: 'reco-1', status: 'dismissed' },
    });
    getService().evaluateRecommendationOutcome.mockResolvedValue({
      ok: true,
      recommendation: { id: 'reco-1', status: 'completed' },
      outcome: { outcome: 'improved', metrics: [] },
    });
  });

  test('POST apply sem auth retorna 401', async () => {
    const deps = createDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'token invalido' })) });
    const res = {};
    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/intelligence/recommendations/reco-1/apply' },
      res,
      method: 'POST',
      pathname: '/api/intelligence/recommendations/reco-1/apply',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
    expect(getService().applyRecommendation).not.toHaveBeenCalled();
  });

  test('POST apply sem analytics:write retorna 403 forbidden', async () => {
    const deps = createDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'sem permissao' })) });
    const handled = await handleIntelligenceRoutes(buildCtx({
      pathname: '/api/intelligence/recommendations/reco-1/apply',
      deps,
    }));

    expect(handled).toBe(true);
    expect(deps.requirePermission).toHaveBeenCalledWith(expect.anything(), 'analytics', 'write');
    expect(deps.sendJson).toHaveBeenCalledWith({}, 403, expect.objectContaining({ error: 'forbidden' }));
    expect(getService().applyRecommendation).not.toHaveBeenCalled();
  });

  test('POST apply com permissao chama service e retorna 200', async () => {
    const deps = createDeps();
    const res = {};
    const handled = await handleIntelligenceRoutes(buildCtx({
      pathname: '/api/intelligence/recommendations/reco-1/apply',
      deps,
    }));
    void res;

    expect(handled).toBe(true);
    expect(getService().applyRecommendation).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      recommendationId: 'reco-1',
      actor: 'admin-user',
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      ok: true,
      recommendation: expect.objectContaining({ status: 'applied' }),
    }));
  });

  test('POST dismiss envia reason do body e actor', async () => {
    const deps = createDeps({
      parseJsonBody: jest.fn(async () => ({ reason: 'duplicada' })),
    });
    const handled = await handleIntelligenceRoutes(buildCtx({
      pathname: '/api/intelligence/recommendations/reco-1/dismiss',
      deps,
    }));

    expect(handled).toBe(true);
    expect(getService().dismissRecommendation).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      recommendationId: 'reco-1',
      actor: 'admin-user',
      reason: 'duplicada',
    });
    expect(deps.sendJson).toHaveBeenCalledWith({}, 200, expect.objectContaining({
      ok: true,
      recommendation: expect.objectContaining({ status: 'dismissed' }),
    }));
  });

  test('POST outcome retorna outcome no payload', async () => {
    const deps = createDeps();
    const handled = await handleIntelligenceRoutes(buildCtx({
      pathname: '/api/intelligence/recommendations/reco-1/outcome',
      deps,
    }));

    expect(handled).toBe(true);
    expect(getService().evaluateRecommendationOutcome).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      recommendationId: 'reco-1',
    });
    expect(deps.sendJson).toHaveBeenCalledWith({}, 200, expect.objectContaining({
      ok: true,
      outcome: expect.objectContaining({ outcome: 'improved' }),
    }));
  });

  test('erro com statusCode 404 do service vira resposta 404', async () => {
    getService().applyRecommendation.mockRejectedValue(
      Object.assign(new Error('recommendation_not_found'), { code: 'recommendation_not_found', statusCode: 404 }),
    );
    const deps = createDeps();
    const handled = await handleIntelligenceRoutes(buildCtx({
      pathname: '/api/intelligence/recommendations/reco-outro-tenant/apply',
      deps,
    }));

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith({}, 404, { error: 'recommendation_not_found' });
  });

  test('erro 409 recommendation_not_open em apply ja aplicada', async () => {
    getService().applyRecommendation.mockRejectedValue(
      Object.assign(new Error('recommendation_not_open'), { code: 'recommendation_not_open', statusCode: 409 }),
    );
    const deps = createDeps();
    const handled = await handleIntelligenceRoutes(buildCtx({
      pathname: '/api/intelligence/recommendations/reco-1/apply',
      deps,
    }));

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith({}, 409, { error: 'recommendation_not_open' });
  });

  test('erro 409 recommendation_not_applied em outcome de nao aplicada', async () => {
    getService().evaluateRecommendationOutcome.mockRejectedValue(
      Object.assign(new Error('recommendation_not_applied'), { code: 'recommendation_not_applied', statusCode: 409 }),
    );
    const deps = createDeps();
    const handled = await handleIntelligenceRoutes(buildCtx({
      pathname: '/api/intelligence/recommendations/reco-1/outcome',
      deps,
    }));

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith({}, 409, { error: 'recommendation_not_applied' });
  });

  test('erro inesperado do service retorna 500', async () => {
    getService().applyRecommendation.mockRejectedValue(new Error('boom'));
    const deps = createDeps();
    const handled = await handleIntelligenceRoutes(buildCtx({
      pathname: '/api/intelligence/recommendations/reco-1/apply',
      deps,
    }));

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith({}, 500, expect.objectContaining({ error: 'internal_error' }));
    expect(deps.logger.error).toHaveBeenCalled();
  });

  test('sufixo desconhecido retorna false (rota nao tratada)', async () => {
    const deps = createDeps();
    const handled = await handleIntelligenceRoutes(buildCtx({
      pathname: '/api/intelligence/recommendations/reco-1/unknown',
      deps,
    }));

    expect(handled).toBe(false);
  });
});

describe('recommendation batch route (apply-all)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    intelligenceServiceModule.getTenantIntelligenceService.mockImplementation(() => getService());
    getService().applyAllOpenRecommendations.mockResolvedValue({
      ok: true,
      applied: 2,
      failed: 0,
      results: [
        { recommendationId: 'reco-1', ok: true },
        { recommendationId: 'reco-2', ok: true },
      ],
    });
  });

  test('POST apply-all com analytics:write chama o service com tenantId, actor e limit', async () => {
    const deps = createDeps({
      parseJsonBody: jest.fn(async () => ({ limit: 25 })),
    });
    const handled = await handleIntelligenceRoutes(buildCtx({
      pathname: '/api/intelligence/recommendations/apply-all',
      deps,
    }));

    expect(handled).toBe(true);
    expect(deps.requirePermission).toHaveBeenCalledWith(expect.anything(), 'analytics', 'write');
    expect(getService().applyAllOpenRecommendations).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      actor: 'admin-user',
      limit: 25,
    });
    expect(deps.sendJson).toHaveBeenCalledWith({}, 200, expect.objectContaining({
      ok: true,
      applied: 2,
      failed: 0,
    }));
  });

  test('apply-all NAO e confundido com recommendationId (nao cai no apply individual)', async () => {
    const deps = createDeps();
    const handled = await handleIntelligenceRoutes(buildCtx({
      pathname: '/api/intelligence/recommendations/apply-all',
      deps,
    }));

    expect(handled).toBe(true);
    expect(getService().applyAllOpenRecommendations).toHaveBeenCalled();
    expect(getService().applyRecommendation).not.toHaveBeenCalled();
  });

  test('POST apply-all sem analytics:write retorna 403 forbidden', async () => {
    const deps = createDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'sem permissao' })) });
    const handled = await handleIntelligenceRoutes(buildCtx({
      pathname: '/api/intelligence/recommendations/apply-all',
      deps,
    }));

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith({}, 403, expect.objectContaining({ error: 'forbidden' }));
    expect(getService().applyAllOpenRecommendations).not.toHaveBeenCalled();
  });

  test('POST apply-all sem auth retorna 401', async () => {
    const deps = createDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'token invalido' })) });
    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/intelligence/recommendations/apply-all' },
      res: {},
      method: 'POST',
      pathname: '/api/intelligence/recommendations/apply-all',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith({}, 401, expect.objectContaining({ error: 'unauthorized' }));
    expect(getService().applyAllOpenRecommendations).not.toHaveBeenCalled();
  });

  test('erro inesperado do service retorna 500', async () => {
    getService().applyAllOpenRecommendations.mockRejectedValue(new Error('boom'));
    const deps = createDeps();
    const handled = await handleIntelligenceRoutes(buildCtx({
      pathname: '/api/intelligence/recommendations/apply-all',
      deps,
    }));

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith({}, 500, expect.objectContaining({ error: 'internal_error' }));
  });
});

describe('rbacService — matriz analytics:write por role', () => {
  test.each(['owner', 'admin', 'supervisor', 'manager'])('role %s tem analytics:write', (role) => {
    expect(hasPermission({ role }, 'analytics', 'write')).toBe(true);
  });

  test.each(['operator', 'auditor', 'readonly'])('role %s NAO tem analytics:write', (role) => {
    expect(hasPermission({ role }, 'analytics', 'write')).toBe(false);
  });

  test('roles sem analytics:write mantem analytics:read quando aplicavel', () => {
    expect(hasPermission({ role: 'auditor' }, 'analytics', 'read')).toBe(true);
    expect(hasPermission({ role: 'readonly' }, 'analytics', 'read')).toBe(true);
  });

  test('super_admin sempre permitido', () => {
    expect(hasPermission({ role: 'super_admin' }, 'analytics', 'write')).toBe(true);
  });
});
