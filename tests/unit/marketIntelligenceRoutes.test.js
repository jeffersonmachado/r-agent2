'use strict';

jest.mock('../../api/core/market-intelligence/MarketKnowledgeService', () => {
  const serviceMock = {
    getBenchmarks: jest.fn(async () => ({
      ok: true,
      items: [{ metricKey: 'cancellation_rate', tenantValue: 0.24, marketAvg: 0.17, marketMedian: 0.16, percentile: 82, status: 'above_market' }],
      total: 1,
    })),
    getMarketPatterns: jest.fn(async () => ({
      ok: true,
      items: [{ vertical: 'beauty', patternType: 'churn_signal', description: 'padrao agregado', confidence: 0.82 }],
      total: 1,
    })),
    getPredictions: jest.fn(async () => ({
      ok: true,
      items: [{ predictionType: 'churn_probability', targetMetric: 'attendance_rate', predictedValue: 0.31, confidence: 0.76, predictionWindow: '30d' }],
      total: 1,
    })),
    getMarketPlaybooks: jest.fn(async () => ({
      ok: true,
      items: [{ vertical: 'beauty', problemType: 'no_show', playbookName: 'double_confirmation_flow', description: 'playbook agregado', successRate: 0.67 }],
      total: 1,
    })),
  };

  return {
    getMarketKnowledgeService: jest.fn(() => serviceMock),
    __serviceMock: serviceMock,
  };
});

jest.mock('../../api/services/tenantService', () => ({
  getTenantContext: jest.fn(() => ({ ramo_atividade: 'beauty' })),
}));

const marketKnowledgeModule = require('../../api/core/market-intelligence/MarketKnowledgeService');
const { handleMarketIntelligenceRoutes } = require('../../api/serverHandlers/marketIntelligenceRoutes');

function createDeps(overrides = {}) {
  return {
    requireAuth: jest.fn(() => ({ valid: true })),
    requirePermission: jest.fn(() => ({ allowed: true })),
    requireTenant: jest.fn(() => 'tenant-1'),
    sendJson: jest.fn(),
    logger: { error: jest.fn() },
    ...overrides,
  };
}

describe('marketIntelligenceRoutes handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    marketKnowledgeModule.getMarketKnowledgeService.mockImplementation(() => marketKnowledgeModule.__serviceMock);
    marketKnowledgeModule.__serviceMock.getBenchmarks.mockResolvedValue({
      ok: true,
      items: [{ metricKey: 'cancellation_rate', tenantValue: 0.24, marketAvg: 0.17, marketMedian: 0.16, percentile: 82, status: 'above_market' }],
      total: 1,
    });
    marketKnowledgeModule.__serviceMock.getMarketPatterns.mockResolvedValue({
      ok: true,
      items: [{ vertical: 'beauty', patternType: 'churn_signal', description: 'padrao agregado', confidence: 0.82 }],
      total: 1,
    });
    marketKnowledgeModule.__serviceMock.getPredictions.mockResolvedValue({
      ok: true,
      items: [{ predictionType: 'churn_probability', targetMetric: 'attendance_rate', predictedValue: 0.31, confidence: 0.76, predictionWindow: '30d' }],
      total: 1,
    });
    marketKnowledgeModule.__serviceMock.getMarketPlaybooks.mockResolvedValue({
      ok: true,
      items: [{ vertical: 'beauty', problemType: 'no_show', playbookName: 'double_confirmation_flow', description: 'playbook agregado', successRate: 0.67 }],
      total: 1,
    });
  });

  test('retorna false para rota nao tratada', async () => {
    const handled = await handleMarketIntelligenceRoutes({
      req: { url: '/api/other' },
      res: {},
      method: 'GET',
      pathname: '/api/other',
      deps: createDeps(),
    });

    expect(handled).toBe(false);
  });

  test('bloqueia acesso cruzado entre tenants', async () => {
    const deps = createDeps();
    const res = {};

    const handled = await handleMarketIntelligenceRoutes({
      req: { url: '/api/market/benchmarks?tenant_key=tenant-2' },
      res,
      method: 'GET',
      pathname: '/api/market/benchmarks',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
    expect(marketKnowledgeModule.__serviceMock.getBenchmarks).not.toHaveBeenCalled();
  });

  test('GET /api/market/benchmarks funciona', async () => {
    const deps = createDeps();
    const res = {};

    const handled = await handleMarketIntelligenceRoutes({
      req: { url: '/api/market/benchmarks?metric_key=cancellation_rate' },
      res,
      method: 'GET',
      pathname: '/api/market/benchmarks',
      deps,
    });

    expect(handled).toBe(true);
    expect(marketKnowledgeModule.__serviceMock.getBenchmarks).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      metricKeys: ['cancellation_rate'],
      vertical: expect.any(String),
    }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      ok: true,
      items: [expect.objectContaining({ metricKey: 'cancellation_rate' })],
    }));
  });

  test('GET /api/market/patterns funciona', async () => {
    const deps = createDeps();
    const res = {};

    const handled = await handleMarketIntelligenceRoutes({
      req: { url: '/api/market/patterns?vertical=beauty' },
      res,
      method: 'GET',
      pathname: '/api/market/patterns',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      items: [expect.objectContaining({ patternType: 'churn_signal' })],
    }));
  });

  test('GET /api/market/predictions funciona', async () => {
    const deps = createDeps();
    const res = {};

    const handled = await handleMarketIntelligenceRoutes({
      req: { url: '/api/market/predictions?metric_key=attendance_rate&vertical=beauty' },
      res,
      method: 'GET',
      pathname: '/api/market/predictions',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      items: [expect.objectContaining({ predictionType: 'churn_probability' })],
    }));
  });

  test('GET /api/market/playbooks funciona', async () => {
    const deps = createDeps();
    const res = {};

    const handled = await handleMarketIntelligenceRoutes({
      req: { url: '/api/market/playbooks?vertical=beauty&problem_type=no_show' },
      res,
      method: 'GET',
      pathname: '/api/market/playbooks',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      items: [expect.objectContaining({ playbookName: 'double_confirmation_flow' })],
    }));
  });
});
