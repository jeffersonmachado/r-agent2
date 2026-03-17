/**
 * Testes unitários: RBAC Service.
 */

describe('rbacService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('hasPermission normaliza role legado supervisor -> manager', () => {
    // eslint-disable-next-line global-require
    const svc = require('../../api/services/rbacService');

    const agent = { role: 'supervisor' };
    expect(svc.hasPermission(agent, 'flows', 'update')).toBe(true);
  });

  test('hasPermission tolera role hostil sem quebrar', () => {
    // eslint-disable-next-line global-require
    const svc = require('../../api/services/rbacService');

    const hostileRole = {
      toString() {
        throw new Error('boom_role_toString');
      },
    };

    const out = svc.hasPermission({ role: hostileRole }, 'tickets', 'read');
    expect(out).toBe(false);
  });

  test('createRole retorna erro para roleName hostil', () => {
    // eslint-disable-next-line global-require
    const svc = require('../../api/services/rbacService');

    const hostileName = {
      toString() {
        throw new Error('boom_name_toString');
      },
    };

    const out = svc.createRole(hostileName, [{ resource: 'tickets', action: 'read' }]);
    expect(out.success).toBe(false);
  });

  test('createRole sanitiza permissões e ignora entradas inválidas/hostis', () => {
    // eslint-disable-next-line global-require
    const svc = require('../../api/services/rbacService');

    const hostilePermission = {};
    Object.defineProperty(hostilePermission, 'resource', {
      get() {
        throw new Error('boom_permission_resource');
      },
    });
    Object.defineProperty(hostilePermission, 'action', {
      get() {
        return 'read';
      },
    });

    const out = svc.createRole('custom_test_role', [
      { resource: 'tickets', action: 'read' },
      { resource: 'tickets', action: 'read' },
      hostilePermission,
      { resource: '  reports ', action: ' export ' },
      null,
    ]);

    expect(out.success).toBe(true);
    expect(out.permissions).toEqual([
      { resource: 'tickets', action: 'read' },
      { resource: 'reports', action: 'export' },
    ]);
  });
});
