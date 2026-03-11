'use strict';

const { handleSystemRoutes } = require('../systemRoutes');

function createResponseMock() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(body) {
      this.body = body;
    },
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

describe('systemRoutes', () => {
  test('despacha /server/process-manager', async () => {
    const res = createResponseMock();
    const handled = await handleSystemRoutes({
      req: { headers: {} },
      res,
      method: 'GET',
      pathname: '/server/process-manager',
      sendJson,
      requireAuth: () => ({ valid: false }),
      detectProcessManager: () => ({ name: 'PM2', hasProcessManager: true, details: { method: 'test' } }),
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      success: true,
      processManager: 'PM2',
      hasProcessManager: true,
      details: { method: 'test' },
    });
  });

  test('ignora rotas fora do escopo', async () => {
    const res = createResponseMock();
    const handled = await handleSystemRoutes({
      req: { headers: {} },
      res,
      method: 'GET',
      pathname: '/health',
      sendJson,
      requireAuth: () => ({ valid: false }),
      detectProcessManager: () => ({ name: 'none', hasProcessManager: false, details: {} }),
    });

    expect(handled).toBe(false);
    expect(res.statusCode).toBeNull();
  });
});
