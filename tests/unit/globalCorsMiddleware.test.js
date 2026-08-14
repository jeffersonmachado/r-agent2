'use strict';

const express = require('express');
const { applyGlobalMiddlewares } = require('../../api/app/applyMiddlewares');

describe('global CORS middleware', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const app = express();
    applyGlobalMiddlewares(app, { ensureRequestTracing: jest.fn() });
    app.get('/tenant-protected-shape', (_req, res) => {
      res.status(403).json({ error: 'tenant_validation_failed' });
    });

    await new Promise(resolve => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  test('answers preflight before protected routes', async () => {
    const response = await fetch(`${baseUrl}/tenant-protected-shape`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:15173',
        'Access-Control-Request-Method': 'GET',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('PATCH');
  });

  test('adds CORS headers to ordinary error responses', async () => {
    const response = await fetch(`${baseUrl}/tenant-protected-shape`, {
      headers: { Origin: 'http://localhost:15173' },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});
