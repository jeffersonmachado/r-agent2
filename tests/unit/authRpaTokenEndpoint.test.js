'use strict';

/**
 * Regressão de segurança (falha observada em 2026-08-03): GET /auth/rpa/token
 * (e o alias /api/auth/rpa/token) retornava — e criava, se ausente — o token
 * RPA compartilhado SEM nenhuma autenticação. Qualquer chamador anônimo
 * obtinha o segredo e em seguida trocava por sessão via POST /auth/rpa/login,
 * anulando completamente a proteção do login RPA.
 *
 * Comportamento correto (RPA é mecanismo interno — classificação SUPPORT+):
 * - anônimo → 401 unauthorized, token NÃO é lido/criado;
 * - papel PRODUCTION (operacional) → 403 classification_required;
 * - classificação SUPPORT ou DEVELOPMENT → 200 com o token.
 */

const express = require('express');

jest.mock('../../core/rpa/utils/rpaTokenManager', () => ({
  getOrCreateRpaToken: jest.fn(),
}));

const rpaTokenManager = require('../../core/rpa/utils/rpaTokenManager');
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
    authLogin: async () => ({ success: false, error: 'não exercitado' }),
    createSaasSignupAccount: async () => { throw new Error('não exercitado'); },
    loginWithRpaToken: async () => { throw new Error('não exercitado'); },
    validateToken: () => ({ valid: false }),
    authLogout: () => {},
    logoutAllSessions: () => {},
    logAction: () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    requireAuth: () => ({ valid: true, agent: { id: 'qa', role: 'auditor', tenantId: 'system' } }),
    checkClassification: () => ({ allowed: true, required: 'SUPPORT', classification: 'SUPPORT' }),
    ...overrides,
  };
}

let server;
let baseUrl;

// jest.config.cjs usa resetMocks:true — a implementação do mock é redefinida
// antes de cada teste (a factory não pode depender de implementação própria).
beforeEach(() => {
  rpaTokenManager.getOrCreateRpaToken.mockReturnValue('rpa-token-de-teste');
});

function startApp(deps) {
  const app = express();
  app.use(createAuthRoutes(deps));
  return new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => {
      resolve({ instance, url: `http://127.0.0.1:${instance.address().port}` });
    });
  });
}

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
});

describe('GET /auth/rpa/token — emissão de token RPA exige classificação SUPPORT+', () => {
  test('anônimo recebe 401 e o token RPA não é lido nem criado', async () => {
    ({ instance: server, url: baseUrl } = await startApp(buildDeps({
      requireAuth: () => ({ valid: false, error: 'Token de autenticação não fornecido' }),
    })));

    const res = await fetch(`${baseUrl}/auth/rpa/token`);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('unauthorized');
    expect(body.token).toBeUndefined();
    expect(rpaTokenManager.getOrCreateRpaToken).not.toHaveBeenCalled();
  });

  test('papel PRODUCTION autenticado recebe 403 classification_required', async () => {
    ({ instance: server, url: baseUrl } = await startApp(buildDeps({
      checkClassification: () => ({ allowed: false, required: 'SUPPORT', classification: 'PRODUCTION' }),
    })));

    const res = await fetch(`${baseUrl}/api/auth/rpa/token`, {
      headers: { authorization: 'Bearer token-operacional' },
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('classification_required');
    expect(body.required).toBe('SUPPORT');
    expect(rpaTokenManager.getOrCreateRpaToken).not.toHaveBeenCalled();
  });

  test('classificação SUPPORT/DEVELOPMENT autenticada recebe 200 com o token', async () => {
    ({ instance: server, url: baseUrl } = await startApp(buildDeps()));

    const res = await fetch(`${baseUrl}/auth/rpa/token`, {
      headers: { authorization: 'Bearer token-suporte' },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.token).toBe('rpa-token-de-teste');
    expect(rpaTokenManager.getOrCreateRpaToken).toHaveBeenCalledTimes(1);
  });
});
