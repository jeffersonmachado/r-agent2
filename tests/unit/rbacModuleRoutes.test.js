'use strict';

const { createRbacService } = require('../../api/modules/rbac/service');
const { createRbacController } = require('../../api/modules/rbac/controller');
const { createRbacRoutes } = require('../../api/modules/rbac/routes');

describe('rbac module', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      requireTenant: jest.fn(() => 'tenant-1'),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn() },
      getRoleDefinitions: jest.fn(() => ({ admin: ['*'] })),
      createRole: jest.fn(() => ({ success: true, role: 'custom', permissions: ['agents.read'] })),
      listPermissions: jest.fn(() => ['agents.read', 'agents.update']),
      getAgent: jest.fn(async () => ({ id: 'a1', tenantId: 'tenant-1' })),
      updateAgent: jest.fn(async () => ({ success: true, agent: { id: 'a1', role: 'custom' } })),
      ...overrides,
    };
  }

  test('router nativo monta rotas esperadas', () => {
    const router = createRbacRoutes({ buildDeps: () => makeDeps() });
    const stack = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
    expect(stack).toEqual([
      '/rbac/roles',
      '/rbac/roles',
      '/rbac/permissions',
      '/rbac/assign',
    ]);
  });

  test('controller createRole preserva retorno 201', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ role: 'custom', permissions: ['agents.read'] })),
    });
    const service = createRbacService({ deps });
    const controller = createRbacController({ service, deps });
    const res = {};

    await controller.createRole({}, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, {
      role: 'custom',
      permissions: ['agents.read'],
    });
  });

  test('controller assignRole retorna 404 quando agente não existe', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ agentId: 'missing', role: 'custom' })),
      getAgent: jest.fn(async () => null),
    });
    const service = createRbacService({ deps });
    const controller = createRbacController({ service, deps });
    const res = {};

    await controller.assignRole({}, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, { error: 'agent_not_found' });
  });
});
