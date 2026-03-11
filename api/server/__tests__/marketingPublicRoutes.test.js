'use strict';

const { handleMarketingPublicRoutes } = require('../marketingPublicRoutes');

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

describe('marketingPublicRoutes', () => {
  test('retorna 400 em /mkt/e sem content-type json', async () => {
    const res = createResponseMock();
    const handled = await handleMarketingPublicRoutes({
      req: { headers: {}, url: '/mkt/e', socket: { remoteAddress: '127.0.0.1' } },
      res,
      method: 'POST',
      pathname: '/mkt/e',
      sendJson,
      setCorsHeaders: jest.fn(),
      badRequest: (response, message) => sendJson(response, 400, { error: 'bad_request', message }),
      hasJsonContentType: () => false,
      parseJsonBody: jest.fn(),
      checkRateLimit: jest.fn(),
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'bad_request',
      message: 'Content-Type deve ser application/json',
    });
  });

  test('retorna 400 em /mkt/click sem code', async () => {
    const res = createResponseMock();
    const handled = await handleMarketingPublicRoutes({
      req: { headers: {}, url: '/mkt/click', socket: { remoteAddress: '127.0.0.1' } },
      res,
      method: 'GET',
      pathname: '/mkt/click',
      sendJson,
      setCorsHeaders: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: () => true,
      parseJsonBody: jest.fn(),
      checkRateLimit: jest.fn(),
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'bad_request',
      message: 'code é obrigatório',
    });
  });

  test('ignora rotas fora do escopo', async () => {
    const res = createResponseMock();
    const handled = await handleMarketingPublicRoutes({
      req: { headers: {}, url: '/health', socket: { remoteAddress: '127.0.0.1' } },
      res,
      method: 'GET',
      pathname: '/health',
      sendJson,
      setCorsHeaders: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: () => true,
      parseJsonBody: jest.fn(),
      checkRateLimit: jest.fn(),
    });

    expect(handled).toBe(false);
    expect(res.statusCode).toBeNull();
  });
});
