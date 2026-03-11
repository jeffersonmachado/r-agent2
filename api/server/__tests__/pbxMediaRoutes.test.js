'use strict';

const { handlePbxMediaRoutes } = require('../pbxMediaRoutes');

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

describe('pbxMediaRoutes', () => {
  test('retorna 400 em GET /api/pbx/audio-assets/file sem id', async () => {
    const res = createResponseMock();
    const handled = await handlePbxMediaRoutes({
      req: { url: '/api/pbx/audio-assets/file', headers: {} },
      res,
      method: 'GET',
      pathname: '/api/pbx/audio-assets/file',
      sendJson,
      badRequest: (response, message) => sendJson(response, 400, { error: 'bad_request', message }),
      parseJsonBody: jest.fn(),
      parseMultipartFormData: jest.fn(),
      requireAuth: () => ({ valid: true }),
      requirePermission: () => ({ allowed: true }),
      requireTenant: () => 'tenant-a',
      buildApiError: jest.fn(),
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'bad_request',
      message: 'id obrigatório',
    });
  });

  test('retorna 400 em POST /api/pbx/audio-assets/upload sem file', async () => {
    const res = createResponseMock();
    const handled = await handlePbxMediaRoutes({
      req: { url: '/api/pbx/audio-assets/upload', headers: {} },
      res,
      method: 'POST',
      pathname: '/api/pbx/audio-assets/upload',
      sendJson,
      badRequest: (response, message) => sendJson(response, 400, { error: 'bad_request', message }),
      parseJsonBody: jest.fn(),
      parseMultipartFormData: async () => ({ fields: {}, files: [] }),
      requireAuth: () => ({ valid: true }),
      requirePermission: () => ({ allowed: true }),
      requireTenant: () => 'tenant-a',
      buildApiError: jest.fn(),
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'bad_request',
      message: 'Arquivo obrigatório (field "file")',
    });
  });

  test('ignora rotas fora do escopo', async () => {
    const res = createResponseMock();
    const handled = await handlePbxMediaRoutes({
      req: { url: '/api/pbx/extensions', headers: {} },
      res,
      method: 'GET',
      pathname: '/api/pbx/extensions',
      sendJson,
      badRequest: jest.fn(),
      parseJsonBody: jest.fn(),
      parseMultipartFormData: jest.fn(),
      requireAuth: () => ({ valid: true }),
      requirePermission: () => ({ allowed: true }),
      requireTenant: () => 'tenant-a',
      buildApiError: jest.fn(),
    });

    expect(handled).toBe(false);
    expect(res.statusCode).toBeNull();
  });
});
