'use strict';

/**
 * Regressão: /qa/operational-status expõe estado interno de governança do
 * QA Mesh e permitia escrita de governança SEM autenticação alguma.
 * Superfície de engenharia: exige auth + classificação DEVELOPMENT.
 */

const express = require('express');
const http = require('http');
const createOperationalStatusRoutes = require('./operationalStatusRoutes');

function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: payload != null
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

function buildServer(agent) {
  const requireAuth = jest.fn((req) => {
    if (!agent) return { valid: false, error: 'Token de autenticação não fornecido' };
    req.agent = agent;
    return { valid: true, agent };
  });
  const { checkClassification } = require('../middleware/requireClassification');
  const app = express();
  app.use(express.json());
  app.use('/qa', createOperationalStatusRoutes({ requireAuth, checkClassification }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

const SUPER_ADMIN = { id: 'a1', username: 'systemadmin', role: 'super_admin', tenantId: 'system' };
const OPERATOR = { id: 'a2', username: 'operador', role: 'operator', tenantId: 'tenant-x' };

describe('operationalStatusRoutes — proteção de superfície DEVELOPMENT', () => {
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

  test('GET /qa/operational-status sem autenticação retorna 401', async () => {
    await start(null);
    const res = await request(port, 'GET', '/qa/operational-status');
    expect(res.status).toBe(401);
  });

  test('POST /qa/operational-status/update-governance sem autenticação retorna 401', async () => {
    await start(null);
    const res = await request(port, 'POST', '/qa/operational-status/update-governance', {
      governance: { decision: 'GO' },
      wave: 'wave-x',
    });
    expect(res.status).toBe(401);
  });

  test('POST /qa/operational-status/check-operation sem autenticação retorna 401', async () => {
    await start(null);
    const res = await request(port, 'POST', '/qa/operational-status/check-operation', {
      operationType: 'deploy',
    });
    expect(res.status).toBe(401);
  });

  test('usuário PRODUCTION (operator) recebe 403 classification_required', async () => {
    await start(OPERATOR);
    const res = await request(port, 'GET', '/qa/operational-status');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'classification_required', required: 'DEVELOPMENT' });
  });

  test('usuário PRODUCTION não pode injetar governança (403)', async () => {
    await start(OPERATOR);
    const res = await request(port, 'POST', '/qa/operational-status/update-governance', {
      governance: { decision: 'GO' },
      wave: 'wave-x',
    });
    expect(res.status).toBe(403);
  });

  test('super_admin (DEVELOPMENT) acessa GET /qa/operational-status', async () => {
    await start(SUPER_ADMIN);
    const res = await request(port, 'GET', '/qa/operational-status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('decision');
  });

  test('super_admin pode atualizar governança', async () => {
    await start(SUPER_ADMIN);
    const res = await request(port, 'POST', '/qa/operational-status/update-governance', {
      governance: { decision: 'GO' },
      wave: 'wave-x',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: true });
  });
});
