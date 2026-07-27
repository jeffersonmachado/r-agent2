'use strict';

/**
 * Regressão: POST /instagram/send e POST /messenger/send não podem retornar
 * 500 genérico quando a conta do canal não está configurada.
 *
 * Falha observada (sondagem 2026-07-27): tenant sem Page Access Token/Page ID
 * recebia HTTP 500 { error: 'send_failed' }. Erro de configuração de canal é
 * condição operacional esperada e deve ser 503 channel_not_configured; falha
 * da API externa deve ser 502, nunca 500.
 */

const {
  handleInstagramWebhookRoutes,
} = require('../../api/modules/channel-webhook/handleInstagramWebhookRoutes');
const {
  handleMessengerWebhookRoutes,
} = require('../../api/modules/channel-webhook/handleMessengerWebhookRoutes');

function makeRes() {
  return {
    statusCode: null,
    body: null,
    writableEnded: false,
    writeHead(status) {
      this.statusCode = status;
    },
    end(payload) {
      this.body = payload;
      this.writableEnded = true;
    },
  };
}

function makeReq(body) {
  const payload = JSON.stringify(body || {});
  const stream = require('stream');
  const req = new stream.Readable({
    read() {
      this.push(payload);
      this.push(null);
    },
  });
  req.headers = { 'content-type': 'application/json' };
  req.method = 'POST';
  req.url = '/instagram/send';
  req.originalUrl = '/instagram/send';
  return req;
}

function baseDeps(overrides) {
  return {
    requireAuth: () => ({ valid: true, agent: { id: 'qa-agent' } }),
    sendJson: (res, status, payload) => {
      res.statusCode = status;
      res.body = payload;
      res.writableEnded = true;
    },
    badRequest: (res, message) => {
      res.statusCode = 400;
      res.body = { error: 'bad_request', message };
      res.writableEnded = true;
    },
    hasJsonContentType: () => true,
    parseJsonBody: async (req) => {
      let data = '';
      for await (const chunk of req) data += chunk;
      return JSON.parse(data || '{}');
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
}

describe('POST /instagram/send — mapeamento de erros de envio', () => {
  test('canal não configurado retorna 503 channel_not_configured', async () => {
    const deps = baseDeps({
      sendInstagramMessage: async () => ({
        success: false,
        code: 'channel_not_configured',
        error: 'Page Access Token do Instagram não configurado',
      }),
    });
    const res = makeRes();
    const handled = await handleInstagramWebhookRoutes({
      req: makeReq({ recipientId: 'user-1', text: 'oi' }),
      res,
      method: 'POST',
      pathname: '/instagram/send',
      deps,
    });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(503);
    expect(res.body).toHaveProperty('error', 'channel_not_configured');
  });

  test('falha da API externa retorna 502 send_failed', async () => {
    const deps = baseDeps({
      sendInstagramMessage: async () => ({
        success: false,
        error: 'Instagram API error: 500',
      }),
    });
    const res = makeRes();
    await handleInstagramWebhookRoutes({
      req: makeReq({ recipientId: 'user-1', text: 'oi' }),
      res,
      method: 'POST',
      pathname: '/instagram/send',
      deps,
    });
    expect(res.statusCode).toBe(502);
    expect(res.body).toHaveProperty('error', 'send_failed');
  });
});

describe('POST /messenger/send — mapeamento de erros de envio', () => {
  test('canal não configurado retorna 503 channel_not_configured', async () => {
    const deps = baseDeps({
      sendMessengerMessage: async () => ({
        success: false,
        code: 'channel_not_configured',
        error: 'Page Access Token do Messenger não configurado',
      }),
    });
    const res = makeRes();
    const req = makeReq({ recipientId: 'user-1', text: 'oi' });
    req.url = '/messenger/send';
    req.originalUrl = '/messenger/send';
    const handled = await handleMessengerWebhookRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/messenger/send',
      deps,
    });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(503);
    expect(res.body).toHaveProperty('error', 'channel_not_configured');
  });

  test('falha da API externa retorna 502 send_failed', async () => {
    const deps = baseDeps({
      sendMessengerMessage: async () => ({
        success: false,
        error: 'Messenger API error: 500',
      }),
    });
    const res = makeRes();
    const req = makeReq({ recipientId: 'user-1', text: 'oi' });
    req.url = '/messenger/send';
    req.originalUrl = '/messenger/send';
    await handleMessengerWebhookRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/messenger/send',
      deps,
    });
    expect(res.statusCode).toBe(502);
    expect(res.body).toHaveProperty('error', 'send_failed');
  });
});
