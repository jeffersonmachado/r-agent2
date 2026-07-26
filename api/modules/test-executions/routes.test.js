'use strict';

/**
 * Regressão: /api/test-executions/* é superfície de replay/execuções de QA
 * (SUPPORT ou superior) mas era protegida apenas por requireAuth — qualquer
 * usuário operacional autenticado (PRODUCTION) podia listar/apagar replays
 * e acionar execuções. Política: replay/RPA exige SUPPORT (AGENTS.md).
 */

const express = require('express');
const http = require('http');
const { createTestExecutionsRoutes } = require('./routes');

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
    sendJson: (res, status, payload) => res.status(status).json(payload),
    logger: { error: jest.fn() },
    listRecordings: jest.fn(() => []),
    listReplays: jest.fn(() => ({ items: [], total: 0 })),
  };
  const app = express();
  app.use(express.json());
  app.use(createTestExecutionsRoutes({ buildDeps: () => deps }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

const SUPER_ADMIN = { id: 'a1', username: 'systemadmin', role: 'super_admin', tenantId: 'system' };
const AUDITOR = { id: 'a3', username: 'auditor', role: 'auditor', tenantId: 'tenant-x' };
const OPERATOR = { id: 'a2', username: 'operador', role: 'operator', tenantId: 'tenant-x' };

describe('test-executions routes — replay exige classificação SUPPORT', () => {
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

  test('usuário PRODUCTION (operator) recebe 403 em /api/test-executions/recordings', async () => {
    await start(OPERATOR);
    const res = await request(port, 'GET', '/api/test-executions/recordings');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'classification_required', required: 'SUPPORT' });
  });

  test('usuário PRODUCTION (operator) recebe 403 em /api/test-executions/replays', async () => {
    await start(OPERATOR);
    const res = await request(port, 'GET', '/api/test-executions/replays');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'classification_required', required: 'SUPPORT' });
  });

  test('auditor (SUPPORT) acessa recordings', async () => {
    await start(AUDITOR);
    const res = await request(port, 'GET', '/api/test-executions/recordings');
    expect(res.status).toBe(200);
  });

  test('super_admin (DEVELOPMENT) acessa recordings', async () => {
    await start(SUPER_ADMIN);
    const res = await request(port, 'GET', '/api/test-executions/recordings');
    expect(res.status).toBe(200);
  });
});
