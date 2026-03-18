'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

function buildMocks({ failAdmin = false, failTemplates = false, failQueue = false, failToken = false } = {}) {
  jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));

  const tenant = { id: 'tenant-1', tenant_key: 'tk1', toJSON() { return this; } };
  const user = { id: 'user-1', email: 'a@b.com', toJSON() { return this; } };

  jest.doMock('../../api/db/models', () => ({
    Tenant: jest.fn(() => ({
      findOne: jest.fn(async () => tenant),
    })),
    User: jest.fn(() => ({
      findOne: jest.fn(async () => null),
    })),
  }));

  jest.doMock('../../api/services/tenantService', () => ({
    createTenant: jest.fn(async () => ({ success: true })),
  }));

  jest.doMock('../../api/services/authService', () => ({
    inviteUser: failAdmin
      ? jest.fn(async () => { const e = {}; Object.defineProperty(e, 'message', { get() { throw new Error('boom-invite-getter'); } }); throw e; })
      : jest.fn(async () => ({ success: true, invitationToken: 'tok-1' })),
    acceptInvitation: jest.fn(async () => ({ success: true, agent: user, token: 'jwt-1' })),
  }));

  jest.doMock('../../api/services/onboardingService', () => ({
    createInitialTemplates: failTemplates
      ? jest.fn(async () => { const e = {}; Object.defineProperty(e, 'message', { get() { throw new Error('boom-templates-getter'); } }); throw e; })
      : jest.fn(async () => ({ success: true, created: [] })),
  }));

  jest.doMock('../../api/services/physicalQueueService', () => ({
    upsertQueue: failQueue
      ? jest.fn(async () => { const e = {}; Object.defineProperty(e, 'message', { get() { throw new Error('boom-queue-getter'); } }); throw e; })
      : jest.fn(async () => ({ id: 'q-1' })),
  }));

  jest.doMock('../../api/services/publicAccessTokenService', () => ({
    listPublicTokens: jest.fn(async () => []),
    createPublicToken: failToken
      ? jest.fn(async () => { const e = {}; Object.defineProperty(e, 'message', { get() { throw new Error('boom-token-getter'); } }); throw e; })
      : jest.fn(async () => ({ id: 'tok-2', token: 'abc' })),
  }));
}

describe('oneClickBootstrapService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('bootstrapTenantOneClick retorna erro quando tenantKey ausente', async () => {
    buildMocks();
    const { bootstrapTenantOneClick } = require('../../api/services/oneClickBootstrapService');
    const result = await bootstrapTenantOneClick({ tenantKey: null });
    expect(result).toEqual(expect.objectContaining({ ok: false }));
  });

  test('suites com objetos hostis não lança exceção', async () => {
    buildMocks();
    const { bootstrapTenantOneClick } = require('../../api/services/oneClickBootstrapService');
    const hostile = { toString() { throw new Error('boom-suite'); } };
    const result = await bootstrapTenantOneClick({
      tenantKey: 'tk1',
      suites: [hostile, 'fast_service'],
    });
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    // hostile caiu para safeStr fallback ''
    expect(Array.isArray(result.suites)).toBe(true);
  });

  test('err.message getter que lança em falha de admin não estoura para cima', async () => {
    buildMocks({ failAdmin: true });
    const { bootstrapTenantOneClick } = require('../../api/services/oneClickBootstrapService');
    const result = await bootstrapTenantOneClick({
      tenantKey: 'tk1',
      adminEmail: 'a@b.com',
      adminPassword: 'pass',
    });
    // Deve completar com ok:true e ter warnings (admin falhou mas não estoura)
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings.some((w) => w.includes('admin_user_bootstrap_failed'))).toBe(true);
  });

  test('err.message getter que lança em falha de templates não estoura', async () => {
    buildMocks({ failTemplates: true });
    const { bootstrapTenantOneClick } = require('../../api/services/oneClickBootstrapService');
    const result = await bootstrapTenantOneClick({ tenantKey: 'tk1', createTemplates: true });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('templates_bootstrap_failed'))).toBe(true);
  });

  test('err.message getter que lança em falha de fila física não estoura', async () => {
    buildMocks({ failQueue: true });
    const { bootstrapTenantOneClick } = require('../../api/services/oneClickBootstrapService');
    const result = await bootstrapTenantOneClick({ tenantKey: 'tk1', createPhysicalQueue: true });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('physical_queue_bootstrap_failed'))).toBe(true);
  });

  test('err.message getter que lança em falha de token público não estoura', async () => {
    buildMocks({ failToken: true });
    const { bootstrapTenantOneClick } = require('../../api/services/oneClickBootstrapService');
    const result = await bootstrapTenantOneClick({ tenantKey: 'tk1', createTokens: true });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('public_token_bootstrap_failed'))).toBe(true);
  });

  test('locationIds com objetos hostis são coercidos com safeStr', async () => {
    buildMocks();
    const { bootstrapTenantOneClick } = require('../../api/services/oneClickBootstrapService');
    const hostileLoc = { toString() { throw new Error('boom-loc'); } };
    // loc hostil → safeStr fallback '' → filtrado por filter((x) => x !== '')
    const result = await bootstrapTenantOneClick({
      tenantKey: 'tk1',
      locationIds: [hostileLoc, 'loc-1'],
      createPhysicalQueue: true,
    });
    expect(result.ok).toBe(true);
  });
});
