'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('channelAccountsService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('createAccount tolera erro hostil em checkLimit', async () => {
    const hostileErr = {};
    Object.defineProperty(hostileErr, 'message', {
      get() { throw new Error('boom-limit-message'); },
      enumerable: true,
    });

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      ChannelAccount: jest.fn(() => ({
        create: jest.fn(async () => ({})),
      })),
    }));
    jest.doMock('../../api/utils/crypto', () => ({
      encrypt: jest.fn((v) => `enc:${v}`),
      decrypt: jest.fn((v) => v),
    }));
    jest.doMock('../../api/services/planLimitsService', () => ({
      checkLimit: jest.fn(async () => { throw hostileErr; }),
    }));

    const { createAccount } = require('../../api/services/channelAccountsService');
    const hostileType = { toString() { throw new Error('boom-type'); } };
    const hostileExternal = { toString() { throw new Error('boom-external'); } };

    const out = await createAccount({
      tenantId: 'tenant-1',
      type: hostileType,
      externalId: hostileExternal,
      config: { token: 'x' },
    });

    expect(out).toEqual(expect.objectContaining({ success: true }));
    expect(typeof out.account.type).toBe('string');
    expect(out.account.externalId).toBe('');
  });

  test('validateConfigForType tolera config hostil', () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ ChannelAccount: jest.fn() }));
    jest.doMock('../../api/utils/crypto', () => ({ encrypt: jest.fn(), decrypt: jest.fn() }));
    jest.doMock('../../api/services/planLimitsService', () => ({ checkLimit: jest.fn() }));

    const svc = require('../../api/services/channelAccountsService');
    const hostile = { toString() { throw new Error('boom-cfg'); } };

    expect(() => svc._internal.validateConfigForType('whatsapp', {
      externalId: hostile,
      config: { accessToken: hostile },
    })).not.toThrow();
  });

  test('testAccountConnection tolera valores hostis em config/externalId para webchat', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      ChannelAccount: jest.fn(() => ({
        findOne: jest.fn(async () => ({
          toJSON: () => ({
            id: 'acct-1',
            tenant_key: 'tenant-1',
            type: 'webchat',
            status: 'active',
            external_id: null,
            config_encrypted: 'enc',
          }),
        })),
      })),
    }));
    jest.doMock('../../api/utils/crypto', () => ({
      encrypt: jest.fn((v) => `enc:${v}`),
      decrypt: jest.fn(() => '{"foo":"bar"}'),
    }));
    jest.doMock('../../api/services/planLimitsService', () => ({ checkLimit: jest.fn() }));

    const { testAccountConnection } = require('../../api/services/channelAccountsService');
    const out = await testAccountConnection({ tenantId: 'tenant-1', id: 'acct-1' });

    expect(out).toEqual(expect.objectContaining({ success: true }));
    expect(out.details.type).toBe('webchat');
  });

  test('updateAccount tolera patch hostil sem lançar', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    const row = {
      update: jest.fn(async () => {}),
      toJSON: () => ({
        id: 'acct-1',
        tenant_key: 'tenant-1',
        type: 'webchat',
        status: 'active',
        external_id: null,
      }),
    };
    jest.doMock('../../api/db/models', () => ({
      ChannelAccount: jest.fn(() => ({
        findOne: jest.fn(async () => row),
      })),
    }));
    jest.doMock('../../api/utils/crypto', () => ({ encrypt: jest.fn(), decrypt: jest.fn() }));
    jest.doMock('../../api/services/planLimitsService', () => ({ checkLimit: jest.fn() }));

    const { updateAccount } = require('../../api/services/channelAccountsService');
    const hostile = { toString() { throw new Error('boom-patch'); } };

    const out = await updateAccount({
      tenantId: 'tenant-1',
      id: 'acct-1',
      patch: { type: hostile, status: hostile, externalId: hostile },
    });

    expect(out).toEqual(expect.objectContaining({ success: true }));
  });
});
