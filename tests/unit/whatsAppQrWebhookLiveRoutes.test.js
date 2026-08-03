'use strict';

/**
 * Cobertura comportamental do router VIVO de whatsapp-qr
 * (api/modules/whatsapp-qr-webhook/routes.js via composition/whatsapp-qr-webhook).
 * Substitui tests/unit/whatsAppQrWebhookRoutes.test.js, que exercia apenas o
 * handler legado desmontado (handleWhatsAppQrWebhookRoutes.js — código morto
 * removido em 2026-08-03). Os cenários de segredo (timing-safe, fail-closed
 * em produção) estão em tests/unit/whatsAppQrWebhookSecretEnforcement.test.js.
 */

const express = require('express');

jest.mock('../../api/services/whatsappQrService', () => ({
  ingestConnectionEvent: jest.fn(),
}));
jest.mock('../../api/services/whatsappQrBridgeService', () => ({
  getWhatsAppQrBridgeStats: jest.fn(),
}));

const whatsappQrService = require('../../api/services/whatsappQrService');
const { getWhatsAppQrBridgeStats } = require('../../api/services/whatsappQrBridgeService');
const { createWhatsAppQrWebhookRoutes } = require('../../api/modules/whatsapp-qr-webhook/routes');

let server;
let baseUrl;
let deps;

function buildDeps() {
  return {
    hasJsonContentType: jest.fn(),
    parseJsonBody: jest.fn(),
    sendJson: (res, status, payload) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    },
    badRequest: (res, message) => {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'bad_request', message }));
    },
    requireAuth: jest.fn(),
    requirePermission: jest.fn(),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
}

beforeEach(async () => {
  deps = buildDeps();
  // jest.config.cjs usa resetMocks:true — implementações vão no beforeEach.
  process.env.WHATSAPP_QR_WEBHOOK_SECRET = 'segredo-de-teste';
  deps.hasJsonContentType.mockReturnValue(true);
  deps.parseJsonBody.mockResolvedValue({
    tenantId: 't1',
    connectionId: 'c1',
    eventType: 'connected',
  });
  deps.requireAuth.mockReturnValue({ valid: true, agent: { id: 'a1', tenantId: 't1' } });
  deps.requirePermission.mockReturnValue({ allowed: true });
  whatsappQrService.ingestConnectionEvent.mockResolvedValue({ ok: true, connection: { id: 'c1' } });
  getWhatsAppQrBridgeStats.mockReturnValue({ bridges: 2, events: 10 });

  const app = express();
  app.use(createWhatsAppQrWebhookRoutes({ buildDeps: () => deps }));
  ({ instance: server, url: baseUrl } = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => {
      resolve({ instance, url: `http://127.0.0.1:${instance.address().port}` });
    });
  }));
});

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
  delete process.env.WHATSAPP_QR_WEBHOOK_SECRET;
});

function postEvent(headers = {}) {
  return fetch(`${baseUrl}/webhooks/whatsapp-qr/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-whatsapp-qr-secret': 'segredo-de-teste', ...headers },
    body: JSON.stringify({ tenantId: 't1', connectionId: 'c1', eventType: 'connected' }),
  });
}

describe('router vivo whatsapp-qr — webhook de eventos', () => {
  test('rejeita Content-Type não-JSON com 400 antes de qualquer processamento', async () => {
    deps.hasJsonContentType.mockReturnValue(false);
    const res = await postEvent();
    expect(res.status).toBe(400);
    expect(whatsappQrService.ingestConnectionEvent).not.toHaveBeenCalled();
  });

  test('exige tenantId e connectionId (400 invalid_payload)', async () => {
    deps.parseJsonBody.mockResolvedValue({ eventType: 'connected' });
    const res = await postEvent();
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_payload');
    expect(whatsappQrService.ingestConnectionEvent).not.toHaveBeenCalled();
  });

  test('mapeia invalid_event_type do serviço para 400', async () => {
    whatsappQrService.ingestConnectionEvent.mockResolvedValue({ ok: false, error: 'invalid_event_type' });
    const res = await postEvent();
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_event_type');
  });

  test('mapeia not_found do serviço para 404', async () => {
    whatsappQrService.ingestConnectionEvent.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await postEvent();
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toBe('not_found');
  });

  test('evento válido retorna 200 com a conexão', async () => {
    const res = await postEvent();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.connection.id).toBe('c1');
    expect(whatsappQrService.ingestConnectionEvent).toHaveBeenCalledWith('t1', 'c1', expect.objectContaining({ eventType: 'connected' }));
  });
});

describe('router vivo whatsapp-qr — stats do bridge', () => {
  test('GET /api/whatsapp/qr-bridge/stats retorna 401 sem autenticação', async () => {
    deps.requireAuth.mockReturnValue({ valid: false, error: 'sem token' });
    const res = await fetch(`${baseUrl}/api/whatsapp/qr-bridge/stats`);
    expect(res.status).toBe(401);
  });

  test('GET /api/whatsapp/qr-bridge/stats retorna 403 sem permissão reports:read', async () => {
    deps.requirePermission.mockReturnValue({ allowed: false, error: 'negado' });
    const res = await fetch(`${baseUrl}/api/whatsapp/qr-bridge/stats`);
    expect(res.status).toBe(403);
    expect(getWhatsAppQrBridgeStats).not.toHaveBeenCalled();
  });

  test('GET /api/whatsapp/qr-bridge/stats retorna payload de stats', async () => {
    const res = await fetch(`${baseUrl}/api/whatsapp/qr-bridge/stats`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.bridges).toBe(2);
  });
});
