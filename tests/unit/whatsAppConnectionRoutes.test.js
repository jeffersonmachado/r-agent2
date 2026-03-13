describe('whatsAppConnectionRoutes handler', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      requireTenant: jest.fn(() => 'tenant-1'),
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
  });

  test('retorna false para rota não tratada', async () => {
    jest.doMock('../../api/services/whatsappQrService', () => ({}));
    const { handleWhatsAppConnectionRoutes } = require('../../api/serverHandlers/whatsAppConnectionRoutes');

    const deps = makeDeps();
    const req = {};
    const res = {};

    const handled = await handleWhatsAppConnectionRoutes({
      req,
      res,
      method: 'GET',
      pathname: '/other',
      deps,
    });

    expect(handled).toBe(false);
    expect(deps.sendJson).not.toHaveBeenCalled();
  });

  test('GET /whatsapp/connections retorna 401 quando sem auth', async () => {
    jest.doMock('../../api/services/whatsappQrService', () => ({
      listConnections: jest.fn(async () => ({ ok: true, connections: [] })),
    }));
    const { handleWhatsAppConnectionRoutes } = require('../../api/serverHandlers/whatsAppConnectionRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({
      requireAuth: jest.fn(() => ({ valid: false, error: 'invalid_token' })),
    });

    const handled = await handleWhatsAppConnectionRoutes({
      req,
      res,
      method: 'GET',
      pathname: '/whatsapp/connections',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, {
      error: 'unauthorized',
      message: 'invalid_token',
    });
  });

  test('POST /whatsapp/connections valida Content-Type', async () => {
    jest.doMock('../../api/services/whatsappQrService', () => ({
      createConnection: jest.fn(async () => ({ ok: true, connection: { id: 'c-1' } })),
    }));
    const { handleWhatsAppConnectionRoutes } = require('../../api/serverHandlers/whatsAppConnectionRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });

    const handled = await handleWhatsAppConnectionRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/whatsapp/connections',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Content-Type deve ser application/json');
  });

  test('POST /whatsapp/connections/:id/status mapeia invalid_status para 400', async () => {
    const setConnectionStatus = jest.fn(async () => ({ ok: false, error: 'invalid_status' }));

    jest.doMock('../../api/services/whatsappQrService', () => ({
      setConnectionStatus,
    }));
    const { handleWhatsAppConnectionRoutes } = require('../../api/serverHandlers/whatsAppConnectionRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ status: 'unknown' })),
    });

    const handled = await handleWhatsAppConnectionRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/whatsapp/connections/c-1/status',
      deps,
    });

    expect(handled).toBe(true);
    expect(setConnectionStatus).toHaveBeenCalledWith('tenant-1', 'c-1', { status: 'unknown' });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 400, {
      error: 'invalid_status',
      message: 'Status inválido. Use connected|pairing|disconnected|error',
    });
  });

  test('POST /whatsapp/connections/:id/events mapeia invalid_event_type para 400', async () => {
    const ingestConnectionEvent = jest.fn(async () => ({ ok: false, error: 'invalid_event_type' }));

    jest.doMock('../../api/services/whatsappQrService', () => ({
      ingestConnectionEvent,
    }));
    const { handleWhatsAppConnectionRoutes } = require('../../api/serverHandlers/whatsAppConnectionRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ eventType: 'x' })),
    });

    const handled = await handleWhatsAppConnectionRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/whatsapp/connections/c-1/events',
      deps,
    });

    expect(handled).toBe(true);
    expect(ingestConnectionEvent).toHaveBeenCalledWith('tenant-1', 'c-1', { eventType: 'x' });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 400, {
      error: 'invalid_event_type',
      message: 'eventType inválido. Use qr|pairing|connected|ready|disconnected|logout|closed|error|failed',
    });
  });

  test('GET /whatsapp/connections/:id/status retorna status do serviço', async () => {
    const getStatus = jest.fn(async () => ({ ok: true, status: 'connected', connection: { id: 'conn id' } }));

    jest.doMock('../../api/services/whatsappQrService', () => ({
      getStatus,
    }));
    const { handleWhatsAppConnectionRoutes } = require('../../api/serverHandlers/whatsAppConnectionRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps();

    const handled = await handleWhatsAppConnectionRoutes({
      req,
      res,
      method: 'GET',
      pathname: '/whatsapp/connections/conn%20id/status',
      deps,
    });

    expect(handled).toBe(true);
    expect(getStatus).toHaveBeenCalledWith('tenant-1', 'conn id');
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      status: 'connected',
      connection: { id: 'conn id' },
    });
  });
});
