'use strict';

jest.mock('../../../middleware/auth', () => ({
  requireAuth: jest.fn(),
}));

jest.mock('../tokenService', () => ({
  registerPushToken: jest.fn(),
  unregisterPushToken: jest.fn(),
  assertPlatform: jest.fn((value) => value),
  assertToken: jest.fn((value) => value),
}));

const { requireAuth } = require('../../../middleware/auth');
const tokenService = require('../tokenService');
const { handleRegisterPushRoute, handleUnregisterPushRoute } = require('../pushRouteService');

describe('pushRouteService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tokenService.assertPlatform.mockImplementation((value) => value);
    tokenService.assertToken.mockImplementation((value) => value);
  });

  test('register exige auth', async () => {
    requireAuth.mockReturnValue({ valid: false, error: 'invalid_token' });

    const res = await handleRegisterPushRoute({ headers: {} }, {
      hasJsonContentType: () => true,
      parseJsonBody: async () => ({}),
    });

    expect(res.status).toBe(401);
    expect(tokenService.registerPushToken).not.toHaveBeenCalled();
  });

  test('register chama registerPushToken com tenant e user do contexto autenticado', async () => {
    requireAuth.mockImplementation((req) => {
      req.agent = { id: 'user-1', tenantId: 'tenant-1' };
      req.tenantId = 'tenant-1';
      return { valid: true, agent: req.agent };
    });

    const res = await handleRegisterPushRoute({ headers: {} }, {
      hasJsonContentType: () => true,
      parseJsonBody: async () => ({
        platform: 'android',
        token: 'token-123',
        device_name: 'Pixel',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(tokenService.registerPushToken).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
      platform: 'android',
      token: 'token-123',
      deviceName: 'Pixel',
    }));
  });

  test('unregister exige auth', async () => {
    requireAuth.mockReturnValue({ valid: false, error: 'invalid_token' });

    const res = await handleUnregisterPushRoute({ headers: {} }, {
      hasJsonContentType: () => true,
      parseJsonBody: async () => ({}),
    });

    expect(res.status).toBe(401);
    expect(tokenService.unregisterPushToken).not.toHaveBeenCalled();
  });

  test('unregister remove token do usuário autenticado', async () => {
    requireAuth.mockImplementation((req) => {
      req.agent = { id: 'user-7', tenantId: 'tenant-7' };
      req.tenantId = 'tenant-7';
      return { valid: true, agent: req.agent };
    });

    const res = await handleUnregisterPushRoute({ headers: {} }, {
      hasJsonContentType: () => true,
      parseJsonBody: async () => ({
        platform: 'ios',
        token: 'ios-token-1',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(tokenService.unregisterPushToken).toHaveBeenCalledWith({
      tenantId: 'tenant-7',
      userId: 'user-7',
      platform: 'ios',
      token: 'ios-token-1',
    });
  });
});
