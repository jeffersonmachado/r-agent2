/**
 * Testes para tenantService.js (funcionalidades SaaS)
 */

// Mock do sistema de arquivos antes de importar o módulo
jest.mock('fs');
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));
jest.mock('../../utils/config', () => ({
  get: jest.fn((key, defaultValue) => defaultValue || null), // Removido fallback para 'tenant-demo'
}));
jest.mock('../webScrapingService');
jest.mock('../ragDocumentsService');

const fs = require('fs');
const {
  createTenant,
  updateTenant,
  suspendTenant,
  reactivateTenant,
  changePlan,
  validateTenantStatus,
  getTenantUsage,
  _internal,
} = require('../tenantService');

describe('tenantService SaaS', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync = jest.fn().mockReturnValue(false);
    fs.mkdirSync = jest.fn();
    fs.writeFileSync = jest.fn();
    fs.readFileSync = jest.fn().mockReturnValue('[]');
    
    // Limpa o Map de tenants antes de cada teste
    _internal.clearTenants();
    _internal.clearTenantContexts();
  });

  describe('createTenant', () => {
    test('deve criar tenant com plano trial por padrão', () => {
      const result = createTenant({
        name: 'Test Tenant',
        site: 'https://test.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
      });

      expect(result.success).toBe(true);
      expect(result.tenant).toBeDefined();
      expect(result.tenant.plan).toBe('trial');
      expect(result.tenant.status).toBe('trial');
      expect(result.tenant.limits).toBeDefined();
      expect(result.tenant.trialExpiresAt).toBeDefined();
    });

    test('deve criar tenant com plano específico', () => {
      const result = createTenant({
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

    test('deve incluir limites do plano', () => {
      const result = createTenant({
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

    test('deve retornar erro para plano inválido', () => {
      const result = createTenant({
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
    test('deve suspender tenant', () => {
      // Primeiro cria um tenant
      const createResult = createTenant({
        name: 'Test Tenant Suspend',
        site: 'https://test-suspend.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
      });

      expect(createResult.success).toBe(true);
      expect(createResult.tenant).toBeDefined();
      const tenantId = createResult.tenant.id;

      // Depois suspende
      const suspendResult = suspendTenant(tenantId);

      expect(suspendResult.success).toBe(true);
      expect(suspendResult.tenant.status).toBe('suspended');
      expect(suspendResult.tenant.active).toBe(false);
      expect(suspendResult.tenant.suspendedAt).toBeDefined();
    });
  });

  describe('reactivateTenant', () => {
    test('deve reativar tenant suspenso', () => {
      // Cria e suspende tenant
      const createResult = createTenant({
        name: 'Test Tenant Reactivate',
        site: 'https://test-reactivate.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
        plan: 'pro',
      });

      expect(createResult.success).toBe(true);
      expect(createResult.tenant).toBeDefined();
      const tenantId = createResult.tenant.id;
      suspendTenant(tenantId);

      // Reativa
      const reactivateResult = reactivateTenant(tenantId);

      expect(reactivateResult.success).toBe(true);
      expect(reactivateResult.tenant.status).toBe('active');
      expect(reactivateResult.tenant.active).toBe(true);
    });
  });

  describe('changePlan', () => {
    test('deve mudar plano do tenant', () => {
      const createResult = createTenant({
        name: 'Test Tenant',
        site: 'https://test.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
        plan: 'trial',
      });

      const tenantId = createResult.tenant.id;

      const changeResult = changePlan(tenantId, 'pro');

      expect(changeResult.success).toBe(true);
      expect(changeResult.tenant.plan).toBe('pro');
      expect(changeResult.tenant.limits.usuarios).toBe(10);
    });

    test('deve retornar erro para plano inválido', () => {
      const createResult = createTenant({
        name: 'Test Tenant Invalid Plan',
        site: 'https://test-invalidplan.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
      });

      expect(createResult.success).toBe(true);
      expect(createResult.tenant).toBeDefined();
      const tenantId = createResult.tenant.id;

      const changeResult = changePlan(tenantId, 'invalid');

      expect(changeResult.success).toBe(false);
      expect(changeResult.error).toContain('Plano inválido');
    });
  });

  describe('validateTenantStatus', () => {
    test('deve validar tenant ativo', () => {
      const createResult = createTenant({
        name: 'Test Tenant',
        site: 'https://test.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
        plan: 'pro',
      });

      const tenantId = createResult.tenant.id;
      const validation = validateTenantStatus(tenantId);

      expect(validation.valid).toBe(true);
    });

    test('deve invalidar tenant suspenso', () => {
      const createResult = createTenant({
        name: 'Test Tenant Validate Suspended',
        site: 'https://test-validatesuspended.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
      });

      expect(createResult.success).toBe(true);
      expect(createResult.tenant).toBeDefined();
      const tenantId = createResult.tenant.id;
      suspendTenant(tenantId);

      const validation = validateTenantStatus(tenantId);

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('suspenso');
    });
  });
});
