describe('whatsAppQrWebhookRoutes handler', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn() },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.WHATSAPP_QR_WEBHOOK_SECRET;
  });

  test('retorna false para rota não tratada', async () => {
    jest.doMock('../../api/services/whatsappQrService', () => ({}));
    const { handleWhatsAppQrWebhookRoutes } = require('../../api/modules/whatsapp-qr-webhook/handleWhatsAppQrWebhookRoutes');

    const deps = makeDeps();
    const handled = await handleWhatsAppQrWebhookRoutes({
      req: {},
      res: {},
      method: 'GET',
      pathname: '/other',
      deps,
    });

    expect(handled).toBe(false);
    expect(deps.sendJson).not.toHaveBeenCalled();
  });

  test('POST /webhooks/whatsapp-qr/events valida Content-Type', async () => {
    jest.doMock('../../api/services/whatsappQrService', () => ({
      ingestConnectionEvent: jest.fn(async () => ({ ok: true, connection: { id: 'c-1' } })),
    }));
    const { handleWhatsAppQrWebhookRoutes } = require('../../api/modules/whatsapp-qr-webhook/handleWhatsAppQrWebhookRoutes');

    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });
    const handled = await handleWhatsAppQrWebhookRoutes({
      req: { headers: {} },
      res: {},
      method: 'POST',
      pathname: '/webhooks/whatsapp-qr/events',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith({}, 'Content-Type deve ser application/json');
  });

  test('POST /webhooks/whatsapp-qr/events valida segredo quando configurado', async () => {
    process.env.WHATSAPP_QR_WEBHOOK_SECRET = 'secret-1';

    jest.doMock('../../api/services/whatsappQrService', () => ({
      ingestConnectionEvent: jest.fn(async () => ({ ok: true, connection: { id: 'c-1' } })),
    }));
    const { handleWhatsAppQrWebhookRoutes } = require('../../api/modules/whatsapp-qr-webhook/handleWhatsAppQrWebhookRoutes');

    const req = { headers: {} };
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ tenantId: 't1', connectionId: 'c1', eventType: 'connected' })),
    });

    const handled = await handleWhatsAppQrWebhookRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/webhooks/whatsapp-qr/events',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, {
      error: 'unauthorized',
      message: 'Invalid webhook secret',
    });
  });

  test('POST /webhooks/whatsapp-qr/events mapeia invalid_event_type para 400', async () => {
    const ingestConnectionEvent = jest.fn(async () => ({ ok: false, error: 'invalid_event_type' }));

    jest.doMock('../../api/services/whatsappQrService', () => ({ ingestConnectionEvent }));
    const { handleWhatsAppQrWebhookRoutes } = require('../../api/modules/whatsapp-qr-webhook/handleWhatsAppQrWebhookRoutes');

    const req = { headers: {} };
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ tenantId: 't1', connectionId: 'c1', eventType: 'unknown' })),
    });

    const handled = await handleWhatsAppQrWebhookRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/webhooks/whatsapp-qr/events',
      deps,
    });

    expect(handled).toBe(true);
    expect(ingestConnectionEvent).toHaveBeenCalledWith('t1', 'c1', {
      tenantId: 't1',
      connectionId: 'c1',
      eventType: 'unknown',
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 400, {
      error: 'invalid_event_type',
      message: 'eventType inválido ou ausente',
    });
  });

  test('GET /api/whatsapp/qr-bridge/stats retorna 403 sem permissão', async () => {
    jest.doMock('../../api/services/whatsappQrBridgeService', () => ({
      getWhatsAppQrBridgeStats: jest.fn(() => ({ received: 0, processed: 0 })),
    }));
    const { handleWhatsAppQrWebhookRoutes } = require('../../api/modules/whatsapp-qr-webhook/handleWhatsAppQrWebhookRoutes');

    const req = { headers: {} };
    const res = {};
    const deps = makeDeps({
      requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })),
    });

    const handled = await handleWhatsAppQrWebhookRoutes({
      req,
      res,
      method: 'GET',
      pathname: '/api/whatsapp/qr-bridge/stats',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, {
      error: 'forbidden',
      message: 'forbidden',
    });
  });

  test('GET /api/whatsapp/qr-bridge/stats retorna payload de stats', async () => {
    const getWhatsAppQrBridgeStats = jest.fn(() => ({ received: 10, processed: 8 }));

    jest.doMock('../../api/services/whatsappQrBridgeService', () => ({
      getWhatsAppQrBridgeStats,
    }));
    const { handleWhatsAppQrWebhookRoutes } = require('../../api/modules/whatsapp-qr-webhook/handleWhatsAppQrWebhookRoutes');

    const req = { headers: {} };
    const res = {};
    const deps = makeDeps();

    const handled = await handleWhatsAppQrWebhookRoutes({
      req,
      res,
      method: 'GET',
      pathname: '/api/whatsapp/qr-bridge/stats',
      deps,
    });

    expect(handled).toBe(true);
    expect(getWhatsAppQrBridgeStats).toHaveBeenCalledTimes(1);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      received: 10,
      processed: 8,
    });
  });
});
