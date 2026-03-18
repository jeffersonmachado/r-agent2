'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../api/services/planLimitsService', () => ({
  checkLimit: jest.fn(async () => ({ allowed: true })),
}));

describe('authService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('createAgent não quebra quando checkLimit lança erro com message hostil', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ User: jest.fn(() => ({})), Session: jest.fn(() => ({})) }));

    const { checkLimit } = require('../../api/services/planLimitsService');

    const hostileError = {};
    Object.defineProperty(hostileError, 'message', {
      get() {
        throw new Error('hostile message getter');
      },
      enumerable: true,
    });
    hostileError.toString = () => {
      throw new Error('hostile toString');
    };

    checkLimit.mockRejectedValue(hostileError);

    const svc = require('../../api/services/authService');

    const out = await svc.createAgent({
      tenantId: 'tenant-1',
      username: 'jane',
      email: 'jane@example.com',
      password: '123456',
      role: 'agent',
      name: 'Jane',
    });

    // createAgent deve continuar mesmo se checkLimit falhar
    expect(out.success).toBe(true);
    expect(out.agent).toBeDefined();
    expect(out.agent.username).toBe('jane');
  });
});
