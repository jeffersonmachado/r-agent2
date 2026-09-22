'use strict';

/**
 * Regressão: chamada anônima (sem qualquer token) em rota protegida pelo
 * tenant rate limit global recebia 403 tenant_validation_failed, quando o
 * contrato correto é 401 (não autenticado precede tenant ausente). Ex.:
 * POST /server/restart sem Authorization deveria ser 401, mas o rate limit
 * intercedia antes da rota com 403.
 */

jest.mock('../../infra/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true, remainingPoints: 10 })),
}));
jest.mock('../../api/services/tenantService', () => ({
  getTenant: jest.fn(),
}));
jest.mock('../../api/middleware/tenantValidation', () => ({
  requireTenant: jest.fn(),
}));
jest.mock('../../api/services/superAdminService', () => ({
  isSuperAdmin: jest.fn(() => false),
}));

const { requireTenant } = require('../../api/middleware/tenantValidation');
const { tenantRateLimitMiddleware, tenantUserRateLimitMiddleware } = require('../../api/middleware/tenantRateLimit');

function buildRes() {
  return { setHeader: jest.fn() };
}

function buildSendJson() {
  const calls = [];
  const sendJson = (res, status, body) => {
    calls.push({ status, body });
  };
  return { sendJson, calls };
}

describe('tenantRateLimitMiddleware — precedência 401 sobre 403', () => {
  test('sem req.agent (chamada anônima): retorna 401, não 403', async () => {
    requireTenant.mockResolvedValue({ valid: false, error: 'tenant_id é obrigatório. Forneça via JWT ou header X-Tenant-Id' });
    const req = { path: '/server/restart', headers: {}, agent: undefined };
    const res = buildRes();
    const { sendJson, calls } = buildSendJson();

    const allowed = await tenantRateLimitMiddleware(req, res, sendJson);

    expect(allowed).toBe(false);
    expect(calls).toEqual([{ status: 401, body: { error: 'unauthorized', message: 'Autenticação necessária' } }]);
  });

  test('com req.agent autenticado mas tenant não resolvido: mantém 403', async () => {
    requireTenant.mockResolvedValue({ valid: false, error: 'Tenant não encontrado' });
    const req = { path: '/orders', headers: {}, agent: { id: 'a1', tenantId: null, role: 'agent' } };
    const res = buildRes();
    const { sendJson, calls } = buildSendJson();

    const allowed = await tenantRateLimitMiddleware(req, res, sendJson);

    expect(allowed).toBe(false);
    expect(calls).toEqual([{ status: 403, body: { error: 'tenant_validation_failed', message: 'Tenant não encontrado' } }]);
  });
});

describe('tenantUserRateLimitMiddleware — precedência 401 sobre 403', () => {
  test('sem req.agent (chamada anônima): retorna 401, não 403', async () => {
    requireTenant.mockResolvedValue({ valid: false, error: 'tenant_id é obrigatório. Forneça via JWT ou header X-Tenant-Id' });
    const req = { path: '/orders', headers: {}, agent: undefined };
    const res = buildRes();
    const { sendJson, calls } = buildSendJson();

    const allowed = await tenantUserRateLimitMiddleware(req, res, sendJson);

    expect(allowed).toBe(false);
    expect(calls).toEqual([{ status: 401, body: { error: 'unauthorized', message: 'Autenticação necessária' } }]);
  });
});
