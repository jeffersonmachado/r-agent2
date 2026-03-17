/**
 * Testes unitários: AuthService (API pública).
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../api/services/planLimitsService', () => ({
  checkLimit: jest.fn(async () => ({ allowed: true })),
}));

describe('AuthService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('createAgent valida campos obrigatorios', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ User: jest.fn(() => ({})), Session: jest.fn(() => ({})) }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/authService');

    const noTenant = await svc.createAgent({ username: 'u', email: 'u@x.com', password: '123456' });
    expect(noTenant.success).toBe(false);

    const noUsername = await svc.createAgent({ tenantId: 't-1', email: 'u@x.com', password: '123456' });
    expect(noUsername.success).toBe(false);

    const shortPass = await svc.createAgent({ tenantId: 't-1', username: 'u', email: 'u@x.com', password: '123' });
    expect(shortPass.success).toBe(false);
  });

  test('createAgent + login funciona sem DB (fallback in-memory)', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ User: jest.fn(() => ({})), Session: jest.fn(() => ({})) }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/authService');

    const created = await svc.createAgent({
      tenantId: 'tenant-1',
      username: 'john',
      email: 'john@example.com',
      password: '123456',
      role: 'agent',
      name: 'John',
    });
    expect(created.success).toBe(true);

    const login = await svc.login('john', '123456');
    expect(login.success).toBe(true);
    expect(typeof login.token).toBe('string');
    expect(login.agent.username).toBe('john');
  });

  test('login com username hostil nao quebra e retorna erro de credenciais', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ User: jest.fn(() => ({})), Session: jest.fn(() => ({})) }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/authService');

    const hostile = {
      toString() {
        throw new Error('boom_toString');
      },
    };

    const result = await svc.login(hostile, '123456');
    expect(result.success).toBe(false);
  });

  test('validateToken rejeita token invalido e nao inicializado', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ User: jest.fn(() => ({})), Session: jest.fn(() => ({})) }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/authService');

    const invalidType = svc.validateToken(null);
    expect(invalidType.valid).toBe(false);

    const beforeInit = svc.validateToken('any-token');
    expect(beforeInit.valid).toBe(false);
  });
});
