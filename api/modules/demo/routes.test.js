'use strict';

const express = require('express');
const http = require('http');
const { createDemoRoutes } = require('./routes');

function request(port, method, path, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {
      ...(payload
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
    if (payload) req.write(payload);
    req.end();
  });
}

function createDefaultDeps() {
  return {
    requireAuth: jest.fn(() => ({ valid: true, agent: { id: 'agent-1', tenantId: 'system' } })),
    sendJson: (res, status, payload) => res.status(status).json(payload),
    badRequest: (res, message) => res.status(400).json({ error: 'bad_request', message }),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({})),
    logger: {
      error: jest.fn(),
    },
    demoOrchestrator: {
      getState: jest.fn(async ({ vertical }) => ({
        demo: { flag: true, vertical },
        indicators: { qaHealth: 'GO' },
      })),
      runDemo: jest.fn(async ({ vertical }) => ({
        status: 'queued',
        vertical,
        execution: { executionId: 'meshq-demo-1' },
      })),
    },
  };
}

describe('demo routes', () => {
  let deps;
  let server;
  let port;

  async function start(customize) {
    deps = createDefaultDeps();
    if (typeof customize === 'function') customize(deps);

    const app = express();
    app.use(createDemoRoutes({ buildDeps: () => deps }));

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        port = typeof address === 'object' && address ? address.port : 0;
        resolve();
      });
    });
  }

  async function stop() {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
    server = null;
    port = 0;
  }

  afterEach(async () => {
    await stop();
  });

  test('GET /api/demo/state should return 401 when auth fails', async () => {
    await start((d) => {
      d.requireAuth.mockReturnValue({ valid: false, error: 'token_missing' });
    });

    const response = await request(port, 'GET', '/api/demo/state?vertical=fitness');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized', message: 'token_missing' });
  });

  test('GET /api/demo/state should load state for requested vertical', async () => {
    await start();

    const response = await request(port, 'GET', '/api/demo/state?vertical=beauty');

    expect(response.status).toBe(200);
    expect(deps.demoOrchestrator.getState).toHaveBeenCalledWith(
      expect.objectContaining({ vertical: 'beauty', tenantId: 'system' })
    );
    expect(response.body).toHaveProperty('demo.vertical', 'beauty');
  });

  test('POST /api/demo/run should enqueue demo execution', async () => {
    await start();

    const response = await request(port, 'POST', '/api/demo/run', { vertical: 'fitness' });

    expect(response.status).toBe(202);
    expect(deps.demoOrchestrator.runDemo).toHaveBeenCalledWith(
      expect.objectContaining({ vertical: 'fitness', tenantId: 'system' })
    );
    expect(response.body).toHaveProperty('status', 'queued');
    expect(response.body).toHaveProperty('execution.executionId', 'meshq-demo-1');
  });
});
