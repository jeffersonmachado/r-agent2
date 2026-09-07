'use strict';

const http = require('http');
const express = require('express');

const mockGetSummary = jest.fn();

const { createProductMetricsRoutes } = require('../../api/modules/product-metrics/routes');

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function get(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body || '{}') }));
    }).on('error', reject);
  });
}

function buildApp({ authValid = true, permissionAllowed = true } = {}) {
  const app = express();
  app.use(createProductMetricsRoutes({
    buildDeps: () => ({
      requireAuth: () => (authValid ? { valid: true } : { valid: false, error: 'token inválido' }),
      requirePermission: (_req, resource, action) => ({
        allowed: permissionAllowed && resource === 'reports' && action === 'read',
        error: 'sem permissão',
      }),
      requireTenant: () => 'tenant-pm',
      sendJson: (res, status, payload) => res.status(status).json(payload),
      logger: { error: jest.fn(), warn: jest.fn() },
      productMetricsService: { getProductMetricsSummary: (...args) => mockGetSummary(...args) },
    }),
  }));
  return app;
}

describe('product-metrics routes', () => {
  let server;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSummary.mockResolvedValue({ ok: true, tenantId: 'tenant-pm', windowDays: 30 });
  });

  afterEach(() => {
    if (server) server.close();
    server = null;
  });

  test('GET /api/product-metrics/summary retorna o sumário do tenant autenticado', async () => {
    server = await listen(buildApp());
    const res = await get(server, '/api/product-metrics/summary?windowDays=7');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockGetSummary).toHaveBeenCalledWith({ tenantId: 'tenant-pm', windowDays: 7 });
  });

  test('sem autenticação: 401', async () => {
    server = await listen(buildApp({ authValid: false }));
    const res = await get(server, '/api/product-metrics/summary');

    expect(res.status).toBe(401);
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  test('sem permissão reports:read: 403', async () => {
    server = await listen(buildApp({ permissionAllowed: false }));
    const res = await get(server, '/api/product-metrics/summary');

    expect(res.status).toBe(403);
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  test('windowDays padrão é 30 quando ausente', async () => {
    server = await listen(buildApp());
    await get(server, '/api/product-metrics/summary');

    expect(mockGetSummary).toHaveBeenCalledWith({ tenantId: 'tenant-pm', windowDays: 30 });
  });

  test('falha do serviço: 500 sem vazar stack', async () => {
    mockGetSummary.mockRejectedValue(new Error('db down'));
    server = await listen(buildApp());
    const res = await get(server, '/api/product-metrics/summary');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
  });
});
