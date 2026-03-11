'use strict';

const { handleAdminRoutes } = require('../adminRoutes');

function buildContext(overrides = {}) {
  const sendJson = jest.fn();
  return {
    req: {
      url: '/super-admin/tenants',
      headers: { host: 'localhost' },
      agent: { role: 'super_admin' },
    },
    res: {},
    method: 'GET',
    pathname: '/super-admin/tenants',
    deps: {
      requireAuth: jest.fn(() => ({ valid: true })),
      isSuperAdmin: jest.fn(() => true),
      sendJson,
      parseJsonBody: jest.fn(),
      logger: { info: jest.fn(), error: jest.fn() },
      requireTenant: jest.fn(),
      clearLimitersCache: jest.fn(),
      clearRedisRateLimitKeys: jest.fn(),
      config: { get: jest.fn(() => 'development') },
      listAllTenants: jest.fn(async () => [{ id: 'tenant-1' }]),
    },
    ...overrides,
  };
}

describe('handleAdminRoutes', () => {
  it('handles GET /super-admin/tenants via the modular admin dispatcher', async () => {
    const context = buildContext();

    const handled = await handleAdminRoutes(context);

    expect(handled).toBe(true);
    expect(context.deps.listAllTenants).toHaveBeenCalledWith({
      status: null,
      plan: null,
      search: null,
    });
    expect(context.deps.sendJson).toHaveBeenCalledWith(context.res, 200, {
      tenants: [{ id: 'tenant-1' }],
    });
  });
});
