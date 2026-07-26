'use strict';

/**
 * Regressão: /api/ops/* expõe observabilidade interna (event-ledger,
 * execution-jobs, billing, notificações) protegida apenas por
 * requirePermission('analytics','read') — papel operacional com permissão
 * de analytics podia acessar métricas internas de engenharia e disparar
 * retries/reprocessamentos. Ferramentas internas de observabilidade são
 * DEVELOPMENT na política de segregação.
 */

const express = require('express');
const http = require('http');
const { createOpsRoutes } = require('./routes');

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
    logger: { error: jest.fn() },
  };
  const app = express();
  app.use(express.json());
  app.use(createOpsRoutes({ buildDeps: () => deps }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

const SUPER_ADMIN = { id: 'a1', username: 'systemadmin', role: 'super_admin', tenantId: 'system' };
const OPERATOR = { id: 'a2', username: 'operador', role: 'operator', tenantId: 'tenant-x' };

describe('ops routes — observabilidade interna exige DEVELOPMENT', () => {
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

  test('usuário PRODUCTION com permissão de analytics recebe 403 em /api/ops/event-ledger/metrics', async () => {
    await start(OPERATOR);
    const res = await request(port, 'GET', '/api/ops/event-ledger/metrics');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'classification_required', required: 'DEVELOPMENT' });
  });

  test('usuário PRODUCTION recebe 403 em /api/ops/billing/health', async () => {
    await start(OPERATOR);
    const res = await request(port, 'GET', '/api/ops/billing/health');
    expect(res.status).toBe(403);
  });

  test('super_admin (DEVELOPMENT) não é bloqueado pela classificação', async () => {
    await start(SUPER_ADMIN);
    const res = await request(port, 'GET', '/api/ops/event-ledger/metrics');
    // Pode falhar no serviço (503) em ambiente de teste, mas nunca por authz.
    expect([401, 403]).not.toContain(res.status);
  });
});
