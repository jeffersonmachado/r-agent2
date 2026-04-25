'use strict';

const express = require('express');
const http = require('http');
const { createQaWavesRoutes } = require('./routes');

function request(port, method, path, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);

    const headers = {
      ...(payload != null
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          }
        : {}),
      ...(extraHeaders || {}),
    };

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          if (data) {
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }
          }
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

function createDefaultDeps() {
  return {
    requireAuth: jest.fn(() => ({ valid: true })),
    requirePermission: jest.fn(() => ({ allowed: true })),
    sendJson: (res, status, payload) => res.status(status).json(payload),
    badRequest: (res, message) => res.status(400).json({ error: 'bad_request', message }),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({})),
    logger: { error: jest.fn() },
    listWaves: jest.fn(() => []),
    listJourneys: jest.fn(() => ({ domains: [{ id: 'fitness', name: 'Fitness', journeys: [] }] })),
    listJourneyStatus: jest.fn(() => ({ items: [{ journeyId: 'fitness_new_customer', status: 'GO' }] })),
    listStepStatus: jest.fn(() => ({ items: [{ stepId: 'step_01_discovery', status: 'GO' }] })),
    listReplays: jest.fn(() => ({ items: [], page: 1, pageSize: 10, total: 0 })),
    getReplayById: jest.fn(() => null),
    queueWaveExecution: jest.fn(() => ({ executionId: 'exec-1' })),
    reexecuteReplay: jest.fn(() => ({ executionId: 'replay-1' })),
  };
}

describe('qa-waves routes', () => {
  let server;
  let port;
  let deps;

  async function startWithDeps(customize) {
    deps = createDefaultDeps();
    if (typeof customize === 'function') customize(deps);

    const app = express();
    app.use(createQaWavesRoutes({ buildDeps: () => deps }));

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        port = typeof address === 'object' && address ? address.port : 0;
        resolve();
      });
    });
  }

  async function stopServer() {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
    server = null;
    port = 0;
  }

  afterEach(async () => {
    await stopServer();
  });

  test('GET /api/qa-waves/journeys deve retornar 401 sem autenticacao', async () => {
    await startWithDeps((d) => {
      d.requireAuth.mockReturnValue({ valid: false, error: 'token_missing' });
    });

    const res = await request(port, 'GET', '/api/qa-waves/journeys');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized', message: 'token_missing' });
  });

  test('GET /api/qa-waves/journeys deve retornar payload de jornadas', async () => {
    await startWithDeps();

    const res = await request(port, 'GET', '/api/qa-waves/journeys');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('domains');
    expect(deps.listJourneys).toHaveBeenCalledTimes(1);
  });

  test('GET /api/qa-waves/journey-status deve retornar status agregado', async () => {
    await startWithDeps();

    const res = await request(port, 'GET', '/api/qa-waves/journey-status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ journeyId: 'fitness_new_customer', status: 'GO' }] });
    expect(deps.listJourneyStatus).toHaveBeenCalledTimes(1);
  });

  test('GET /api/qa-waves/step-status deve encaminhar filtro de journeyId', async () => {
    await startWithDeps();

    const res = await request(port, 'GET', '/api/qa-waves/step-status?journeyId=fitness_new_customer');

    expect(res.status).toBe(200);
    expect(deps.listStepStatus).toHaveBeenCalledWith(
      expect.objectContaining({ journeyId: 'fitness_new_customer' })
    );
  });

  test('GET /api/qa-waves/journey-status deve retornar 500 quando houver excecao', async () => {
    await startWithDeps((d) => {
      d.listJourneyStatus.mockImplementation(() => {
        throw new Error('boom');
      });
    });

    const res = await request(port, 'GET', '/api/qa-waves/journey-status');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal_error', message: 'Erro ao listar status de jornada' });
    expect(deps.logger.error).toHaveBeenCalled();
  });
});
