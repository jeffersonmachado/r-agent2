'use strict';

const { handlePbxCoreRoutes } = require('../pbxCoreRoutes');

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

describe('pbxCoreRoutes', () => {
  test('retorna 400 em POST /api/pbx/extensions sem json', async () => {
    const res = createResponseMock();
    const handled = await handlePbxCoreRoutes({
      req: { url: '/api/pbx/extensions', headers: {} },
      res,
      url: new URL('http://localhost/api/pbx/extensions'),
      method: 'POST',
      pathname: '/api/pbx/extensions',
      sendJson,
      badRequest: (response, message) => sendJson(response, 400, { error: 'bad_request', message }),
      hasJsonContentType: () => false,
      parseJsonBody: jest.fn(),
      requireAuth: () => ({ valid: true }),
      requirePermission: () => ({ allowed: true }),
      requireTenant: () => 'tenant-a',
      buildApiError: jest.fn(),
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'bad_request',
      message: 'Content-Type deve ser application/json',
    });
  });

  test('retorna 400 em GET /api/pbx/queue-members sem queueId', async () => {
    const res = createResponseMock();
    const handled = await handlePbxCoreRoutes({
      req: { url: '/api/pbx/queue-members', headers: {} },
      res,
      url: new URL('http://localhost/api/pbx/queue-members'),
      method: 'GET',
      pathname: '/api/pbx/queue-members',
      sendJson,
      badRequest: jest.fn(),
      hasJsonContentType: () => true,
      parseJsonBody: jest.fn(),
      requireAuth: () => ({ valid: true }),
      requirePermission: () => ({ allowed: true }),
      requireTenant: () => 'tenant-a',
      buildApiError: jest.fn(),
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'bad_request',
      message: 'queueId obrigatório',
    });
  });

  test('ignora rotas fora do escopo', async () => {
    const res = createResponseMock();
    const handled = await handlePbxCoreRoutes({
      req: { url: '/api/pbx/audio-assets', headers: {} },
      res,
      url: new URL('http://localhost/api/pbx/audio-assets'),
      method: 'GET',
      pathname: '/api/pbx/audio-assets',
      sendJson,
      badRequest: jest.fn(),
      hasJsonContentType: () => true,
      parseJsonBody: jest.fn(),
      requireAuth: () => ({ valid: true }),
      requirePermission: () => ({ allowed: true }),
      requireTenant: () => 'tenant-a',
      buildApiError: jest.fn(),
    });

    expect(handled).toBe(false);
    expect(res.statusCode).toBeNull();
  });
});
