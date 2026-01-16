/**
 * Testes de segurança SaaS - Isolamento, RBAC e Auditoria
 */

const {
  createTenant,
  getTenant,
  validateTenantStatus,
  _internal,
} = require('../../api/services/tenantService');
const {
  createAgent,
  login,
  validateToken,
} = require('../../api/services/authService');
const {
  hasPermission,
} = require('../../api/services/rbacService');
const {
  requireTenant,
  validateResourceTenant,
} = require('../../api/middleware/tenantValidation');
const {
  logAction,
  queryLogs,
} = require('../../api/services/auditService');

// Mock do sistema de arquivos
jest.mock('fs');
jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));
jest.mock('../../api/utils/config', () => ({
  get: jest.fn((key, defaultValue) => defaultValue || null), // Removido fallback para 'tenant-demo'
}));

const fs = require('fs');

describe('SaaS Security Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync = jest.fn().mockReturnValue(false);
    fs.mkdirSync = jest.fn();
    fs.writeFileSync = jest.fn();
    fs.readFileSync = jest.fn().mockReturnValue('[]');
    
    // Limpa o estado antes de cada teste
    _internal.clearTenantContexts();
  });

  describe('Isolamento de Tenant', () => {
    test('deve bloquear acesso cruzado entre tenants', () => {
      // Cria dois tenants
      const tenant1 = createTenant({
        name: 'Tenant 1',
        site: 'https://tenant1.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
      });
      const tenant2 = createTenant({
        name: 'Tenant 2',
        site: 'https://tenant2.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
      });

      // Cria agente no tenant 1
      const agent1 = createAgent({
        tenantId: tenant1.tenant.id,
        username: 'user1',
        email: 'user1@test.com',
        password: 'pass123',
        role: 'operator',
      });

      // Quando um agente está autenticado, extractTenantId prioriza req.agent.tenantId
      // Então o agente só pode acessar seu próprio tenant
      // Testa que um agente do tenant1 não pode acessar recursos do tenant2
      const mockReq = {
        agent: { id: agent1.agent.id, tenantId: tenant1.tenant.id },
        headers: {},
      };

      // O agente do tenant1 só pode acessar tenant1
      const result1 = requireTenant(mockReq);
      expect(result1.valid).toBe(true);
      expect(result1.tenantId).toBe(tenant1.tenant.id);
      
      // Adiciona tenantId ao request (requireTenant faz isso, mas precisamos garantir)
      mockReq.tenantId = result1.tenantId;

      // Se tentar acessar um recurso do tenant2, deve ser bloqueado
      const resource = { id: 'resource-1', tenantId: tenant2.tenant.id };
      const validation = validateResourceTenant(mockReq, resource);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('tenant');
    });

    test('deve validar que recurso pertence ao tenant', () => {
      const tenant1 = createTenant({
        name: 'Tenant 1',
        site: 'https://tenant1.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
      });

      const mockReq = { tenantId: tenant1.tenant.id };
      const resource = { id: 'resource-1', tenantId: tenant1.tenant.id };

      const result = validateResourceTenant(mockReq, resource);

      expect(result.valid).toBe(true);
    });

    test('deve bloquear acesso a recurso de outro tenant', () => {
      const tenant1 = createTenant({
        name: 'Tenant 1 Block',
        site: 'https://tenant1-block.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
      });
      expect(tenant1.success).toBe(true);
      expect(tenant1.tenant).toBeDefined();
      
      const tenant2 = createTenant({
        name: 'Tenant 2 Block',
        site: 'https://tenant2-block.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
      });
      expect(tenant2.success).toBe(true);
      expect(tenant2.tenant).toBeDefined();

      const mockReq = { tenantId: tenant1.tenant.id };
      const resource = { id: 'resource-1', tenantId: tenant2.tenant.id };

      const result = validateResourceTenant(mockReq, resource);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('não pertence ao tenant');
    });
  });

  describe('RBAC - Roles Granulares', () => {
    test('owner deve ter todas as permissões', () => {
      const agent = { role: 'owner' };

      expect(hasPermission(agent, 'tenant', 'manage')).toBe(true);
      expect(hasPermission(agent, 'tickets', 'create')).toBe(true);
      expect(hasPermission(agent, 'agents', 'invite')).toBe(true);
      expect(hasPermission(agent, 'rag', 'train')).toBe(true);
    });

    test('readonly deve ter apenas permissões de leitura', () => {
      const agent = { role: 'readonly' };

      expect(hasPermission(agent, 'tickets', 'read')).toBe(true);
      expect(hasPermission(agent, 'tickets', 'create')).toBe(false);
      expect(hasPermission(agent, 'agents', 'create')).toBe(false);
    });

    test('operator deve ter permissões limitadas', () => {
      const agent = { role: 'operator' };

      expect(hasPermission(agent, 'tickets', 'read')).toBe(true);
      expect(hasPermission(agent, 'tickets', 'update')).toBe(true);
      expect(hasPermission(agent, 'agents', 'create')).toBe(false);
      expect(hasPermission(agent, 'rag', 'train')).toBe(false);
    });

    test('auditor deve ter permissões de leitura e auditoria', () => {
      const agent = { role: 'auditor' };

      expect(hasPermission(agent, 'audit', 'read')).toBe(true);
      expect(hasPermission(agent, 'audit', 'export')).toBe(true);
      expect(hasPermission(agent, 'tickets', 'create')).toBe(false);
    });

    test('deve migrar roles antigos corretamente', () => {
      const supervisor = { role: 'supervisor' };
      const agent = { role: 'agent' };

      // supervisor -> manager
      expect(hasPermission(supervisor, 'tickets', 'list_all')).toBe(true);
      
      // agent -> operator
      expect(hasPermission(agent, 'tickets', 'read')).toBe(true);
    });
  });

  describe('Auditoria', () => {
    test('deve registrar ação com tenant_id', () => {
      const tenant = createTenant({
        name: 'Test Tenant Audit',
        site: 'https://test-audit.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
      });
      expect(tenant.success).toBe(true);
      expect(tenant.tenant).toBeDefined();

      logAction({
        agentId: 'agent-1',
        username: 'user1',
        tenantId: tenant.tenant.id,
        action: 'test_action',
        resource: 'test_resource',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      });

      const logs = queryLogs({ tenantId: tenant.tenant.id });

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].tenantId).toBe(tenant.tenant.id);
    });

    test('deve filtrar logs por tenant', () => {
      const tenant1 = createTenant({
        name: 'Tenant 1 Logs',
        site: 'https://tenant1-logs.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
      });
      expect(tenant1.success).toBe(true);
      expect(tenant1.tenant).toBeDefined();
      
      const tenant2 = createTenant({
        name: 'Tenant 2 Logs',
        site: 'https://tenant2-logs.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
      });
      expect(tenant2.success).toBe(true);
      expect(tenant2.tenant).toBeDefined();

      logAction({
        agentId: 'agent-1',
        username: 'user1',
        tenantId: tenant1.tenant.id,
        action: 'action1',
        resource: 'resource1',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      });

      logAction({
        agentId: 'agent-2',
        username: 'user2',
        tenantId: tenant2.tenant.id,
        action: 'action2',
        resource: 'resource2',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      });

      const logs1 = queryLogs({ tenantId: tenant1.tenant.id });
      const logs2 = queryLogs({ tenantId: tenant2.tenant.id });

      expect(logs1.every(log => log.tenantId === tenant1.tenant.id)).toBe(true);
      expect(logs2.every(log => log.tenantId === tenant2.tenant.id)).toBe(true);
    });
  });

  describe('Validação de Status de Tenant', () => {
    test('deve bloquear acesso a tenant suspenso', () => {
      const tenant = createTenant({
        name: 'Test Tenant Suspended',
        site: 'https://test-suspended.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
      });
      expect(tenant.success).toBe(true);
      expect(tenant.tenant).toBeDefined();

      const { suspendTenant } = require('../../api/services/tenantService');
      suspendTenant(tenant.tenant.id);

      const validation = validateTenantStatus(tenant.tenant.id);

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('suspenso');
    });

    test('deve permitir acesso a tenant ativo', () => {
      const tenant = createTenant({
        name: 'Test Tenant Active',
        site: 'https://test-active.com',
        ramo_atividade: 'Teste',
        objetivo: 'Testar',
        plan: 'pro',
      });
      expect(tenant.success).toBe(true);
      expect(tenant.tenant).toBeDefined();

      const validation = validateTenantStatus(tenant.tenant.id);

      expect(validation.valid).toBe(true);
    });
  });
});
