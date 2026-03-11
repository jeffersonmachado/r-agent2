'use strict';

const { handleProvisioningPublicRoutes } = require('../provisioningPublicRoutes');

function createResponseMock() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
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

describe('provisioningPublicRoutes', () => {
  test('retorna 404 para rota /provision inválida', async () => {
    const res = createResponseMock();
    const handled = await handleProvisioningPublicRoutes({
      req: { headers: {}, socket: { remoteAddress: '127.0.0.1' } },
      res,
      method: 'GET',
      pathname: '/provision/tenant',
      sendJson,
      setCorsHeaders: jest.fn(),
      logAction: jest.fn(),
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'not_found' });
  });

  test('ignora rotas fora do escopo', async () => {
    const res = createResponseMock();
    const handled = await handleProvisioningPublicRoutes({
      req: { headers: {}, socket: { remoteAddress: '127.0.0.1' } },
      res,
      method: 'GET',
      pathname: '/health',
      sendJson,
      setCorsHeaders: jest.fn(),
      logAction: jest.fn(),
    });

    expect(handled).toBe(false);
    expect(res.statusCode).toBeNull();
  });
});
