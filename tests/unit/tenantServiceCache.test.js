/**
 * Testes do cache em memória de getTenant (TTL curto) e da eliminação da
 * query redundante no caminho de validação de tenant.
 */

const { mockDatabase, createMockTenant } = require('../helpers/dbMock');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));
jest.mock('../../api/utils/config', () => ({
  get: jest.fn((key, defaultValue) => defaultValue || null),
}));
jest.mock('../../api/services/webScrapingService');
jest.mock('../../api/services/ragDocumentsService');
jest.mock('../../api/db/models', () => require('../helpers/dbMock').mockModelsFactory());

const { mockModels } = mockDatabase();

const {
  getTenant,
  updateTenant,
  deleteTenant,
  validateTenantStatus,
  _internal,
} = require('../../api/services/tenantService');

describe('tenantService - cache de getTenant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _internal.clearTenantCache();
    // Garante que getSequelize retorna um objeto válido com pool
    const { getSequelize } = require('../../api/db/sequelize');
    const sequelize = getSequelize();
    if (sequelize) {
      if (!sequelize.connectionManager) {
        sequelize.connectionManager = {};
      }
      sequelize.connectionManager.pool = {};
    } else {
      getSequelize.mockReturnValue({
        connectionManager: { pool: {} },
        authenticate: jest.fn().mockResolvedValue(true),
        close: jest.fn().mockResolvedValue(true),
      });
    }
  });

  test('faz uma única query por identifier e reusa o resultado (cache hit)', async () => {
    const mockTenant = createMockTenant({ tenant_key: 'tenant-cache', id: 'tenant-cache', name: 'Cache Tenant' });
    mockModels.Tenant.findOne.mockResolvedValue(mockTenant);

    const t1 = await getTenant('tenant-cache');
    const t2 = await getTenant('tenant-cache');

    expect(t1).toBeDefined();
    expect(t1.tenant_key).toBe('tenant-cache');
    expect(t2.tenant_key).toBe('tenant-cache');
    // 1 query apenas: sem o re-fetch redundante por attributes e com cache hit
    expect(mockModels.Tenant.findOne).toHaveBeenCalledTimes(1);
  });

  test('cache é chaveado pelo identifier exato (tenants distintos não colidem)', async () => {
    const tenantA = createMockTenant({ tenant_key: 'tenant-a', id: 'tenant-a', name: 'Tenant A' });
    const tenantB = createMockTenant({ tenant_key: 'tenant-b', id: 'tenant-b', name: 'Tenant B' });
    mockModels.Tenant.findOne.mockImplementation(async ({ where }) => {
      if (where && where.tenant_key === 'tenant-a') return tenantA;
      if (where && where.tenant_key === 'tenant-b') return tenantB;
      return null;
    });

    const a1 = await getTenant('tenant-a');
    const b1 = await getTenant('tenant-b');
    const a2 = await getTenant('tenant-a');

    expect(a1.tenant_key).toBe('tenant-a');
    expect(b1.tenant_key).toBe('tenant-b');
    expect(a2.tenant_key).toBe('tenant-a');
    expect(mockModels.Tenant.findOne).toHaveBeenCalledTimes(2);
  });

  test('mutação do caller não contamina o cache', async () => {
    const mockTenant = createMockTenant({ tenant_key: 'tenant-cache', id: 'tenant-cache', name: 'Cache Tenant' });
    mockModels.Tenant.findOne.mockResolvedValue(mockTenant);

    const t1 = await getTenant('tenant-cache');
    t1.name = 'MUTADO';
    t1.settings.injected = true;

    const t2 = await getTenant('tenant-cache');
    expect(t2.name).toBe('Cache Tenant');
    expect(t2.settings.injected).toBeUndefined();
  });

  test('updateTenant invalida o cache da chave', async () => {
    const mockTenant = createMockTenant({ tenant_key: 'tenant-cache', id: 'tenant-cache', name: 'Nome Antigo' });
    mockModels.Tenant.findOne.mockResolvedValue(mockTenant);

    await getTenant('tenant-cache');
    expect(mockModels.Tenant.findOne).toHaveBeenCalledTimes(1);

    const updatedTenant = createMockTenant({ tenant_key: 'tenant-cache', id: 'tenant-cache', name: 'Nome Novo' });
    mockModels.Tenant.update.mockResolvedValue([1, [updatedTenant]]);

    const updateResult = await updateTenant('tenant-cache', { name: 'Nome Novo' });
    expect(updateResult.success).toBe(true);

    mockModels.Tenant.findOne.mockClear();
    mockModels.Tenant.findOne.mockResolvedValue(updatedTenant);

    const t = await getTenant('tenant-cache');
    expect(t.name).toBe('Nome Novo');
    // Cache foi invalidado: nova query ao banco
    expect(mockModels.Tenant.findOne).toHaveBeenCalledTimes(1);
  });

  test('deleteTenant invalida o cache da chave', async () => {
    const mockTenant = createMockTenant({ tenant_key: 'tenant-cache', id: 'tenant-cache', name: 'Cache Tenant' });
    mockModels.Tenant.findOne.mockResolvedValue(mockTenant);

    await getTenant('tenant-cache');
    const deleteResult = await deleteTenant('tenant-cache');
    expect(deleteResult.success).toBe(true);

    mockModels.Tenant.findOne.mockClear();
    mockModels.Tenant.findOne.mockResolvedValue(null);

    const t = await getTenant('tenant-cache');
    expect(t).toBeNull();
    expect(mockModels.Tenant.findOne).toHaveBeenCalledTimes(1);
  });

  test('cache expira após o TTL', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      const mockTenant = createMockTenant({ tenant_key: 'tenant-ttl', id: 'tenant-ttl', name: 'TTL Tenant' });
      mockModels.Tenant.findOne.mockResolvedValue(mockTenant);

      await getTenant('tenant-ttl');
      await getTenant('tenant-ttl');
      expect(mockModels.Tenant.findOne).toHaveBeenCalledTimes(1);

      // Avança além do TTL (15s)
      jest.setSystemTime(Date.now() + 16 * 1000);

      await getTenant('tenant-ttl');
      expect(mockModels.Tenant.findOne).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('validateTenantStatus com tenant pré-carregado não consulta o banco', async () => {
    const validation = await validateTenantStatus('tenant-preloaded', {
      tenant_key: 'tenant-preloaded',
      status: 'active',
    });

    expect(validation.valid).toBe(true);
    expect(mockModels.Tenant.findOne).not.toHaveBeenCalled();
  });

  test('validateTenantStatus sem tenant pré-carregado mantém comportamento (consulta o banco)', async () => {
    const mockTenant = createMockTenant({ tenant_key: 'tenant-susp', id: 'tenant-susp', status: 'suspended' });
    mockModels.Tenant.findOne.mockResolvedValue(mockTenant);

    const validation = await validateTenantStatus('tenant-susp');

    expect(validation.valid).toBe(false);
    expect(validation.error).toContain('suspenso');
    expect(mockModels.Tenant.findOne).toHaveBeenCalledTimes(1);
  });
});
