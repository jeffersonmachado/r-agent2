'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mockSetTenantVertical = jest.fn();

jest.mock('../../api/services/onboardingService', () => ({
  setTenantVertical: (...args) => mockSetTenantVertical(...args),
  CANONICAL_VERTICAL_IDS: ['beauty', 'fitness', 'bakery', 'food', 'services', 'clinic', 'market'],
}));

jest.mock('../../api/services/tenantCapabilitiesService', () => ({
  getTenantCapabilities: jest.fn(),
  setTenantCapabilities: jest.fn(),
}));

const { createTenantCapabilitiesRoutes } = require('../../api/modules/tenant-capabilities/routes');

function findRouteHandler(router, method, path) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) return null;
  return layer.route.stack[0].handle;
}

function makeDeps(overrides = {}) {
  return {
    requireAuth: jest.fn(() => ({ valid: true })),
    sendJson: jest.fn(),
    badRequest: jest.fn(),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({ vertical: 'beauty' })),
    logger: { error: jest.fn() },
    ...overrides,
  };
}

function makeReq(overrides = {}) {
  return {
    tenantId: 'tenant-1',
    agent: { id: 'a1', role: 'admin' },
    ...overrides,
  };
}

describe('PUT /api/tenant/settings/vertical', () => {
  let handler;
  let deps;

  beforeEach(() => {
    jest.clearAllMocks();
    deps = makeDeps();
    const router = createTenantCapabilitiesRoutes({ buildDeps: () => deps });
    handler = findRouteHandler(router, 'put', '/api/tenant/settings/vertical');
    expect(handler).toBeTruthy();
  });

  test('persiste vertical válida e retorna 200', async () => {
    mockSetTenantVertical.mockResolvedValue({ success: true, vertical: 'beauty' });

    await handler(makeReq(), {});

    expect(mockSetTenantVertical).toHaveBeenCalledWith('tenant-1', 'beauty');
    expect(deps.sendJson).toHaveBeenCalledWith({}, 200, { vertical: 'beauty' });
  });

  test('retorna 400 para vertical inválida', async () => {
    mockSetTenantVertical.mockResolvedValue({ success: false, error: 'invalid_vertical' });
    deps.parseJsonBody = jest.fn(async () => ({ vertical: 'crypto' }));

    await handler(makeReq(), {});

    expect(deps.sendJson).toHaveBeenCalledWith({}, 400, expect.objectContaining({ error: 'invalid_vertical' }));
  });

  test('retorna 404 quando tenant não existe', async () => {
    mockSetTenantVertical.mockResolvedValue({ success: false, error: 'tenant_not_found' });

    await handler(makeReq(), {});

    expect(deps.sendJson).toHaveBeenCalledWith({}, 404, expect.objectContaining({ error: 'tenant_not_found' }));
  });

  test('retorna 403 para role sem permissão', async () => {
    await handler(makeReq({ agent: { id: 'a1', role: 'agent' } }), {});

    expect(mockSetTenantVertical).not.toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith({}, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  test('retorna 401 sem auth', async () => {
    deps.requireAuth = jest.fn(() => ({ valid: false, error: 'no token' }));

    await handler(makeReq(), {});

    expect(deps.sendJson).toHaveBeenCalledWith({}, 401, expect.objectContaining({ error: 'unauthorized' }));
    expect(mockSetTenantVertical).not.toHaveBeenCalled();
  });
});
