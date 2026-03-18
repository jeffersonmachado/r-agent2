'use strict';

/**
 * Coercion-guard tests for tenantServicePg.js
 * Verifies hostile toString/message getters don't crash the service.
 */

jest.mock('../../api/db/index', () => ({ isConnected: () => true }));
jest.mock('../../api/utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));
jest.mock('../../api/db/models', () => ({
  Tenant: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() },
}));

const { getTenantFromPg, listTenantsFromPg, saveTenantToPg } = require('../../api/services/tenantServicePg');
const { Tenant } = require('../../api/db/models');

const hostileErr = () => {
  const e = new Error('real');
  Object.defineProperty(e, 'message', { get() { throw new Error('hostile message getter'); } });
  return e;
};

describe('tenantServicePg – coercion guards', () => {
  beforeEach(() => jest.clearAllMocks());

  const hostileIsoDate = () => ({
    toISOString() {
      throw new Error('hostile toISOString');
    },
  });

  test('getTenantFromPg: hostile err.message in catch does not throw', async () => {
    Tenant.findOne.mockRejectedValue(hostileErr());
    await expect(getTenantFromPg('test-key')).resolves.toBeNull();
  });

  test('listTenantsFromPg: hostile err.message in catch does not throw', async () => {
    Tenant.findAll.mockRejectedValue(hostileErr());
    await expect(listTenantsFromPg()).resolves.toEqual([]);
  });

  test('saveTenantToPg: hostile err.message returns safe error string', async () => {
    Tenant.findOne.mockRejectedValue(hostileErr());
    const result = await saveTenantToPg({ id: 'tenant1', name: 'Test' });
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  test('getTenantFromPg: hostile toISOString fields fallback safely', async () => {
    Tenant.findOne.mockResolvedValue({
      tenant_key: 'tenant-date-1',
      name: 'Tenant Date',
      site: null,
      ramo_atividade: null,
      objetivo: null,
      status: 'active',
      plan: 'trial',
      limits: {},
      settings: {},
      branding: {},
      createdAt: hostileIsoDate(),
      updatedAt: hostileIsoDate(),
      suspendedAt: hostileIsoDate(),
      trialExpiresAt: hostileIsoDate(),
    });

    const result = await getTenantFromPg('tenant-date-1');
    expect(result).toBeTruthy();
    expect(typeof result.createdAt).toBe('string');
    expect(typeof result.updatedAt).toBe('string');
    expect(result.suspendedAt).toBeNull();
    expect(result.trialExpiresAt).toBeNull();
  });

  test('saveTenantToPg: hostile date inputs do not crash and persist as null', async () => {
    const hostileDateInput = {
      toString() {
        throw new Error('hostile date input toString');
      },
    };

    Tenant.findOne.mockResolvedValue(null);
    Tenant.create.mockResolvedValue({
      tenant_key: 'tenant-date-2',
      name: 'Tenant Date 2',
      site: null,
      ramo_atividade: null,
      objetivo: null,
      status: 'trial',
      plan: 'trial',
      limits: {},
      settings: {},
      branding: {},
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      suspendedAt: null,
      trialExpiresAt: null,
    });

    const result = await saveTenantToPg({
      id: 'tenant-date-2',
      name: 'Tenant Date 2',
      suspendedAt: hostileDateInput,
      trialExpiresAt: hostileDateInput,
    });

    expect(result.success).toBe(true);
    expect(Tenant.create).toHaveBeenCalled();
    const payload = Tenant.create.mock.calls[0][0];
    expect(payload.suspendedAt).toBeNull();
    expect(payload.trialExpiresAt).toBeNull();
  });
});
