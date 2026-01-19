/**
 * Testes unitários: planLimitsService (async + uso real via tenantService.getTenantUsage mockado).
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('planLimitsService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('checkLimit retorna erro quando tenant não existe', async () => {
    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(async () => null),
      getTenantUsage: jest.fn(async () => null),
    }));

    // eslint-disable-next-line global-require
    const { checkLimit } = require('../../api/services/planLimitsService');

    const result = await checkLimit('tenant-x', 'max_agentes', 1);
    expect(result.allowed).toBe(false);
  });

  test('checkLimit bloqueia quando excede max_agentes', async () => {
    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(async () => ({ id: 't1', plan: 'free', limits: null })),
      getTenantUsage: jest.fn(async () => ({ max_agentes: 1 })),
    }));

    // eslint-disable-next-line global-require
    const { checkLimit } = require('../../api/services/planLimitsService');

    const ok = await checkLimit('t1', 'max_agentes', 0);
    expect(ok.allowed).toBe(true);

    const blocked = await checkLimit('t1', 'max_agentes', 1);
    expect(blocked.allowed).toBe(false);
    expect(blocked.error).toMatch(/excedido/i);
  });
});

