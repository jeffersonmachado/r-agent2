'use strict';

const { handlePublicHealthRoutes } = require('../../api/modules/public-system/publicHealthRoutes');

function buildCtx({ authResult } = {}) {
  const sendJson = jest.fn();
  const deps = {
    sendJson,
    logger: { error: jest.fn(), debug: jest.fn() },
    config: { get: jest.fn(() => 'test') },
    requireAuth: jest.fn(() => authResult || { valid: false, error: 'no token' }),
  };
  return {
    ctx: { req: { headers: {} }, res: {}, method: 'GET', pathname: '/version', deps },
    sendJson,
  };
}

describe('GET /version (publicHealthRoutes)', () => {
  it('sem auth expõe apenas name/version/env/timestamp', async () => {
    const { ctx, sendJson } = buildCtx();

    const handled = await handlePublicHealthRoutes(ctx);

    expect(handled).toBe(true);
    const [res, status, payload] = sendJson.mock.calls[0];
    expect(status).toBe(200);
    expect(payload.name).toBe('RAP');
    expect(payload.env).toBe('test');
    expect(payload).not.toHaveProperty('runtime');
    expect(payload).not.toHaveProperty('database');
  });

  it('com super_admin autenticado inclui detalhes de runtime', async () => {
    const { ctx, sendJson } = buildCtx({
      authResult: { valid: true, agent: { id: '1', role: 'super_admin', tenantId: 'system' } },
    });

    const handled = await handlePublicHealthRoutes(ctx);

    expect(handled).toBe(true);
    const [, status, payload] = sendJson.mock.calls[0];
    expect(status).toBe(200);
    expect(payload.runtime).toMatchObject({
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    });
  });

  it('com usuário autenticado NÃO super_admin não inclui detalhes', async () => {
    const { ctx, sendJson } = buildCtx({
      authResult: { valid: true, agent: { id: '2', role: 'operator', tenantId: 'acme' } },
    });

    await handlePublicHealthRoutes(ctx);

    const [, , payload] = sendJson.mock.calls[0];
    expect(payload).not.toHaveProperty('runtime');
    expect(payload).not.toHaveProperty('database');
  });
});
