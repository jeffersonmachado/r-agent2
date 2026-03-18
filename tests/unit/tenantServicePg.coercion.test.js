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
});
