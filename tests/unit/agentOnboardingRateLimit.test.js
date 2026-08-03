'use strict';

/**
 * Regressão de segurança (falha observada em 2026-08-03): os endpoints
 * pré-autenticação de onboarding — POST /auth/accept-invitation,
 * /auth/request-password-reset e /auth/reset-password — não tinham proteção
 * contra brute-force: request-password-reset podia ser usado para spam de
 * e-mail contra endereços arbitrários e os tokens (invitation/reset) podiam
 * ser adivinhados sem limite de tentativas.
 *
 * Comportamento correto: o IP é limitado pela política AUTH_PUBLIC antes de
 * qualquer processamento; limite excedido → 429 sem chamar o serviço.
 */

const { handleAgentOnboardingRoutes } = require('../../api/modules/domain-identity/handleAgentOnboardingRoutes');

function makeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
  };
}

function buildDeps(overrides = {}) {
  return {
    requireAuth: () => ({ valid: true, agent: { id: 'qa', tenantId: 'system' } }),
    requirePermission: () => ({ allowed: true }),
    sendJson: (res, status, payload) => { res.statusCode = status; res.body = payload; },
    badRequest: (res, message) => { res.statusCode = 400; res.body = { error: 'bad_request', message }; },
    hasJsonContentType: () => true,
    parseJsonBody: async () => ({}),
    inviteUser: jest.fn(),
    acceptInvitation: jest.fn(),
    requestPasswordReset: jest.fn(),
    resetPassword: jest.fn(),
    logAction: () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    checkRateLimit: jest.fn(),
    ...overrides,
  };
}

function ctxFor(pathname, depOverrides = {}) {
  return {
    req: { headers: { 'x-forwarded-for': '203.0.113.10' } },
    res: makeRes(),
    method: 'POST',
    pathname,
    deps: buildDeps(depOverrides),
  };
}

describe('onboarding pré-auth — rate limit AUTH_PUBLIC por IP', () => {
  test('POST /auth/request-password-reset com limite excedido → 429, sem disparar e-mail', async () => {
    const ctx = ctxFor('/auth/request-password-reset', {
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: false, retryAfter: 57 }),
    });

    const handled = await handleAgentOnboardingRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(429);
    expect(ctx.res.body.error).toBe('rate_limit_exceeded');
    expect(ctx.res.headers['retry-after']).toBe(57);
    expect(ctx.deps.requestPasswordReset).not.toHaveBeenCalled();
  });

  test('POST /auth/reset-password com limite excedido → 429, sem trocar senha', async () => {
    const ctx = ctxFor('/auth/reset-password', {
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: false, retryAfter: 60 }),
    });

    const handled = await handleAgentOnboardingRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(429);
    expect(ctx.deps.resetPassword).not.toHaveBeenCalled();
  });

  test('POST /auth/accept-invitation com limite excedido → 429, sem consumir convite', async () => {
    const ctx = ctxFor('/auth/accept-invitation', {
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: false, retryAfter: 60 }),
    });

    const handled = await handleAgentOnboardingRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(429);
    expect(ctx.deps.acceptInvitation).not.toHaveBeenCalled();
  });

  test('POST /auth/request-password-reset dentro do limite → fluxo normal', async () => {
    const ctx = ctxFor('/auth/request-password-reset', {
      parseJsonBody: async () => ({ email: 'user@example.com' }),
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: true, remainingPoints: 1, totalPoints: 30 }),
      requestPasswordReset: jest.fn().mockResolvedValue({ success: true }),
    });

    const handled = await handleAgentOnboardingRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(200);
    expect(ctx.deps.requestPasswordReset).toHaveBeenCalledWith('user@example.com');
    expect(ctx.deps.checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ operationType: 'AUTH_PUBLIC', userId: 'ip:203.0.113.10' }),
    );
  });
});
