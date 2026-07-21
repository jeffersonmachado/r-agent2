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

  test('createAgent + login sem DB falham com erro explicito (sem fallback in-memory)', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ User: jest.fn(() => ({})), Session: jest.fn(() => ({})) }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/authService');

    // Convenção do projeto: persistência obrigatória, sem fallback em memória.
    await expect(svc.createAgent({
      tenantId: 'tenant-1',
      username: 'john',
      email: 'john@example.com',
      password: '123456',
      role: 'agent',
      name: 'John',
    })).rejects.toThrow(/PostgreSQL/);

    await expect(svc.login('john', '123456')).rejects.toThrow(/PostgreSQL/);
  });

  test('login com username hostil nao quebra com erro de coercao', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ User: jest.fn(() => ({})), Session: jest.fn(() => ({})) }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/authService');

    const hostile = {
      toString() {
        throw new Error('boom_toString');
      },
    };

    // Sem DB o erro deve ser o de persistência obrigatória — nunca o boom_toString
    // do input hostil (coerção defensiva preserva o fluxo até o gate de persistência).
    await expect(svc.login(hostile, '123456')).rejects.toThrow(/PostgreSQL/);
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

  test('loginWithRpaToken tolera erro hostil no rpaTokenManager', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ User: jest.fn(() => ({})), Session: jest.fn(() => ({})) }));

    jest.doMock('../../core/rpa/utils/rpaTokenManager', () => ({
      loadRpaToken: jest.fn(() => {
        const err = {};
        Object.defineProperty(err, 'message', {
          get() {
            throw new Error('boom-message-getter');
          },
        });
        err.toString = () => { throw new Error('boom-toString'); };
        throw err;
      }),
      isTokenValid: jest.fn(() => true),
    }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/authService');

    const out = await svc.loginWithRpaToken('token', 'tenant-1');
    expect(out.success).toBe(false);
    expect(out.error).toBe('Sistema de validação de token RPA não disponível');
  });
});
