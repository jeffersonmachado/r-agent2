'use strict';

const { handlePublicMediaRoutes } = require('../publicMediaRoutes');

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

function createSendJson(res) {
  return (response, status, body) => {
    const target = response || res;
    target.writeHead(status, { 'Content-Type': 'application/json' });
    target.end(JSON.stringify(body));
  };
}

describe('publicMediaRoutes', () => {
  test('ignora rotas fora do escopo público de mídia', async () => {
    const res = createResponseMock();
    const handled = await handlePublicMediaRoutes({
      req: { url: '/health' },
      res,
      method: 'GET',
      pathname: '/health',
      sendJson: createSendJson(res),
      badRequest: (response, message) => createSendJson(response)(response, 400, { error: 'bad_request', message }),
    });

    expect(handled).toBe(false);
    expect(res.statusCode).toBeNull();
  });

  test('retorna 404 para caminho inválido em /public/support-media', async () => {
    const res = createResponseMock();
    const handled = await handlePublicMediaRoutes({
      req: { url: '/public/support-media/invalido' },
      res,
      method: 'GET',
      pathname: '/public/support-media/invalido',
      sendJson: createSendJson(res),
      badRequest: (response, message) => createSendJson(response)(response, 400, { error: 'bad_request', message }),
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'not_found' });
  });

  test('retorna 400 quando /public/whatsapp-media é chamado sem url', async () => {
    const res = createResponseMock();
    const sendJson = createSendJson(res);
    const handled = await handlePublicMediaRoutes({
      req: { url: '/public/whatsapp-media' },
      res,
      method: 'GET',
      pathname: '/public/whatsapp-media',
      sendJson,
      badRequest: (response, message) => sendJson(response, 400, { error: 'bad_request', message }),
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'bad_request',
      message: 'Parâmetro "url" é obrigatório',
    });
  });
});
