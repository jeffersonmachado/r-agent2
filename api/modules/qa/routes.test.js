'use strict';

/**
 * Regressão: rotas /qa/* (resultados e execução de QA) são superfície de
 * engenharia (DEVELOPMENT) mas eram protegidas apenas por requireAuth —
 * qualquer usuário operacional autenticado podia ler resultados de QA e
 * disparar execuções. Política: QA exige DEVELOPMENT.
 */

const express = require('express');
const http = require('http');
const { createQaRoutes } = require('./routes');

function request(port, method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode || 0, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function buildServer(agent) {
  const deps = {
    requireAuth: jest.fn((req) => {
      req.agent = agent;
      return { valid: true, agent };
    }),
    requirePermission: jest.fn(() => ({ allowed: true })),
    sendJson: (res, status, payload) => res.status(status).json(payload),
    badRequest: (res, message) => res.status(400).json({ error: 'bad_request', message }),
    logger: { error: jest.fn() },
    getLatestQaResult: jest.fn(() => ({ id: 'qa-1', status: 'PASS' })),
    getQaHistory: jest.fn(() => []),
    getQaStatistics: jest.fn(() => ({ total: 0 })),
    getQaResultById: jest.fn(() => null),
  };
  const app = express();
  app.use(express.json());
  app.use(createQaRoutes({ buildDeps: () => deps }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

const SUPER_ADMIN = { id: 'a1', username: 'systemadmin', role: 'super_admin', tenantId: 'system' };
const AUDITOR = { id: 'a3', username: 'auditor', role: 'auditor', tenantId: 'tenant-x' };
const OPERATOR = { id: 'a2', username: 'operador', role: 'operator', tenantId: 'tenant-x' };

describe('qa routes — superfície de engenharia exige DEVELOPMENT', () => {
  let server;
  let port;

  afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
  });

  async function start(agent) {
    server = await buildServer(agent);
    port = server.address().port;
  }

  test('usuário PRODUCTION (operator) recebe 403 em /qa/latest', async () => {
    await start(OPERATOR);
    const res = await request(port, 'GET', '/qa/latest');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'classification_required', required: 'DEVELOPMENT' });
  });

  test('usuário PRODUCTION (operator) recebe 403 em /qa/history', async () => {
    await start(OPERATOR);
    const res = await request(port, 'GET', '/qa/history');
    expect(res.status).toBe(403);
  });

  test('auditor (SUPPORT) recebe 403 em /qa/latest (QA é DEVELOPMENT)', async () => {
    await start(AUDITOR);
    const res = await request(port, 'GET', '/qa/latest');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'classification_required', required: 'DEVELOPMENT' });
  });

  test('super_admin (DEVELOPMENT) acessa /qa/latest', async () => {
    await start(SUPER_ADMIN);
    const res = await request(port, 'GET', '/qa/latest');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'qa-1' });
  });

  test('/qa/operational-status não é sombreado por /qa/:id (cai no próximo router)', async () => {
    const deps = {
      requireAuth: jest.fn((req) => {
        req.agent = OPERATOR;
        return { valid: true, agent: OPERATOR };
      }),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: (res, status, payload) => res.status(status).json(payload),
      badRequest: (res, message) => res.status(400).json({ error: 'bad_request', message }),
      logger: { error: jest.fn() },
      getQaResultById: jest.fn(() => null),
    };
    const app = express();
    app.use(express.json());
    app.use(createQaRoutes({ buildDeps: () => deps }));
    // Simula o operationalStatusRouter montado depois do qaRouter (routeRegistry).
    app.use('/qa', (req, res) => res.status(200).json({ reached: 'operationalStatusRouter' }));
    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    port = server.address().port;
    const res = await request(port, 'GET', '/qa/operational-status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: 'operationalStatusRouter' });
  });
});
