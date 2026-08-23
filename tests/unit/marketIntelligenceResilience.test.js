'use strict';

/**
 * Resiliência do Market Intelligence: a rota viva marca o status do
 * componente MARKET_INTELLIGENCE (HEALTHY em sucesso, DEGRADED em falha),
 * sem alterar a semântica de resposta.
 */

jest.mock('../../api/core/market-intelligence/MarketKnowledgeService', () => {
  const serviceMock = {
    getBenchmarks: jest.fn(),
    getMarketPatterns: jest.fn(async () => ({ ok: true, items: [], total: 0 })),
    getPredictions: jest.fn(async () => ({ ok: true, items: [], total: 0 })),
    getMarketPlaybooks: jest.fn(async () => ({ ok: true, items: [], total: 0 })),
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
const aiControlPlaneStatus = require('../../api/services/aiControlPlaneStatus');
const { handleMarketIntelligenceRoutes } = require('../../api/modules/market-intelligence/handleMarketIntelligenceRoutes');

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

describe('market intelligence — resiliência (MARKET_INTELLIGENCE status)', () => {
  beforeEach(() => {
    aiControlPlaneStatus.resetAiControlPlaneState();
    jest.clearAllMocks();
    marketKnowledgeModule.getMarketKnowledgeService.mockImplementation(() => marketKnowledgeModule.__serviceMock);
  });

  test('sucesso marca MARKET_INTELLIGENCE HEALTHY', async () => {
    marketKnowledgeModule.__serviceMock.getBenchmarks.mockResolvedValue({ ok: true, items: [], total: 0 });

    await handleMarketIntelligenceRoutes({
      req: { url: '/api/market/benchmarks' },
      res: {},
      method: 'GET',
      pathname: '/api/market/benchmarks',
      deps: createDeps(),
    });

    expect(aiControlPlaneStatus.getComponentStatus('MARKET_INTELLIGENCE')).toBe('HEALTHY');
  });

  test('falha marca MARKET_INTELLIGENCE DEGRADED', async () => {
    marketKnowledgeModule.__serviceMock.getBenchmarks.mockRejectedValue(new Error('db down'));

    await handleMarketIntelligenceRoutes({
      req: { url: '/api/market/benchmarks' },
      res: {},
      method: 'GET',
      pathname: '/api/market/benchmarks',
      deps: createDeps(),
    });

    expect(aiControlPlaneStatus.getComponentStatus('MARKET_INTELLIGENCE')).toBe('DEGRADED');
  });
});
