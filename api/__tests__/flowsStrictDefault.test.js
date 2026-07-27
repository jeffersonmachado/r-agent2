const http = require('http');

/**
 * Regressão de segurança: /flows não pode ser acessível anonimamente por padrão.
 *
 * Falha observada (sondagem 2026-07-27): com STRICT_TENANT_MODE ausente e
 * NODE_ENV != production, GET /flows listava fluxos de TODOS os tenants sem
 * token e POST /flows criava fluxo anônimo em tenant arbitrário via body.
 * O modo legado (sem auth) precisa ser opt-in explícito
 * (STRICT_TENANT_MODE=false), nunca o default.
 */

function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers:
          payload != null
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed = null;
          if (data) {
            try { parsed = JSON.parse(data); } catch { parsed = data; }
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

function startServer(envOverrides) {
  return new Promise((resolve, reject) => {
    const saved = {
      NODE_ENV: process.env.NODE_ENV,
      STRICT_TENANT_MODE: process.env.STRICT_TENANT_MODE,
    };
    process.env.NODE_ENV = envOverrides.NODE_ENV || 'development';
    if (envOverrides.STRICT_TENANT_MODE === undefined) {
      delete process.env.STRICT_TENANT_MODE;
    } else {
      process.env.STRICT_TENANT_MODE = envOverrides.STRICT_TENANT_MODE;
    }
    jest.resetModules();
    // eslint-disable-next-line global-require
    const { createServer } = require('../server');
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port, saved });
    });
  });
}

function stopServer(server, saved) {
  return new Promise((resolve) => {
    if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.STRICT_TENANT_MODE === undefined) delete process.env.STRICT_TENANT_MODE;
    else process.env.STRICT_TENANT_MODE = saved.STRICT_TENANT_MODE;
    if (!server || !server.listening) return resolve();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => resolve());
  });
}

describe('/flows — modo estrito é o default (regressão de segurança)', () => {
  test('default (sem STRICT_TENANT_MODE): GET /flows anônimo retorna 401', async () => {
    const { server, port, saved } = await startServer({});
    try {
      const res = await request(port, 'GET', '/flows');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'unauthorized');
    } finally {
      await stopServer(server, saved);
    }
  });

  test('default (sem STRICT_TENANT_MODE): POST /flows anônimo retorna 401', async () => {
    const { server, port, saved } = await startServer({});
    try {
      const res = await request(port, 'POST', '/flows', {
        id: 'anon-flow-should-not-be-created',
        name: 'anon',
        tenantId: 'system',
        nodes: [{ id: 'start', type: 'start' }],
        edges: [],
      });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'unauthorized');
    } finally {
      await stopServer(server, saved);
    }
  });

  test('opt-in explícito (STRICT_TENANT_MODE=false): modo legado preservado', async () => {
    const { server, port, saved } = await startServer({ STRICT_TENANT_MODE: 'false' });
    try {
      const res = await request(port, 'GET', '/flows');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    } finally {
      await stopServer(server, saved);
    }
  });
});
