describe('whatsappQrBridgeService', () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    process.env = { ...originalEnv };
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('quando bridge está desabilitado retorna skipped', async () => {
    process.env.ENABLE_WHATSAPP_QR_BRIDGE = 'false';
    const svc = require('../../api/services/whatsappQrBridgeService');
    const out = await svc.startWhatsAppQrBridge();
    expect(out.ok).toBe(false);
    expect(out.skipped).toBe(true);
  });

  test('quando habilitado sem lib instalada não quebra e expõe missingLibrary', async () => {
    process.env.ENABLE_WHATSAPP_QR_BRIDGE = 'true';
    process.env.WHATSAPP_QR_BRIDGE_TENANTS = 'system';
    process.env.WHATSAPP_QR_BRIDGE_SYNC_MS = '60000';

    jest.doMock('../../api/services/tenantService', () => ({
      listTenants: jest.fn(async () => [{ tenant_key: 'system' }]),
    }));
    jest.doMock('../../api/services/whatsappQrService', () => ({
      listConnections: jest.fn(async () => ({
        ok: true,
        connections: [{ id: 'conn-1', provider: 'whatsapp-qr', status: 'pairing' }],
      })),
      ingestConnectionEvent: jest.fn(async () => ({ ok: true })),
    }));

    const svc = require('../../api/services/whatsappQrBridgeService');
    const out = await svc.startWhatsAppQrBridge();
    expect(out.ok).toBe(true);

    const stats = svc.getWhatsAppQrBridgeStats();
    expect(stats.started).toBe(true);
    expect(stats.missingLibrary).toBe(true);

    await svc.stopWhatsAppQrBridge();
  });
});
