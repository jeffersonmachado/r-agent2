'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mockRequireAuth = jest.fn();
jest.mock('../../api/middleware/auth', () => ({
  requireAuth: (...args) => mockRequireAuth(...args),
}));

const mockSendJson = jest.fn();
jest.mock('../../api/express/httpHelpers', () => ({
  sendJson: (...args) => mockSendJson(...args),
}));

const mockGetTenantCapabilities = jest.fn();
jest.mock('../../api/services/tenantCapabilitiesService', () => ({
  getTenantCapabilities: (...args) => mockGetTenantCapabilities(...args),
}));

const { requireTenantCapability } = require('../../api/middleware/requireTenantCapability');

describe('requireTenantCapability middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAuth.mockImplementation((req) => {
      req.agent = req.agent || { id: 'agent-1', role: 'admin', tenantId: 'tenant-1' };
      req.tenantId = req.tenantId || req.agent.tenantId;
      return { valid: true, agent: req.agent };
    });
  });

  test('caseManagement desabilitado → 403 capability_disabled', async () => {
    mockGetTenantCapabilities.mockResolvedValue({ inbox: true, caseManagement: false, caseCreationPolicy: 'manual' });
    const middleware = requireTenantCapability('caseManagement');
    const req = {};
    const res = {};
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSendJson).toHaveBeenCalledWith(res, 403, { error: 'capability_disabled', capability: 'caseManagement' });
  });

  test('capability habilitada → next()', async () => {
    mockGetTenantCapabilities.mockResolvedValue({ inbox: true, caseManagement: true, caseCreationPolicy: 'manual' });
    const middleware = requireTenantCapability('caseManagement');
    const next = jest.fn();

    await middleware({}, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('falha de DB → 500 explícito (sem fallback)', async () => {
    mockGetTenantCapabilities.mockRejectedValue(Object.assign(new Error('boom'), { code: 'capabilities_db_error' }));
    const middleware = requireTenantCapability('caseManagement');
    const res = {};
    const next = jest.fn();

    await middleware({}, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSendJson).toHaveBeenCalledWith(res, 500, expect.objectContaining({ error: 'internal_error' }));
  });

  test('sem autenticação → 401', async () => {
    mockRequireAuth.mockReturnValue({ valid: false, error: 'Token inválido' });
    const middleware = requireTenantCapability('caseManagement');
    const res = {};
    const next = jest.fn();

    await middleware({}, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });
});
