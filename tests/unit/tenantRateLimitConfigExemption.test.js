'use strict';

/**
 * Regressão (gap observado em 2026-08): GET /config é público por design —
 * o controller responde a visão sanitizada (readPublicConfig) para chamadas
 * pré-login (onboarding/páginas públicas). Porém, com NODE_ENV=production,
 * o tenant rate limit global rodava antes do handler e exigia tenant_id,
 * devolvendo 403 tenant_validation_failed para requests anônimos — páginas
 * públicas exibiam erros de console no deploy real.
 *
 * Comportamento correto: o GET exato de /config (e alias /api/config) é
 * isento do tenant rate limit, como /health e /version. PUT /config e
 * subrotas /config/* (validate-provider-token, validate-redis etc.)
 * continuam protegidos por tenant rate limit + auth no controller.
 */

const { createTenantRateLimitMiddleware } = require('../../api/middleware/createTenantRateLimitMiddleware');

function buildMiddleware({ nodeEnv = 'production' } = {}) {
  const tenantRateLimitCalls = [];
  const tenantRateLimitMiddleware = jest.fn(async (req, res, sendJson) => {
    tenantRateLimitCalls.push({ path: req.path, method: req.method });
    // Simula o comportamento real: sem tenant → 403 e bloqueia.
    sendJson(res, 403, { error: 'tenant_validation_failed' });
    return false;
  });

  const middleware = createTenantRateLimitMiddleware({
    config: { get: (key, fallback) => (key === 'nodeEnv' ? nodeEnv : fallback) },
    logger: { debug: jest.fn(), error: jest.fn() },
    tenantRateLimitMiddleware,
    sendJson: (res, status, body) => {
      res.statusCode = status;
      res.body = body;
      res.writableEnded = true;
    },
  });

  return { middleware, tenantRateLimitMiddleware, tenantRateLimitCalls };
}

function run(middleware, { path, method = 'GET' }) {
  const req = { path, method, headers: {} };
  const res = { writableEnded: false, setHeader: jest.fn() };
  const next = jest.fn();
  return middleware(req, res, next).then(() => ({ req, res, next }));
}

describe('createTenantRateLimitMiddleware — isenção pública de GET /config', () => {
  test('GET /config anônimo em produção passa direto (sem exigir tenant)', async () => {
    const { middleware, tenantRateLimitMiddleware } = buildMiddleware();
    const { res, next } = await run(middleware, { path: '/config', method: 'GET' });

    expect(next).toHaveBeenCalledTimes(1);
    expect(tenantRateLimitMiddleware).not.toHaveBeenCalled();
    expect(res.statusCode).toBeUndefined();
  });

  test('GET /api/config (alias) anônimo em produção também é isento', async () => {
    const { middleware, tenantRateLimitMiddleware } = buildMiddleware();
    const { next } = await run(middleware, { path: '/api/config', method: 'GET' });

    expect(next).toHaveBeenCalledTimes(1);
    expect(tenantRateLimitMiddleware).not.toHaveBeenCalled();
  });

  test('PUT /config em produção continua protegido pelo tenant rate limit', async () => {
    const { middleware, tenantRateLimitMiddleware } = buildMiddleware();
    const { res, next } = await run(middleware, { path: '/config', method: 'PUT' });

    expect(tenantRateLimitMiddleware).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('subrotas /config/* em produção continuam protegidas', async () => {
    const { middleware, tenantRateLimitMiddleware } = buildMiddleware();

    for (const path of ['/config/validate-redis', '/config/validate-provider-token']) {
      const { res, next } = await run(middleware, { path, method: 'POST' });
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    }

    expect(tenantRateLimitMiddleware).toHaveBeenCalledTimes(2);
  });

  test('GET /config em development segue liberado pelo bypass de desenvolvimento', async () => {
    const { middleware, tenantRateLimitMiddleware } = buildMiddleware({ nodeEnv: 'development' });
    const { next } = await run(middleware, { path: '/config', method: 'GET' });

    expect(next).toHaveBeenCalledTimes(1);
    expect(tenantRateLimitMiddleware).not.toHaveBeenCalled();
  });
});
