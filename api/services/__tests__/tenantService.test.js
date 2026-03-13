/**
 * Testes para tenantService.js (funcionalidades SaaS)
 * 
 * ATUALIZADO: Agora usa PostgreSQL (mockado) em vez de JSON/Map
 */

const { mockDatabase, clearDatabaseMocks, setupTenantMock, setupTenantNotFound, createMockTenant } = require('../../../tests/helpers/dbMock');

// Mock do sistema de arquivos antes de importar o módulo
jest.mock('fs');
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));
jest.mock('../../utils/config', () => ({
  get: jest.fn((key, defaultValue) => defaultValue || null),
}));
jest.mock('../webScrapingService');
jest.mock('../ragDocumentsService');
jest.mock('../../db/models', () => require('../../../tests/helpers/dbMock').mockModelsFactory());

// Mock do banco de dados
const { mockSequelize, mockModels } = mockDatabase();

const fs = require('fs');
const {
  createTenant,
  updateTenant,
  suspendTenant,
  reactivateTenant,
  changePlan,
  validateTenantStatus,
  getTenantUsage,
} = require('../tenantService');

describe('tenantService SaaS (PostgreSQL)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Limpa mocks dos models
    Object.values(mockModels).forEach(model => {
      Object.values(model).forEach(method => {
        if (jest.isMockFunction(method)) {
          method.mockClear();
        }
      });
    });
    // Garante que getSequelize retorna um objeto válido com pool
    const { getSequelize } = require('../../db/sequelize');
    const sequelize = getSequelize();
    if (sequelize) {
      if (!sequelize.connectionManager) {
        sequelize.connectionManager = {};
      }
      sequelize.connectionManager.pool = {};
    } else {
      // Se getSequelize retornar null, configura o mock para retornar um objeto válido
      const mockSequelize = {
        connectionManager: { pool: {} },
        authenticate: jest.fn().mockResolvedValue(true),
        close: jest.fn().mockResolvedValue(true),
      };
      getSequelize.mockReturnValue(mockSequelize);
    }
    fs.existsSync = jest.fn().mockReturnValue(false);
    fs.mkdirSync = jest.fn();
    fs.writeFileSync = jest.fn();
    fs.readFileSync = jest.fn().mockReturnValue('[]');
  });

  describe('createTenant', () => {
    test('deve criar tenant com plano trial por padrão', async () => {
      // Garante que getSequelize retorna um objeto válido
      const { getSequelize } = require('../../db/sequelize');
      const sequelize = getSequelize();
      if (sequelize && sequelize.connectionManager) {
        sequelize.connectionManager.pool = {};
      }

      // Configura mock para não encontrar tenant existente
      mockModels.Tenant.findOne
        .mockResolvedValueOnce(null) // Primeira chamada (verifica tenant_key)
        .mockResolvedValueOnce(null); // Segunda chamada (verifica site)

      const mockTenant = createMockTenant({
        tenant_key: 'tenant-test-123',
        name: 'Test Tenant',
        site: 'https://test.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
        plan: 'trial',
        status: 'trial',
      });

      mockModels.Tenant.create.mockResolvedValue(mockTenant);

      const result = await createTenant({
        name: 'Test Tenant',
        site: 'https://test.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
      });

      if (!result.success) {
        console.log('Erro no createTenant:', result.error);
      }
      expect(result.success).toBe(true);
      expect(result.tenant).toBeDefined();
      expect(result.tenant.plan).toBe('trial');
      expect(result.tenant.status).toBe('trial');
      expect(mockModels.Tenant.create).toHaveBeenCalled();
    });

    test('deve criar tenant com plano específico', async () => {
      const mockTenant = setupTenantMock(mockModels, {
        name: 'Test Tenant',
        site: 'https://test.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
        plan: 'pro',
        status: 'active',
      });

      const result = await createTenant({
        name: 'Test Tenant',
        site: 'https://test.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
        plan: 'pro',
      });

      expect(result.success).toBe(true);
      expect(result.tenant.plan).toBe('pro');
      expect(result.tenant.status).toBe('active');
    });

    test('deve incluir limites do plano', async () => {
      const mockTenant = setupTenantMock(mockModels, {
        name: 'Test Tenant Limits',
        site: 'https://test-limits.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
        plan: 'pro',
        limits: {
          usuarios: 10,
          agentes_ia: 5,
          execucoes_rpa: 500,
          tokens_ia: 500000,
          documentos_rag: 200,
          storage_mb: 500,
        },
      });

      const result = await createTenant({
        name: 'Test Tenant Limits',
        site: 'https://test-limits.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
        plan: 'pro',
      });

      expect(result.success).toBe(true);
      expect(result.tenant.limits).toBeDefined();
      expect(result.tenant.limits.usuarios).toBe(10);
    });

    test('deve retornar erro para plano inválido', async () => {
      const result = await createTenant({
        name: 'Test Tenant',
        site: 'https://test.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
        plan: 'invalid',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Plano inválido');
    });
  });

  describe('suspendTenant', () => {
    test('deve suspender tenant', async () => {
      const tenantId = 'test-tenant-suspend';
      const mockTenant = setupTenantMock(mockModels, {
        id: tenantId,
        name: 'Test Tenant Suspend',
        site: 'https://test-suspend.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
        status: 'active',
      });

      // Mock do update para retornar tenant suspenso
      const suspendedTenant = { ...mockTenant, status: 'suspended', suspended_at: new Date() };
      mockModels.Tenant.update.mockResolvedValue([1, [suspendedTenant]]);
      mockModels.Tenant.findOne.mockResolvedValue(suspendedTenant);

      const suspendResult = await suspendTenant(tenantId);

      expect(suspendResult.success).toBe(true);
      expect(suspendResult.tenant.status).toBe('suspended');
      expect(suspendResult.tenant.active).toBe(false);
      expect(suspendResult.tenant.suspendedAt).toBeDefined();
    });
  });

  describe('reactivateTenant', () => {
    test('deve reativar tenant suspenso', async () => {
      const tenantId = 'test-tenant-id';
      const mockTenant = setupTenantMock(mockModels, {
        id: tenantId,
        name: 'Test Tenant Reactivate',
        site: 'https://test-reactivate.com',
        status: 'suspended',
      });

      // Mock do update para retornar tenant ativo
      const activeTenant = { ...mockTenant, status: 'active' };
      mockModels.Tenant.update.mockResolvedValue([1, [activeTenant]]);
      mockModels.Tenant.findOne.mockResolvedValue(activeTenant);

      const reactivateResult = await reactivateTenant(tenantId);

      expect(reactivateResult.success).toBe(true);
      expect(reactivateResult.tenant.status).toBe('active');
      expect(mockModels.Tenant.update).toHaveBeenCalled();
    });
  });

  describe('changePlan', () => {
    test('deve mudar plano do tenant', async () => {
      const tenantId = 'test-tenant-change';
      const mockTenant = setupTenantMock(mockModels, {
        id: tenantId,
        name: 'Test Tenant',
        site: 'https://test.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
        plan: 'trial',
        status: 'trial',
      });

      // Mock do update para retornar tenant com plano pro
      const updatedTenant = { 
        ...mockTenant, 
        plan: 'pro',
        limits: {
          usuarios: 10,
          agentes_ia: 5,
          execucoes_rpa: 500,
          tokens_ia: 500000,
          documentos_rag: 200,
          storage_mb: 500,
        },
      };
      mockModels.Tenant.update.mockResolvedValue([1, [updatedTenant]]);
      mockModels.Tenant.findOne.mockResolvedValue(updatedTenant);

      const changeResult = await changePlan(tenantId, 'pro');

      expect(changeResult.success).toBe(true);
      expect(changeResult.tenant.plan).toBe('pro');
      expect(changeResult.tenant.limits.usuarios).toBe(10);
    });

    test('deve retornar erro para plano inválido', async () => {
      const tenantId = 'test-tenant-invalid';
      setupTenantMock(mockModels, {
        id: tenantId,
        name: 'Test Tenant Invalid Plan',
        site: 'https://test-invalidplan.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
      });

      const changeResult = await changePlan(tenantId, 'invalid');

      expect(changeResult.success).toBe(false);
      expect(changeResult.error).toContain('Plano inválido');
    });
  });

  describe('validateTenantStatus', () => {
    test('deve validar tenant ativo', async () => {
      const tenantId = 'test-tenant-id';
      setupTenantMock(mockModels, {
        id: tenantId,
        status: 'active',
        plan: 'pro',
      });

      const validation = await validateTenantStatus(tenantId);

      expect(validation.valid).toBe(true);
    });

    test('deve invalidar tenant suspenso', async () => {
      const tenantId = 'test-tenant-id';
      setupTenantMock(mockModels, {
        id: tenantId,
        status: 'suspended',
      });

      const validation = await validateTenantStatus(tenantId);

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('suspenso');
    });
  });
});
