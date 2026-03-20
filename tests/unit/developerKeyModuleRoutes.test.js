'use strict';

describe('developer-key module', () => {
  let createDeveloperKeyRoutes;
  let createDeveloperKeyController;

  beforeEach(() => {
    jest.resetModules();
    ({ createDeveloperKeyRoutes } = require('../../api/modules/developer-key/routes'));
    ({ createDeveloperKeyController } = require('../../api/modules/developer-key/controller'));
  });

  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn((req, resource, action) => ({ allowed: true, resource, action })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn() },
      logAction: jest.fn(),
      ...overrides,
    };
  }

  function makeReq(overrides = {}) {
    return {
      url: '/x',
      tenantId: 't1',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      agent: { id: 'a1', username: 'agent-1' },
      ...overrides,
    };
  }

  test('router nativo monta rotas esperadas', () => {
    const router = createDeveloperKeyRoutes({
      buildDeps: () => makeDeps(),
    });

    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).sort(),
      }));

    expect(paths).toEqual([
      { path: '/developer/keys', methods: ['get'] },
      { path: '/developer/keys', methods: ['post'] },
      { path: '/developer/usage', methods: ['get'] },
    ]);
  });

  test('controller list normaliza filtros e retorna itens', async () => {
    const service = {
      parseListFilters: jest.fn(() => ({ includeToken: false, active: false })),
      listDeveloperKeys: jest.fn(async () => [{ id: 'k1' }]),
    };
    const deps = makeDeps();
    const controller = createDeveloperKeyController({ service, deps });
    const req = makeReq({ url: '/developer/keys?includeToken=false&active=false' });
    const res = {};

    await controller.list(req, res);

    expect(service.listDeveloperKeys).toHaveBeenCalledWith({
      tenantId: 't1',
      active: false,
      includeToken: false,
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, { ok: true, items: [{ id: 'k1' }] });
  });

  test('controller create respeita contrato atual', async () => {
    const service = {
      parseCreatePayload: jest.fn(() => ({
        name: 'Chave Integracao',
        description: 'Integracao externa',
        expiresInSec: 3600,
      })),
      createDeveloperKey: jest.fn(async () => ({ id: 'key-1', token: 'abc' })),
    };
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        name: ' Chave Integracao ',
        description: ' Integracao externa ',
        expiresInSec: 3600,
      })),
    });
    const controller = createDeveloperKeyController({ service, deps });
    const req = makeReq({ headers: { 'user-agent': 'jest-agent', 'x-forwarded-for': '10.0.0.1' } });
    const res = {};

    await controller.create(req, res);

    expect(service.createDeveloperKey).toHaveBeenCalledWith({
      tenantId: 't1',
      name: 'Chave Integracao',
      description: 'Integracao externa',
      expiresInSec: 3600,
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, {
      ok: true,
      key: { id: 'key-1', token: 'abc' },
    });
  });
});
