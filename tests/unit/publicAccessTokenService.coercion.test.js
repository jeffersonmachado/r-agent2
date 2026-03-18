'use strict';

describe('publicAccessTokenService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function mockModel({ rowFactory } = {}) {
    const defaultRow = {
      id: 'pat-1',
      tenant_key: 'tenant-1',
      kind: 'storefront',
      location_id: 'loc-1',
      token: 'tok-1234567890',
      active: true,
      meta: {},
      expires_at: null,
      revoked_at: null,
      last_used_at: null,
      rotated_from_id: null,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      save: jest.fn(async function save() { return this; }),
    };
    const makeRow = rowFactory || (() => ({ ...defaultRow }));

    const model = {
      create: jest.fn(async (payload) => ({ ...defaultRow, ...payload })),
      findAll: jest.fn(async () => [makeRow()]),
      findOne: jest.fn(async () => makeRow()),
      sequelize: {
        query: jest.fn(async () => [[{
          kind: 'storefront',
          total: 1,
          active: 1,
          inactive: 0,
          revoked: 0,
          expired: 0,
          used_last_hour: 1,
          used_last_day: 1,
          last_used_at_max: new Date('2026-01-01T00:00:00.000Z'),
        }]]),
      },
    };

    jest.doMock('../../api/db/models', () => ({
      PublicAccessToken: jest.fn(() => model),
    }));

    return model;
  }

  test('listPublicTokens tolera locationId hostil', async () => {
    mockModel();
    const svc = require('../../api/services/publicAccessTokenService');
    const hostile = { toString() { throw new Error('boom-location'); } };

    const out = await svc.listPublicTokens({ tenantId: 'tenant-1', locationId: hostile });
    expect(Array.isArray(out)).toBe(true);
    expect(out[0]).toEqual(expect.objectContaining({ id: 'pat-1' }));
  });

  test('revokePublicToken tolera reason/rotatedToId hostis', async () => {
    mockModel();
    const svc = require('../../api/services/publicAccessTokenService');
    const hostile = { toString() { throw new Error('boom-reason'); } };

    const out = await svc.revokePublicToken({
      tenantId: 'tenant-1',
      tokenId: hostile,
      reason: hostile,
      rotatedToId: hostile,
    });

    expect(out).toEqual(expect.objectContaining({ ok: true }));
    expect(out.token.meta.revokedReason).toBe('');
    expect(out.token.meta.rotatedToId).toBe('');
  });

  test('resolvePublicToken tolera token hostil', async () => {
    mockModel();
    const svc = require('../../api/services/publicAccessTokenService');
    const hostile = { toString() { throw new Error('boom-token'); } };

    const out = await svc.resolvePublicToken({ token: hostile, allowedKinds: ['storefront'] });
    expect(out).toEqual(expect.objectContaining({ ok: true, tokenId: 'pat-1' }));
  });

  test('recordPublicTokenUsage tolera route/method hostis', async () => {
    const row = {
      id: 'pat-1',
      tenant_key: 'tenant-1',
      kind: 'storefront',
      meta: {},
      last_used_at: null,
      save: jest.fn(async function save() { return this; }),
    };
    mockModel({ rowFactory: () => row });
    const svc = require('../../api/services/publicAccessTokenService');
    const hostile = { toString() { throw new Error('boom-usage'); } };

    const out = await svc.recordPublicTokenUsage({
      tokenId: hostile,
      route: hostile,
      method: hostile,
      statusCode: 201,
    });

    expect(out).toEqual({ ok: true });
    expect(Object.keys(row.meta.usageByRoute)).toEqual(['POST /public/unknown']);
  });

  test('getPublicTokenStats tolera tenantId hostil', async () => {
    const model = mockModel();
    const svc = require('../../api/services/publicAccessTokenService');
    const hostile = { toString() { throw new Error('boom-tenant'); } };

    const out = await svc.getPublicTokenStats({ tenantId: hostile });
    expect(out).toEqual(expect.objectContaining({ ok: true }));
    expect(model.sequelize.query).toHaveBeenCalled();
  });
});