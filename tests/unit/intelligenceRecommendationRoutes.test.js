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
    getRecommendationStats: jest.fn(async () => ({
      ok: true,
      stats: {
        period: 'month',
        total: 4,
        byStatus: { open: 1, applied: 1, dismissed: 1, completed: 1 },
        acceptance: { decided: 3, accepted: 2, dismissed: 1, rate: 2 / 3 },
        outcome: { evaluated: 1, improved: 1, regressed: 0, unchanged: 0, pendingEvaluation: 1, successRate: 1 },
        automation: { applied: 2, manual: 1, auto: 1, batch: 0, automationRate: 0.5, humanInterventionRate: 0.5 },
      },
    })),
    getAttentionQueue: jest.fn(async () => ({
      ok: true,
      attention: {
        status: 'attention',
        totalItems: 1,
        items: [
          {
            kind: 'recommendation_exception',
            severity: 'high',
            id: 'reco-1',
            title: 'Redistribuir fila comercial',
            reason: 'Tempo de resposta subiu.',
            action: { type: 'apply_recommendation', recommendationId: 'reco-1' },
            createdAt: '2026-09-06T00:00:00.000Z',
          },
        ],
        generatedAt: '2026-09-06T00:00:00.000Z',
      },
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

describe('recommendation stats route (GET recommendations/stats)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    intelligenceServiceModule.getTenantIntelligenceService.mockImplementation(() => getService());
    getService().getRecommendationStats.mockResolvedValue({
      ok: true,
      stats: {
        period: 'month',
        total: 4,
        byStatus: { open: 1, applied: 1, dismissed: 1, completed: 1 },
        acceptance: { decided: 3, accepted: 2, dismissed: 1, rate: 2 / 3 },
        outcome: { evaluated: 1, improved: 1, regressed: 0, unchanged: 0, pendingEvaluation: 1, successRate: 1 },
        automation: { applied: 2, manual: 1, auto: 1, batch: 0, automationRate: 0.5, humanInterventionRate: 0.5 },
      },
    });
  });

  function buildGetCtx({ pathname, deps, agent = { username: 'admin-user', id: 'agent-1' } }) {
    return {
      req: { url: pathname, agent },
      res: {},
      method: 'GET',
      pathname: pathname.split('?')[0],
      deps,
    };
  }

  test('GET stats com analytics:read retorna agregações', async () => {
    const deps = createDeps();
    const handled = await handleIntelligenceRoutes(buildGetCtx({
      pathname: '/api/intelligence/recommendations/stats?period=quarter',
      deps,
    }));

    expect(handled).toBe(true);
    expect(deps.requirePermission).toHaveBeenCalledWith(expect.anything(), 'analytics', 'read');
    expect(getService().getRecommendationStats).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      period: 'quarter',
    });
    expect(deps.sendJson).toHaveBeenCalledWith({}, 200, expect.objectContaining({
      ok: true,
      stats: expect.objectContaining({
        acceptance: expect.objectContaining({ accepted: 2 }),
        outcome: expect.objectContaining({ successRate: 1 }),
        automation: expect.objectContaining({ automationRate: 0.5 }),
      }),
    }));
  });

  test('GET stats sem period usa default month', async () => {
    const deps = createDeps();
    const handled = await handleIntelligenceRoutes(buildGetCtx({
      pathname: '/api/intelligence/recommendations/stats',
      deps,
    }));

    expect(handled).toBe(true);
    expect(getService().getRecommendationStats).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      period: 'month',
    });
  });

  test('GET stats sem analytics:read retorna 403 forbidden', async () => {
    const deps = createDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'sem permissao' })) });
    const handled = await handleIntelligenceRoutes(buildGetCtx({
      pathname: '/api/intelligence/recommendations/stats',
      deps,
    }));

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith({}, 403, expect.objectContaining({ error: 'forbidden' }));
    expect(getService().getRecommendationStats).not.toHaveBeenCalled();
  });

  test('GET stats sem auth retorna 401', async () => {
    const deps = createDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'token invalido' })) });
    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/intelligence/recommendations/stats' },
      res: {},
      method: 'GET',
      pathname: '/api/intelligence/recommendations/stats',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith({}, 401, expect.objectContaining({ error: 'unauthorized' }));
    expect(getService().getRecommendationStats).not.toHaveBeenCalled();
  });

  test('erro inesperado do service retorna 500', async () => {
    getService().getRecommendationStats.mockRejectedValue(new Error('boom'));
    const deps = createDeps();
    const handled = await handleIntelligenceRoutes(buildGetCtx({
      pathname: '/api/intelligence/recommendations/stats',
      deps,
    }));

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith({}, 500, expect.objectContaining({ error: 'internal_error' }));
  });
});

describe('attention queue route (GET /api/intelligence/attention)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    intelligenceServiceModule.getTenantIntelligenceService.mockImplementation(() => getService());
    getService().getAttentionQueue.mockResolvedValue({
      ok: true,
      attention: {
        status: 'critical',
        totalItems: 1,
        items: [
          {
            kind: 'recommendation_exception',
            severity: 'high',
            id: 'reco-1',
            title: 'Redistribuir fila comercial',
            reason: 'Tempo de resposta subiu.',
            action: { type: 'apply_recommendation', recommendationId: 'reco-1' },
            createdAt: '2026-09-06T00:00:00.000Z',
          },
        ],
        generatedAt: '2026-09-06T00:00:00.000Z',
      },
    });
  });

  function buildGetCtx({ pathname, deps, agent = { username: 'admin-user', id: 'agent-1' } }) {
    return {
      req: { url: pathname, agent },
      res: {},
      method: 'GET',
      pathname: pathname.split('?')[0],
      deps,
    };
  }

  test('GET attention com analytics:read retorna a fila consolidada', async () => {
    const deps = createDeps();
    const handled = await handleIntelligenceRoutes(buildGetCtx({
      pathname: '/api/intelligence/attention?period=week',
      deps,
    }));

    expect(handled).toBe(true);
    expect(deps.requirePermission).toHaveBeenCalledWith(expect.anything(), 'analytics', 'read');
    expect(getService().getAttentionQueue).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      period: 'week',
    });
    expect(deps.sendJson).toHaveBeenCalledWith({}, 200, expect.objectContaining({
      ok: true,
      attention: expect.objectContaining({
        status: 'critical',
        totalItems: 1,
      }),
    }));
  });

  test('GET attention sem period usa default month', async () => {
    const deps = createDeps();
    const handled = await handleIntelligenceRoutes(buildGetCtx({
      pathname: '/api/intelligence/attention',
      deps,
    }));

    expect(handled).toBe(true);
    expect(getService().getAttentionQueue).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      period: 'month',
    });
  });

  test('GET attention sem permissão retorna 403', async () => {
    const deps = createDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })) });
    const handled = await handleIntelligenceRoutes(buildGetCtx({
      pathname: '/api/intelligence/attention',
      deps,
    }));

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith({}, 403, expect.objectContaining({ error: 'forbidden' }));
    expect(getService().getAttentionQueue).not.toHaveBeenCalled();
  });

  test('GET attention sem auth retorna 401', async () => {
    const deps = createDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'token invalido' })) });
    const res = {};
    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/intelligence/attention' },
      res,
      method: 'GET',
      pathname: '/api/intelligence/attention',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith({}, 401, expect.objectContaining({ error: 'unauthorized' }));
    expect(getService().getAttentionQueue).not.toHaveBeenCalled();
  });

  test('erro inesperado do service retorna 500', async () => {
    getService().getAttentionQueue.mockRejectedValue(new Error('boom'));
    const deps = createDeps();
    const handled = await handleIntelligenceRoutes(buildGetCtx({
      pathname: '/api/intelligence/attention',
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
