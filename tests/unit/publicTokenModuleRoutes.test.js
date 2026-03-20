'use strict';

describe('public-token module', () => {
  let createPublicTokenRoutes;
  let createPublicTokenController;

  beforeEach(() => {
    jest.resetModules();
    ({ createPublicTokenRoutes } = require('../../api/modules/public-token/routes'));
    ({ createPublicTokenController } = require('../../api/modules/public-token/controller'));
  });

  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn() },
      logAction: jest.fn(),
      checkRateLimit: jest.fn(async () => ({ allowed: true })),
      ...overrides,
    };
  }

  function makeReq(overrides = {}) {
    return {
      url: '/x',
      params: {},
      tenantId: 'tenant-1',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      agent: { id: 'a-1', username: 'agent' },
      ...overrides,
    };
  }

  test('router nativo monta todas as rotas esperadas', () => {
    const router = createPublicTokenRoutes({
      buildDeps: () => makeDeps(),
    });

    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).sort(),
      }));

    expect(paths).toEqual([
      { path: '/public-tokens', methods: ['get'] },
      { path: '/public-tokens/stats', methods: ['get'] },
      { path: '/public-tokens', methods: ['post'] },
      { path: '/public-tokens/:tokenId/revoke', methods: ['post'] },
      { path: '/public-tokens/:tokenId/rotate', methods: ['post'] },
      { path: '/public-tokens/resolve', methods: ['get'] },
    ]);
  });

  test('controller list normaliza filtros e retorna itens', async () => {
    const service = {
      parseListFilters: jest.fn(() => ({
        kind: 'kiosk',
        locationId: 'loc-1',
        active: true,
        includeToken: false,
      })),
      listPublicTokens: jest.fn(async () => [{ id: 'pt-1' }]),
    };
    const deps = makeDeps();
    const controller = createPublicTokenController({ service, deps });
    const req = makeReq({ url: '/public-tokens?kind=kiosk&locationId=loc-1&active=true' });
    const res = {};

    await controller.list(req, res);

    expect(service.listPublicTokens).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      kind: 'kiosk',
      locationId: 'loc-1',
      active: true,
      includeToken: false,
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      items: [{ id: 'pt-1' }],
    });
  });

  test('controller rotate mapeia token_inactive para 409', async () => {
    const service = {
      parseRotateRequest: jest.fn(() => ({ expiresInSec: 1200 })),
      rotatePublicToken: jest.fn(async () => ({ ok: false, error: 'token_inactive' })),
    };
    const deps = makeDeps();
    const controller = createPublicTokenController({ service, deps });
    const req = makeReq({
      url: '/public-tokens/pt-10/rotate?expiresInSec=1200',
      params: { tokenId: 'pt-10' },
    });
    const res = {};

    await controller.rotate(req, res);

    expect(service.rotatePublicToken).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      tokenId: 'pt-10',
      expiresInSec: 1200,
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 409, {
      error: 'conflict',
      message: 'Token já está inativo',
    });
  });

  test('controller resolve respeita contrato de sucesso', async () => {
    const service = {
      parseResolveRequest: jest.fn(() => ({ token: 'xyz' })),
      resolvePublicToken: jest.fn(async () => ({
        ok: true,
        tokenId: 'pt-11',
        kind: 'panel',
        tenantId: 'tenant-1',
        locationId: 'loc-44',
        meta: { label: 'A' },
      })),
      getAllowedKinds: jest.fn(() => ['storefront', 'kiosk', 'panel', 'station', 'access_control']),
    };
    const deps = makeDeps();
    const controller = createPublicTokenController({ service, deps });
    const req = makeReq({ url: '/public-tokens/resolve?token=xyz' });
    const res = { setHeader: jest.fn() };

    await controller.resolve(req, res);

    expect(service.resolvePublicToken).toHaveBeenCalledWith('xyz');
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      token: {
        id: 'pt-11',
        kind: 'panel',
        tenantId: 'tenant-1',
        locationId: 'loc-44',
        meta: { label: 'A' },
        allowedKinds: ['storefront', 'kiosk', 'panel', 'station', 'access_control'],
      },
    });
  });
});
