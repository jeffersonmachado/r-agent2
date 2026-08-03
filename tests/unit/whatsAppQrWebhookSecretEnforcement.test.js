'use strict';

/**
 * Regressão de segurança (auditoria 2026-08-03): POST /webhooks/whatsapp-qr/events
 * só verificava o segredo `if (secretExpected)` — sem WHATSAPP_QR_WEBHOOK_SECRET
 * configurado o endpoint ficava totalmente anônimo (ingestConnectionEvent altera
 * o estado de conexão de qualquer tenant). A comparação também não era timing-safe.
 *
 * Comportamento correto:
 * - secret configurado: header x-whatsapp-qr-secret ausente/errado → 401, sem efeito;
 *   header correto → 200 e processamento (comparação timing-safe);
 * - secret ausente + NODE_ENV=production → 503 webhook_misconfigured (fail-closed);
 * - secret ausente + fora de produção → fail-open com warn (não quebrar dev local).
 */

const express = require('express');

jest.mock('../../api/services/whatsappQrService', () => ({
  ingestConnectionEvent: jest.fn(),
}));

const whatsappQrService = require('../../api/services/whatsappQrService');
const { parseJsonBody } = require('../../api/express/httpHelpers');
const { createWhatsAppQrWebhookRoutes } = require('../../api/modules/whatsapp-qr-webhook/routes');

function buildDeps() {
  return () => ({
    hasJsonContentType: (req) => String(req.headers['content-type'] || '').includes('application/json'),
    parseJsonBody,
    sendJson: (res, status, payload) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    },
    badRequest: (res, message) => {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'bad_request', message }));
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    requireAuth: () => ({ valid: true }),
    requirePermission: () => ({ allowed: true }),
  });
}

let server;
let baseUrl;
let savedSecret;
let savedNodeEnv;

// jest.config.cjs usa resetMocks:true — implementação do mock em beforeEach.
beforeEach(async () => {
  savedSecret = process.env.WHATSAPP_QR_WEBHOOK_SECRET;
  savedNodeEnv = process.env.NODE_ENV;
  delete process.env.WHATSAPP_QR_WEBHOOK_SECRET;

  whatsappQrService.ingestConnectionEvent.mockResolvedValue({ ok: true, connection: { id: 'c1' } });

  const app = express();
  app.use(createWhatsAppQrWebhookRoutes({ buildDeps: buildDeps() }));
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;

  if (savedSecret === undefined) delete process.env.WHATSAPP_QR_WEBHOOK_SECRET;
  else process.env.WHATSAPP_QR_WEBHOOK_SECRET = savedSecret;
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

function postEvent(headers = {}) {
  return fetch(`${baseUrl}/webhooks/whatsapp-qr/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ tenantId: 'tenant-1', connectionId: 'c1', eventType: 'connected' }),
  });
}

describe('POST /webhooks/whatsapp-qr/events — enforcement de segredo', () => {
  test('sem secret configurado + produção → 503 webhook_misconfigured, SEM efeito', async () => {
    process.env.NODE_ENV = 'production';

    const res = await postEvent();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toBe('webhook_misconfigured');
    expect(whatsappQrService.ingestConnectionEvent).not.toHaveBeenCalled();
  });

  test('sem secret configurado + fora de produção → fail-open, processa', async () => {
    process.env.NODE_ENV = 'development';

    const res = await postEvent();

    expect(res.status).toBe(200);
    expect(whatsappQrService.ingestConnectionEvent).toHaveBeenCalledTimes(1);
  });

  test('com secret + header errado → 401, SEM efeito', async () => {
    process.env.WHATSAPP_QR_WEBHOOK_SECRET = 'segredo-qr';

    const res = await postEvent({ 'x-whatsapp-qr-secret': 'Segredo-QR-errado' });

    expect(res.status).toBe(401);
    expect(whatsappQrService.ingestConnectionEvent).not.toHaveBeenCalled();
  });

  test('com secret + header ausente → 401, SEM efeito', async () => {
    process.env.WHATSAPP_QR_WEBHOOK_SECRET = 'segredo-qr';

    const res = await postEvent();

    expect(res.status).toBe(401);
    expect(whatsappQrService.ingestConnectionEvent).not.toHaveBeenCalled();
  });

  test('com secret + header correto → 200 e processamento ocorre', async () => {
    process.env.WHATSAPP_QR_WEBHOOK_SECRET = 'segredo-qr';

    const res = await postEvent({ 'x-whatsapp-qr-secret': 'segredo-qr' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(whatsappQrService.ingestConnectionEvent).toHaveBeenCalledTimes(1);
  });
});
