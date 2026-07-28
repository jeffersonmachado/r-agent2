'use strict';

/**
 * Regressão: POST /admin/rate-limit/clear-cache e /admin/rate-limit/clear
 * respondiam 200 para chamadores ANÔNIMOS (achado da API Surface Wave,
 * 2026-07-28 — probe P1 recebeu 200). Endpoints administrativos com efeito
 * colateral agora exigem requireAuth + requirePermission('config','update').
 */

const { handleSystemAdminRoutes } = require('../../api/modules/domain-admin/handleSystemAdminRoutes');

function makeRes() {
  return {
    status: null,
    body: null,
  };
}

function makeDeps(overrides = {}) {
  const res = makeRes();
  const deps = {
    clearLimitersCache: () => {},
    clearRedisRateLimitKeys: async () => 0,
    config: { get: () => 'development' },
    requireAuth: () => ({ valid: false, error: 'Token de autenticação não fornecido' }),
    requirePermission: () => ({ allowed: true }),
    sendJson: (r, status, body) => { res.status = status; res.body = body; },
    logger: { info: () => {}, error: () => {}, warn: () => {} },
    ...overrides,
  };
  return { deps, res };
}

function makeReq() {
  return { headers: {}, socket: {} };
}

describe('handleSystemAdminRoutes — auth obrigatória em endpoints de rate-limit', () => {
  test('POST /admin/rate-limit/clear-cache sem credencial → 401', async () => {
    const { deps, res } = makeDeps();
    const handled = await handleSystemAdminRoutes({ req: makeReq(), res, method: 'POST', pathname: '/admin/rate-limit/clear-cache', deps });
    expect(handled).toBe(true);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  test('POST /admin/rate-limit/clear-cache autenticado sem permissão → 403', async () => {
    const { deps, res } = makeDeps({
      requireAuth: () => ({ valid: true, agent: { id: 'a1', role: 'viewer' } }),
      requirePermission: () => ({ allowed: false, error: 'Permissão negada' }),
    });
    await handleSystemAdminRoutes({ req: makeReq(), res, method: 'POST', pathname: '/admin/rate-limit/clear-cache', deps });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  test('POST /admin/rate-limit/clear-cache autenticado com permissão → 200', async () => {
    let cleared = false;
    const { deps, res } = makeDeps({
      requireAuth: () => ({ valid: true, agent: { id: 'a1', role: 'admin' } }),
      clearLimitersCache: () => { cleared = true; },
    });
    await handleSystemAdminRoutes({ req: makeReq(), res, method: 'POST', pathname: '/admin/rate-limit/clear-cache', deps });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(cleared).toBe(true);
  });

  test('POST /admin/rate-limit/clear sem credencial → 401 (antes do guard de ambiente)', async () => {
    const { deps, res } = makeDeps();
    await handleSystemAdminRoutes({ req: makeReq(), res, method: 'POST', pathname: '/admin/rate-limit/clear', deps });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  test('POST /admin/rate-limit/clear autenticado com permissão em dev → 200', async () => {
    const { deps, res } = makeDeps({
      requireAuth: () => ({ valid: true, agent: { id: 'a1', role: 'admin' } }),
    });
    await handleSystemAdminRoutes({ req: makeReq(), res, method: 'POST', pathname: '/admin/rate-limit/clear', deps });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
