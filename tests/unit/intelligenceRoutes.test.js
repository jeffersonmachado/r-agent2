'use strict';

jest.mock('../../api/core/tenant-intelligence/TenantIntelligenceService', () => {
  const serviceMock = {
    searchStrategic: jest.fn(async () => ({ ok: true, answer: { summary: {} } })),
    getOperationalState: jest.fn(async () => ({ ok: true, state: { health: { status: 'healthy', score: 100 } } })),
    listGoals: jest.fn(async () => ({ items: [], total: 0 })),
    createGoal: jest.fn(async () => ({ goal: { id: 'goal-1' }, evaluation: { computedStatus: 'on_track' } })),
    updateGoal: jest.fn(async () => ({ ok: true, goal: { id: 'goal-1' }, evaluation: { computedStatus: 'at_risk' } })),
    collectMetricSnapshots: jest.fn(async () => ({ ok: true, snapshots: [] })),
    listInsights: jest.fn(async () => ({ items: [], total: 0 })),
    listEvidenceByInsight: jest.fn(async () => ({ items: [], total: 0 })),
    listRecommendations: jest.fn(async () => ({ items: [], total: 0 })),
  };

  return {
    getTenantIntelligenceService: jest.fn(() => serviceMock),
    __serviceMock: serviceMock,
  };
});

const intelligenceServiceModule = require('../../api/core/tenant-intelligence/TenantIntelligenceService');
const { handleIntelligenceRoutes } = require('../../api/serverHandlers/intelligenceRoutes');

function getReturnedService() {
  const calls = intelligenceServiceModule.getTenantIntelligenceService.mock.results || [];
  if (!calls.length) return null;
  return calls[calls.length - 1]?.value || null;
}

function createDeps(overrides = {}) {
  return {
    requireAuth: jest.fn(() => ({ valid: true })),
    requirePermission: jest.fn(() => ({ allowed: true })),
    requireTenant: jest.fn(() => 'tenant-1'),
    sendJson: jest.fn(),
    badRequest: jest.fn(),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({ question: 'por que os cancelamentos subiram?', period: 'month', filters: {} })),
    logger: { error: jest.fn() },
    ...overrides,
  };
}

describe('intelligenceRoutes handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    intelligenceServiceModule.getTenantIntelligenceService.mockImplementation(() => intelligenceServiceModule.__serviceMock);
    intelligenceServiceModule.__serviceMock.searchStrategic.mockResolvedValue({ ok: true, answer: { summary: {} } });
    intelligenceServiceModule.__serviceMock.getOperationalState.mockResolvedValue({ ok: true, state: { health: { status: 'healthy', score: 100 } } });
    intelligenceServiceModule.__serviceMock.listGoals.mockResolvedValue({ items: [], total: 0 });
    intelligenceServiceModule.__serviceMock.createGoal.mockResolvedValue({
      goal: { id: 'goal-1' },
      evaluation: { computedStatus: 'on_track' },
    });
    intelligenceServiceModule.__serviceMock.updateGoal.mockResolvedValue({
      ok: true,
      goal: { id: 'goal-1' },
      evaluation: { computedStatus: 'at_risk' },
    });
    intelligenceServiceModule.__serviceMock.collectMetricSnapshots.mockResolvedValue({ ok: true, snapshots: [] });
    intelligenceServiceModule.__serviceMock.listInsights.mockResolvedValue({ items: [], total: 0 });
    intelligenceServiceModule.__serviceMock.listEvidenceByInsight.mockResolvedValue({ items: [], total: 0 });
    intelligenceServiceModule.__serviceMock.listRecommendations.mockResolvedValue({ items: [], total: 0 });
  });

  test('retorna false para rota nao tratada', async () => {
    const deps = createDeps();
    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/other' },
      res: {},
      method: 'GET',
      pathname: '/api/other',
      deps,
    });

    expect(handled).toBe(false);
  });

  test('POST /api/intelligence/search chama service e retorna 200', async () => {
    const deps = createDeps();
    const res = {};

    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/intelligence/search' },
      res,
      method: 'POST',
      pathname: '/api/intelligence/search',
      deps,
    });

    expect(handled).toBe(true);
    expect(intelligenceServiceModule.getTenantIntelligenceService).toHaveBeenCalledTimes(1);
    const returnedService = getReturnedService();
    expect(returnedService.searchStrategic).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      question: 'por que os cancelamentos subiram?',
      period: 'month',
      filters: {},
      options: {
        refreshMetrics: false,
        refreshInsights: false,
        refreshRecommendations: false,
        mode: 'read',
      },
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true }));
  });

  test('POST /api/intelligence/search com mode refresh ativa os refreshes', async () => {
    const deps = createDeps({
      parseJsonBody: jest.fn(async () => ({
        question: 'executar refresh',
        mode: 'refresh',
      })),
    });

    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/intelligence/search' },
      res: {},
      method: 'POST',
      pathname: '/api/intelligence/search',
      deps,
    });

    expect(handled).toBe(true);
    const returnedService = getReturnedService();
    expect(returnedService.searchStrategic).toHaveBeenCalledWith(expect.objectContaining({
      options: {
        refreshMetrics: true,
        refreshInsights: true,
        refreshRecommendations: true,
        mode: 'refresh',
      },
    }));
  });

  test('POST /api/intelligence/search permite override de options sobre mode', async () => {
    const deps = createDeps({
      parseJsonBody: jest.fn(async () => ({
        question: 'refresh parcial',
        mode: 'refresh',
        options: {
          refreshRecommendations: false,
        },
      })),
    });

    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/intelligence/search' },
      res: {},
      method: 'POST',
      pathname: '/api/intelligence/search',
      deps,
    });

    expect(handled).toBe(true);
    const returnedService = getReturnedService();
    expect(returnedService.searchStrategic).toHaveBeenCalledWith(expect.objectContaining({
      options: {
        refreshMetrics: true,
        refreshInsights: true,
        refreshRecommendations: false,
        mode: 'refresh',
      },
    }));
  });

  test('POST /api/intelligence/search valida question obrigatoria', async () => {
    const deps = createDeps({
      parseJsonBody: jest.fn(async () => ({ period: 'month' })),
    });

    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/intelligence/search' },
      res: {},
      method: 'POST',
      pathname: '/api/intelligence/search',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith({}, 'Campo "question" e obrigatorio');
  });

  test('POST /api/intelligence/operational-state chama service e retorna 200', async () => {
    const deps = createDeps({
      parseJsonBody: jest.fn(async () => ({ period: 'week', filters: { channel: 'whatsapp' } })),
    });
    const res = {};

    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/intelligence/operational-state' },
      res,
      method: 'POST',
      pathname: '/api/intelligence/operational-state',
      deps,
    });

    expect(handled).toBe(true);
    const returnedService = getReturnedService();
    expect(returnedService.getOperationalState).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      period: 'week',
      filters: { channel: 'whatsapp' },
      options: {
        refreshMetrics: false,
        includeEvidence: false,
        mode: 'read',
      },
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true }));
  });

  test('POST /api/intelligence/operational-state com mode refresh ativa refreshMetrics', async () => {
    const deps = createDeps({
      parseJsonBody: jest.fn(async () => ({
        period: 'month',
        mode: 'refresh',
        options: { includeEvidence: true },
      })),
    });

    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/intelligence/operational-state' },
      res: {},
      method: 'POST',
      pathname: '/api/intelligence/operational-state',
      deps,
    });

    expect(handled).toBe(true);
    const returnedService = getReturnedService();
    expect(returnedService.getOperationalState).toHaveBeenCalledWith(expect.objectContaining({
      options: {
        refreshMetrics: true,
        includeEvidence: true,
        mode: 'refresh',
      },
    }));
  });

  test('GET /api/intelligence/operational-state chama service e retorna 200', async () => {
    const deps = createDeps();
    const res = {};

    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/intelligence/operational-state?period=week&mode=refresh&includeEvidence=true' },
      res,
      method: 'GET',
      pathname: '/api/intelligence/operational-state',
      deps,
    });

    expect(handled).toBe(true);
    const returnedService = getReturnedService();
    expect(returnedService.getOperationalState).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      period: 'week',
      filters: {},
      options: {
        refreshMetrics: true,
        includeEvidence: true,
        mode: 'refresh',
      },
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true }));
  });

  test('POST /api/intelligence/goals cria meta', async () => {
    const deps = createDeps({
      parseJsonBody: jest.fn(async () => ({
        name: 'Reduzir cancelamentos',
        metric_key: 'orders.cancel_rate',
        target_value: 0.05,
      })),
    });

    const res = {};
    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/intelligence/goals' },
      res,
      method: 'POST',
      pathname: '/api/intelligence/goals',
      deps,
    });

    expect(handled).toBe(true);
    const returnedService = getReturnedService();
    expect(returnedService.createGoal).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      payload: {
        name: 'Reduzir cancelamentos',
        metric_key: 'orders.cancel_rate',
        target_value: 0.05,
      },
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, expect.objectContaining({ ok: true }));
  });

  test('GET /api/intelligence/recommendations lista recomendacoes', async () => {
    const deps = createDeps();

    const handled = await handleIntelligenceRoutes({
      req: { url: '/api/intelligence/recommendations?status=open&limit=20' },
      res: {},
      method: 'GET',
      pathname: '/api/intelligence/recommendations',
      deps,
    });

    expect(handled).toBe(true);
    const returnedService = getReturnedService();
    expect(returnedService.listRecommendations).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      status: 'open',
      limit: 20,
    });
    expect(deps.sendJson).toHaveBeenCalledWith({}, 200, expect.objectContaining({ ok: true }));
  });
});
