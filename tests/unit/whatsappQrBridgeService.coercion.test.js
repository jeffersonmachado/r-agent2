'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('whatsappQrBridgeService coercion hardening', () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    process.env = { ...originalEnv };
    jest.resetModules();
    jest.clearAllMocks();
  });

  function mockBridge({ initializeError = null, tenantKey = 'tenant-1' } = {}) {
    const handlers = {};
    const client = {
      on: jest.fn((event, handler) => {
        handlers[event] = handler;
      }),
      initialize: jest.fn(async () => {
        if (initializeError) throw initializeError;
      }),
      destroy: jest.fn(async () => {}),
    };

    jest.doMock('whatsapp-web.js', () => ({
      Client: jest.fn(() => client),
      LocalAuth: jest.fn(() => ({})),
    }), { virtual: true });

    jest.doMock('../../api/services/tenantService', () => ({
      listTenants: jest.fn(async () => [{ tenant_key: tenantKey }]),
    }));
    const ingestConnectionEvent = jest.fn(async () => ({ ok: true }));
    jest.doMock('../../api/services/whatsappQrService', () => ({
      listConnections: jest.fn(async () => ({
        ok: true,
        connections: [{ id: 'conn-1', provider: 'whatsapp-qr', status: 'pairing' }],
      })),
      ingestConnectionEvent,
    }));

    return { handlers, client, ingestConnectionEvent };
  }

  test('eventos qr/auth_failure/disconnected toleram payloads hostis', async () => {
    process.env.WHATSAPP_QR_BRIDGE_TENANTS = 'tenant-1';
    process.env.WHATSAPP_QR_BRIDGE_SYNC_MS = '60000';

    const { handlers, ingestConnectionEvent } = mockBridge();
    const svc = require('../../api/services/whatsappQrBridgeService');

    await svc.startWhatsAppQrBridge();

    const hostile = { toString() { throw new Error('boom-hostile'); } };

    await expect(handlers.qr(hostile)).resolves.not.toThrow();
    // auth_failure/disconnected podem ser handlers síncronos no pacote (retornam
    // undefined): Promise.resolve cobre ambos os casos sem perder a afirmação.
    await expect(Promise.resolve(handlers.auth_failure(hostile))).resolves.not.toThrow();
    await expect(Promise.resolve(handlers.disconnected(hostile))).resolves.not.toThrow();

    expect(ingestConnectionEvent).toHaveBeenCalled();
    await svc.stopWhatsAppQrBridge();
  });

  test('falha hostil em initialize não derruba start', async () => {
    process.env.WHATSAPP_QR_BRIDGE_TENANTS = 'tenant-1';
    process.env.WHATSAPP_QR_BRIDGE_SYNC_MS = '60000';

    const hostileErr = {};
    Object.defineProperty(hostileErr, 'message', {
      get() { throw new Error('boom-init-message'); },
      enumerable: true,
    });

    const { ingestConnectionEvent } = mockBridge({ initializeError: hostileErr });
    const svc = require('../../api/services/whatsappQrBridgeService');

    const out = await svc.startWhatsAppQrBridge();
    expect(out).toEqual(expect.objectContaining({ ok: true }));
    expect(ingestConnectionEvent).toHaveBeenCalledWith(
      'tenant-1',
      'conn-1',
      expect.objectContaining({ eventType: 'error' })
    );
    await svc.stopWhatsAppQrBridge();
  });

  test('classifica erro de chrome ausente com codigo especifico', async () => {
    process.env.WHATSAPP_QR_BRIDGE_TENANTS = 'tenant-1';
    process.env.WHATSAPP_QR_BRIDGE_SYNC_MS = '60000';

    mockBridge({ initializeError: new Error('Could not find Chrome (ver. 146.0.7680.153)') });
    const svc = require('../../api/services/whatsappQrBridgeService');

    const out = await svc.requestConnectionQr('tenant-1', 'conn-1');
    expect(out).toEqual(expect.objectContaining({
      ok: false,
      error: 'bridge_browser_missing',
    }));
    expect(String(out.message || '')).toContain('npx puppeteer browsers install chrome');
  });

  test('tenant ids hostis vindos de listTenants não quebram o sync', async () => {
    delete process.env.WHATSAPP_QR_BRIDGE_TENANTS;
    process.env.WHATSAPP_QR_BRIDGE_SYNC_MS = '60000';

    const hostileTenant = { toString() { throw new Error('boom-tenant'); } };
    mockBridge({ tenantKey: hostileTenant });
    const svc = require('../../api/services/whatsappQrBridgeService');

    await expect(svc.startWhatsAppQrBridge()).resolves.toEqual(expect.objectContaining({ ok: true }));
    await svc.stopWhatsAppQrBridge();
  });
});
