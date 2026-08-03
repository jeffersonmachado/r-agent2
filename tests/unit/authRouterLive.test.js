'use strict';

/**
 * Cobertura comportamental do router VIVO de auth (api/modules/auth/routes.js
 * via composition/auth). Substitui tests/unit/authRoutes.test.js, que exercia
 * apenas o handler legado desmontado (api/modules/auth/handleAuthRoutes.js —
 * código morto removido em 2026-08-03). Mesmos comportamentos, mesmo harness
 * express+listen+fetch de tests/unit/authRpaTokenEndpoint.test.js.
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
    schemas: { login: {}, signupSaas: {} },
    ValidationError: class ValidationError extends Error {},
    authLogin: jest.fn(),
    createSaasSignupAccount: jest.fn(),
    loginWithRpaToken: jest.fn(),
    validateToken: jest.fn(),
    authLogout: jest.fn(),
    logoutAllSessions: jest.fn(),
    logAction: jest.fn(),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    requireAuth: jest.fn(),
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
  deps.requireAuth.mockReturnValue({ valid: true, agent: { id: 'a1', role: 'admin', tenantId: 't1' } });
  deps.validateToken.mockReturnValue({ valid: false, error: 'token inválido' });

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

describe('router vivo de auth — login', () => {
  test('POST /auth/login retorna 401 para credenciais inválidas', async () => {
    deps.authLogin.mockResolvedValue({ success: false, error: 'Credenciais inválidas' });
    const res = await postJson('/auth/login', { username: 'x', password: 'y' });
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error).toBe('authentication_failed');
  });

  test('POST /auth/login retorna token e agent no sucesso', async () => {
    deps.authLogin.mockResolvedValue({
      success: true,
      token: 'tok-123',
      agent: { id: 'a1', username: 'alice', tenantId: 't1' },
    });
    const res = await postJson('/auth/login', { username: 'alice', password: 'secret' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.token).toBe('tok-123');
    expect(body.agent.username).toBe('alice');
    expect(deps.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'login' }));
  });

  test('POST /auth/login retorna badRequest para ValidationError', async () => {
    class ValidationError extends Error {}
    const app = express();
    const localDeps = buildDeps({
      ValidationError,
      validateInput: () => { throw new ValidationError('username é obrigatório'); },
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
    });
    app.use(createAuthRoutes(localDeps));
    const local = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    try {
      const res = await fetch(`http://127.0.0.1:${local.address().port}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.message).toContain('username');
    } finally {
      await new Promise((resolve) => local.close(resolve));
    }
  });
});

describe('router vivo de auth — rpa/login', () => {
  test('POST /auth/rpa/login exige rpaToken', async () => {
    const res = await postJson('/auth/rpa/login', { tenantId: 'system' });
    expect(res.status).toBe(400);
    expect(deps.loginWithRpaToken).not.toHaveBeenCalled();
  });

  test('POST /auth/rpa/login exige tenantId', async () => {
    const res = await postJson('/auth/rpa/login', { token: 'x' });
    expect(res.status).toBe(400);
    expect(deps.loginWithRpaToken).not.toHaveBeenCalled();
  });

  test('POST /auth/rpa/login retorna 401 para token inválido', async () => {
    deps.loginWithRpaToken.mockResolvedValue({ success: false, error: 'Token RPA inválido' });
    const res = await postJson('/auth/rpa/login', { token: 'errado', tenantId: 'system' });
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error).toBe('rpa_authentication_failed');
  });

  test('POST /auth/rpa/login autentica com sucesso', async () => {
    deps.loginWithRpaToken.mockResolvedValue({
      success: true,
      token: 'sessao-rpa',
      agent: { id: 'rpa1', username: 'rpa_bot', tenantId: 'system' },
    });
    const res = await postJson('/auth/rpa/login', { token: 'segredo', tenantId: 'system' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.token).toBe('sessao-rpa');
    expect(deps.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'rpa_login' }));
  });
});

describe('router vivo de auth — logout', () => {
  test('POST /auth/logout retorna 401 sem token', async () => {
    const res = await postJson('/auth/logout', {});
    expect(res.status).toBe(401);
    expect(deps.authLogout).not.toHaveBeenCalled();
  });

  test('POST /auth/logout encerra sessão com token inválido (idempotente)', async () => {
    const res = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer token-qualquer' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(deps.authLogout).toHaveBeenCalledWith('token-qualquer');
  });

  test('POST /auth/logout-all retorna 401 sem token', async () => {
    const res = await postJson('/auth/logout-all', {});
    expect(res.status).toBe(401);
    expect(deps.logoutAllSessions).not.toHaveBeenCalled();
  });

  test('POST /auth/logout-all retorna 401 para token inválido', async () => {
    deps.validateToken.mockReturnValue({ valid: false, error: 'expirado' });
    const res = await fetch(`${baseUrl}/auth/logout-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer token-expirado' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    expect(deps.logoutAllSessions).not.toHaveBeenCalled();
  });

  test('POST /auth/logout-all encerra todas as sessões do dono do token', async () => {
    deps.validateToken.mockReturnValue({ valid: true, agent: { id: 'a1', username: 'alice' } });
    const res = await fetch(`${baseUrl}/auth/logout-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer token-valido' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(deps.logoutAllSessions).toHaveBeenCalledWith('a1');
  });
});

describe('router vivo de auth — me', () => {
  test('GET /auth/me retorna 401 sem token', async () => {
    const res = await fetch(`${baseUrl}/auth/me`);
    expect(res.status).toBe(401);
  });

  test('GET /auth/me retorna 401 para token inválido', async () => {
    deps.validateToken.mockReturnValue({ valid: false, error: 'inválido' });
    const res = await fetch(`${baseUrl}/auth/me`, { headers: { authorization: 'Bearer x' } });
    expect(res.status).toBe(401);
  });

  test('GET /auth/me retorna agent autenticado', async () => {
    deps.validateToken.mockReturnValue({
      valid: true,
      agent: { id: 'a1', username: 'alice', tenantId: 't1', role: 'admin' },
      session: { id: 's1' },
    });
    const res = await fetch(`${baseUrl}/auth/me`, { headers: { authorization: 'Bearer token-ok' } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.agent.username).toBe('alice');
  });
});
