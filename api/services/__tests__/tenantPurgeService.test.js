jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('tenantPurgeService', () => {
  let mockTenantModel;
  let mockTransaction;
  let mockSequelize;

  beforeEach(() => {
    jest.resetModules();

    mockTenantModel = {
      findOne: jest.fn(),
    };

    mockTransaction = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };

    mockSequelize = {
      transaction: jest.fn().mockResolvedValue(mockTransaction),
      query: jest.fn(),
    };

    jest.doMock('../../db/sequelize', () => ({
      getSequelize: jest.fn(() => mockSequelize),
    }));

    jest.doMock('../../db/models', () => ({
      Tenant: () => mockTenantModel,
      getTenant: () => mockTenantModel,
    }));
  });

  test('purga tabelas tenant-aware por tenant_key e tenant_id uuid antes de remover tenant', async () => {
    const tenantRecord = {
      id: 'tenant-uuid-1',
      tenant_key: 'tenant-a',
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    mockTenantModel.findOne.mockResolvedValue(tenantRecord);

    mockSequelize.query
      .mockResolvedValueOnce([[
        { table_name: 'crm_events', column_name: 'tenant_key', udt_name: 'varchar' },
        { table_name: 'audit_logs', column_name: 'tenant_id', udt_name: 'uuid' },
        { table_name: 'crm_contacts', column_name: 'tenant_id', udt_name: 'varchar' },
      ]])
      .mockResolvedValue([[], undefined]);

    const { purgeTenantData } = require('../tenantPurgeService');
    const result = await purgeTenantData({ tenantKey: 'tenant-a' });

    expect(result.success).toBe(true);
    expect(mockSequelize.transaction).toHaveBeenCalled();
    expect(mockSequelize.query).toHaveBeenCalledWith(
      'DELETE FROM "audit_logs" WHERE "tenant_id" = :tenant_0',
      expect.objectContaining({
        replacements: { tenant_0: 'tenant-uuid-1' },
        transaction: mockTransaction,
      })
    );
    expect(mockSequelize.query).toHaveBeenCalledWith(
      'DELETE FROM "crm_contacts" WHERE "tenant_id" = :tenant_0',
      expect.objectContaining({
        replacements: { tenant_0: 'tenant-a' },
        transaction: mockTransaction,
      })
    );
    expect(mockSequelize.query).toHaveBeenCalledWith(
      'DELETE FROM "crm_events" WHERE "tenant_key" = :tenant_0',
      expect.objectContaining({
        replacements: { tenant_0: 'tenant-a' },
        transaction: mockTransaction,
      })
    );
    expect(tenantRecord.destroy).toHaveBeenCalledWith({ transaction: mockTransaction });
    expect(mockTransaction.commit).toHaveBeenCalled();
    expect(mockTransaction.rollback).not.toHaveBeenCalled();
  });

  test('faz rollback quando a purge falha', async () => {
    const tenantRecord = {
      id: 'tenant-uuid-2',
      tenant_key: 'tenant-b',
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    mockTenantModel.findOne.mockResolvedValue(tenantRecord);

    mockSequelize.query
      .mockResolvedValueOnce([[
        { table_name: 'crm_events', column_name: 'tenant_key', udt_name: 'varchar' },
      ]])
      .mockRejectedValueOnce(new Error('delete failed'));

    const { purgeTenantData } = require('../tenantPurgeService');

    await expect(purgeTenantData({ tenantKey: 'tenant-b' })).rejects.toThrow('delete failed');
    expect(mockTransaction.rollback).toHaveBeenCalled();
    expect(mockTransaction.commit).not.toHaveBeenCalled();
    expect(tenantRecord.destroy).not.toHaveBeenCalled();
  });
});
