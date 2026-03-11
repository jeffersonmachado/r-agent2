'use strict';

const whatsappIvrService = require('../../services/whatsappIvrService');
const { getWhatsAppQrBridgeStats } = require('../../services/whatsappQrBridgeService');
const { handleWhatsappRoutes, whatsappRouteHandlers } = require('../whatsappRoutes');

jest.mock('../../services/whatsappIvrService', () => ({
  getNormalizedWhatsAppIvrSetting: jest.fn(),
  saveWhatsAppIvrSetting: jest.fn(),
}));

jest.mock('../../services/whatsappQrBridgeService', () => ({
  getWhatsAppQrBridgeStats: jest.fn(),
}));

function buildResponse() {
  return {
    writeHead: jest.fn(),
    end: jest.fn(),
  };
}

function buildContext(overrides = {}) {
  const res = buildResponse();
  return {
    req: {
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=token&hub.challenge=challenge',
      headers: {},
    },
    res,
    method: 'GET',
    pathname: '/webhooks/whatsapp',
    deps: {
      requireAuth: jest.fn(),
      requirePermission: jest.fn(),
      sendJson: jest.fn(),
      hasJsonContentType: jest.fn(),
      parseJsonBody: jest.fn(),
      logger: { info: jest.fn(), error: jest.fn() },
      requireTenant: jest.fn(),
      badRequest: jest.fn(),
      verifyWebhook: jest.fn(() => true),
      channelGatewayService: { updateStatus: jest.fn() },
      channelNormalizationService: { normalizeWhatsAppIncoming: jest.fn() },
      handleWhatsAppInbound: jest.fn(),
      saveSessionEventsToFile: jest.fn(),
      sessionEvents: [],
      flows: new Map(),
      getQrRunner: jest.fn(),
      listTemplates: jest.fn(),
      getTemplate: jest.fn(),
      createTemplate: jest.fn(),
      sendTemplateMessage: jest.fn(),
      logAction: jest.fn(),
    },
    ...overrides,
  };
}

describe('handleWhatsappRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles GET /webhooks/whatsapp via the modular whatsapp dispatcher', async () => {
    const context = buildContext();

    const handled = await handleWhatsappRoutes(context);

    expect(handled).toBe(true);
    expect(context.deps.verifyWebhook).toHaveBeenCalledWith('subscribe', 'token');
    expect(context.res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/plain' });
    expect(context.res.end).toHaveBeenCalledWith('challenge');
    expect(context.deps.sendJson).not.toHaveBeenCalled();
  });

  it('handles GET /whatsapp/ivr via the IVR subdomain dispatcher', async () => {
    whatsappIvrService.getNormalizedWhatsAppIvrSetting.mockResolvedValue({ ok: true, value: { enabled: true } });
    const context = buildContext({
      req: {
        url: '/whatsapp/ivr',
        headers: {},
      },
      method: 'GET',
      pathname: '/whatsapp/ivr',
      deps: {
        ...buildContext().deps,
        requireAuth: jest.fn(() => ({ valid: true })),
        requirePermission: jest.fn(() => ({ allowed: true })),
        requireTenant: jest.fn(() => 'tenant-1'),
      },
    });

    const handled = await handleWhatsappRoutes(context);

    expect(handled).toBe(true);
    expect(whatsappIvrService.getNormalizedWhatsAppIvrSetting).toHaveBeenCalledWith({ tenantId: 'tenant-1' });
    expect(context.deps.sendJson).toHaveBeenCalledWith(context.res, 200, { ok: true, value: { enabled: true } });
  });

  it('handles GET /api/whatsapp/qr-bridge/stats via the QR subdomain dispatcher', async () => {
    getWhatsAppQrBridgeStats.mockReturnValue({ bridgeEnabled: true });
    const context = buildContext({
      req: {
        url: '/api/whatsapp/qr-bridge/stats',
        headers: {},
      },
      method: 'GET',
      pathname: '/api/whatsapp/qr-bridge/stats',
      deps: {
        ...buildContext().deps,
        requireAuth: jest.fn(() => ({ valid: true })),
        requirePermission: jest.fn(() => ({ allowed: true })),
      },
    });

    const handled = await handleWhatsappRoutes(context);

    expect(handled).toBe(true);
    expect(getWhatsAppQrBridgeStats).toHaveBeenCalled();
    expect(context.deps.sendJson).toHaveBeenCalledWith(context.res, 200, { ok: true, bridgeEnabled: true });
  });

  it('handles GET /whatsapp/templates via the template subdomain dispatcher', async () => {
    const listTemplates = jest.fn(async () => [{ id: 'tpl-1' }]);
    const context = buildContext({
      req: {
        url: '/whatsapp/templates',
        headers: {},
      },
      method: 'GET',
      pathname: '/whatsapp/templates',
      deps: {
        ...buildContext().deps,
        requireAuth: jest.fn(() => ({ valid: true })),
        requirePermission: jest.fn(() => ({ allowed: true })),
        listTemplates,
      },
    });

    const handled = await handleWhatsappRoutes(context);

    expect(handled).toBe(true);
    expect(listTemplates).toHaveBeenCalled();
    expect(context.deps.sendJson).toHaveBeenCalledWith(context.res, 200, { templates: [{ id: 'tpl-1' }] });
  });

  it('exposes the whatsapp subdomain handlers in canonical order', () => {
    expect(whatsappRouteHandlers.map((handler) => handler.name)).toEqual([
      'handleWhatsappQrRoutes',
      'handleWhatsappIvrRoutes',
      'handleWhatsappWebhookRoutes',
      'handleWhatsappTemplateRoutes',
    ]);
  });
});
