'use strict';

/**
 * Regressão de segurança (falha observada em 2026-08-03): os endpoints
 * pré-autenticação do domínio auth — POST /auth/login, /auth/signup e
 * /auth/rpa/login (e aliases /api/*) — não tinham NENHUMA proteção contra
 * brute-force: estão explicitamente excluídos do rate limit por tenant
 * (api/middleware/createTenantRateLimitMiddleware.js) e authService não tem
 * lockout/throttle. Um atacante podia tentar senhas ilimitadamente (login),
 * criar tenants sem limite (signup) e forçar o segredo RPA (rpa/login).
 *
 * Comportamento correto: antes de qualquer validação/credencial, o IP é
 * limitado pela política AUTH_PUBLIC (infra/rate-limit). Limite excedido →
 * 429 rate_limit_exceeded com Retry-After, SEM chamar o serviço de auth.
 * Em desenvolvimento o checkRateLimit já é bypass por design (infra).
 */

const express = require('express');

const { createAuthRoutes } = require('../../api/modules/auth/routes');

function buildDeps(overrides = {}) {
  return {
    sendJson: (res, status, payload) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    },
    badRequest: (res, message) => {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'bad_request', message }));
    },
    validateInput: (body) => body,
    schemas: {},
    ValidationError: class ValidationError extends Error {},
    authLogin: jest.fn(),
    createSaasSignupAccount: jest.fn(),
    loginWithRpaToken: jest.fn(),
    validateToken: () => ({ valid: false }),
    authLogout: () => {},
    logoutAllSessions: () => {},
    logAction: () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    requireAuth: () => ({ valid: true, agent: { id: 'qa', role: 'auditor', tenantId: 'system' } }),
    checkClassification: () => ({ allowed: true, required: 'SUPPORT', classification: 'SUPPORT' }),
    checkRateLimit: jest.fn(),
    ...overrides,
  };
}

let server;
let baseUrl;
let deps;

beforeEach(async () => {
  deps = buildDeps();
  // jest.config.cjs usa resetMocks:true — implementações vão no beforeEach.
  deps.checkRateLimit.mockResolvedValue({ allowed: true, remainingPoints: 29, totalPoints: 30 });
  deps.authLogin.mockResolvedValue({ success: false, error: 'credenciais inválidas' });

  const app = express();
  app.use(createAuthRoutes(deps));
  ({ instance: server, url: baseUrl } = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => {
      resolve({ instance, url: `http://127.0.0.1:${instance.address().port}` });
    });
  }));
});

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
});

function postJson(pathname, payload) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('endpoints pré-auth — rate limit AUTH_PUBLIC por IP', () => {
  test('POST /auth/login com limite excedido → 429 + Retry-After, sem chamar authLogin', async () => {
    deps.checkRateLimit.mockResolvedValue({ allowed: false, retryAfter: 42 });

    const res = await postJson('/auth/login', { username: 'x', password: 'y' });
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error).toBe('rate_limit_exceeded');
    expect(res.headers.get('retry-after')).toBe('42');
    expect(deps.authLogin).not.toHaveBeenCalled();
    expect(deps.checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ operationType: 'AUTH_PUBLIC', userId: expect.stringMatching(/^ip:/) }),
    );
  });

  test('POST /auth/login dentro do limite → fluxo normal (credencial avaliada)', async () => {
    const res = await postJson('/auth/login', { username: 'x', password: 'y' });

    expect(res.status).toBe(401);
    expect(deps.authLogin).toHaveBeenCalledTimes(1);
  });

  test('POST /auth/signup com limite excedido → 429, sem criar conta/tenant', async () => {
    deps.checkRateLimit.mockResolvedValue({ allowed: false, retryAfter: 60 });

    const res = await postJson('/auth/signup', { username: 'x', password: 'y', email: 'x@y.z' });
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error).toBe('rate_limit_exceeded');
    expect(deps.createSaasSignupAccount).not.toHaveBeenCalled();
  });

  test('POST /auth/rpa/login com limite excedido → 429, sem forçar segredo RPA', async () => {
    deps.checkRateLimit.mockResolvedValue({ allowed: false, retryAfter: 60 });

    const res = await postJson('/auth/rpa/login', { token: 'x', tenantId: 'system' });
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error).toBe('rate_limit_exceeded');
    expect(deps.loginWithRpaToken).not.toHaveBeenCalled();
  });

  test('alias /api/auth/login também é limitado', async () => {
    deps.checkRateLimit.mockResolvedValue({ allowed: false, retryAfter: 60 });

    const res = await postJson('/api/auth/login', { username: 'x', password: 'y' });

    expect(res.status).toBe(429);
    expect(deps.authLogin).not.toHaveBeenCalled();
  });
});
