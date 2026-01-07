/**
 * Testes para rbacService.js
 */

const { hasPermission } = require('../rbacService');

describe('rbacService', () => {
  describe('hasPermission', () => {
    test('deve retornar true para admin em qualquer recurso/ação', () => {
      const admin = { role: 'admin' };

      expect(hasPermission(admin, 'tickets', 'create')).toBe(true);
      expect(hasPermission(admin, 'tickets', 'delete')).toBe(true);
      expect(hasPermission(admin, 'queues', 'admin')).toBe(true);
      expect(hasPermission(admin, 'agents', 'delete')).toBe(true);
      expect(hasPermission(admin, 'config', 'update')).toBe(true);
    });

    test('deve retornar true para supervisor em recursos permitidos', () => {
      const supervisor = { role: 'supervisor' };

      expect(hasPermission(supervisor, 'tickets', 'create')).toBe(true);
      expect(hasPermission(supervisor, 'tickets', 'read')).toBe(true);
      expect(hasPermission(supervisor, 'tickets', 'update')).toBe(true);
      expect(hasPermission(supervisor, 'agents', 'read')).toBe(true);
      expect(hasPermission(supervisor, 'reports', 'read')).toBe(true);
    });

    test('deve retornar false para supervisor em recursos não permitidos', () => {
      const supervisor = { role: 'supervisor' };

      expect(hasPermission(supervisor, 'tickets', 'delete')).toBe(false);
      expect(hasPermission(supervisor, 'queues', 'create')).toBe(false);
      expect(hasPermission(supervisor, 'agents', 'delete')).toBe(false);
      expect(hasPermission(supervisor, 'config', 'update')).toBe(false);
    });

    test('deve retornar true para agent em recursos básicos', () => {
      const agent = { role: 'agent' };

      expect(hasPermission(agent, 'tickets', 'read')).toBe(true);
      expect(hasPermission(agent, 'tickets', 'assign')).toBe(true);
      expect(hasPermission(agent, 'tickets', 'close')).toBe(true);
      expect(hasPermission(agent, 'queues', 'read')).toBe(true);
      expect(hasPermission(agent, 'flows', 'read')).toBe(true);
    });

    test('deve retornar false para agent em recursos restritos', () => {
      const agent = { role: 'agent' };

      expect(hasPermission(agent, 'tickets', 'create')).toBe(false);
      expect(hasPermission(agent, 'tickets', 'delete')).toBe(false);
      expect(hasPermission(agent, 'queues', 'create')).toBe(false);
      expect(hasPermission(agent, 'agents', 'create')).toBe(false);
      expect(hasPermission(agent, 'config', 'update')).toBe(false);
    });

    test('deve retornar false quando agente não tem role', () => {
      const agent = {};

      expect(hasPermission(agent, 'tickets', 'read')).toBe(false);
    });

    test('deve retornar false quando agente é null', () => {
      expect(hasPermission(null, 'tickets', 'read')).toBe(false);
    });

    test('deve retornar false para role inválido', () => {
      const agent = { role: 'invalid_role' };

      expect(hasPermission(agent, 'tickets', 'read')).toBe(false);
    });

    test('deve verificar permissões específicas de cada role', () => {
      const owner = { role: 'owner' };
      const admin = { role: 'admin' };
      const manager = { role: 'manager' };
      const operator = { role: 'operator' };
      const auditor = { role: 'auditor' };
      const readonly = { role: 'readonly' };
      const supervisor = { role: 'supervisor' }; // Role antigo
      const agent = { role: 'agent' }; // Role antigo

      // Owner tem todas as permissões + gestão de tenant
      expect(hasPermission(owner, 'tenant', 'manage')).toBe(true);
      expect(hasPermission(owner, 'tickets', 'list_all')).toBe(true);
      expect(hasPermission(owner, 'rag', 'train')).toBe(true);

      // Admin tem todas as permissões (exceto gestão de tenant)
      expect(hasPermission(admin, 'tickets', 'list_all')).toBe(true);
      expect(hasPermission(admin, 'queues', 'admin')).toBe(true);
      expect(hasPermission(admin, 'rag', 'admin')).toBe(true);

      // Manager (equivalente a supervisor antigo)
      expect(hasPermission(manager, 'tickets', 'list_all')).toBe(true);
      expect(hasPermission(manager, 'queues', 'admin')).toBe(false);
      expect(hasPermission(manager, 'rag', 'admin')).toBe(false);

      // Operator (equivalente a agent antigo)
      expect(hasPermission(operator, 'tickets', 'list_all')).toBe(false);
      expect(hasPermission(operator, 'queues', 'admin')).toBe(false);
      expect(hasPermission(operator, 'rag', 'admin')).toBe(false);
      expect(hasPermission(operator, 'rag', 'query')).toBe(true);

      // Auditor - apenas leitura e auditoria
      expect(hasPermission(auditor, 'audit', 'read')).toBe(true);
      expect(hasPermission(auditor, 'audit', 'export')).toBe(true);
      expect(hasPermission(auditor, 'tickets', 'create')).toBe(false);

      // Readonly - apenas leitura básica
      expect(hasPermission(readonly, 'tickets', 'read')).toBe(true);
      expect(hasPermission(readonly, 'tickets', 'create')).toBe(false);

      // Supervisor (role antigo) -> migra para manager
      expect(hasPermission(supervisor, 'tickets', 'list_all')).toBe(true);

      // Agent (role antigo) -> migra para operator
      expect(hasPermission(agent, 'tickets', 'read')).toBe(true);
      expect(hasPermission(agent, 'rag', 'query')).toBe(true);
    });

    test('deve verificar permissões de quick_replies', () => {
      const admin = { role: 'admin' };
      const supervisor = { role: 'supervisor' };
      const agent = { role: 'agent' };

      expect(hasPermission(admin, 'quick_replies', 'create')).toBe(true);
      expect(hasPermission(admin, 'quick_replies', 'delete')).toBe(true);
      expect(hasPermission(supervisor, 'quick_replies', 'update')).toBe(true);
      expect(hasPermission(supervisor, 'quick_replies', 'create')).toBe(false);
      expect(hasPermission(agent, 'quick_replies', 'read')).toBe(true);
      expect(hasPermission(agent, 'quick_replies', 'create')).toBe(false);
    });

    test('deve verificar permissões de departments', () => {
      const admin = { role: 'admin' };
      const supervisor = { role: 'supervisor' };
      const agent = { role: 'agent' };

      expect(hasPermission(admin, 'departments', 'create')).toBe(true);
      expect(hasPermission(admin, 'departments', 'delete')).toBe(true);
      expect(hasPermission(supervisor, 'departments', 'read')).toBe(true);
      expect(hasPermission(supervisor, 'departments', 'create')).toBe(false);
      expect(hasPermission(agent, 'departments', 'read')).toBe(true);
      expect(hasPermission(agent, 'departments', 'create')).toBe(false);
    });
  });
});

