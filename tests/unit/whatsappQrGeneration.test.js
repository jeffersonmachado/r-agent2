describe('WhatsApp QR Generation Suite', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  describe('QR generation when provider is unavailable', () => {
    test('generateQr retorna pending=true e qr=null quando provider não disponível', async () => {
      const settingsStore = {
        whatsapp_connections: {
          connections: [
            {
              id: 'conn-test-1',
              name: 'Test Connection',
              status: 'disconnected',
              qr: null,
            },
          ],
        },
      };

      jest.doMock('../../api/services/tenantSettingsService', () => ({
        getSetting: jest.fn(async ({ key }) => ({ ok: true, value: settingsStore[key] || null })),
        upsertSetting: jest.fn(async ({ key, value }) => {
          settingsStore[key] = value;
          return { ok: true, value };
        }),
      }));

      const service = require('../../api/services/whatsappQrService');
      const out = await service.generateQr('tenant-1', 'conn-test-1');

      expect(out.ok).toBe(true);
      expect(out.isTestQr).toBe(false);
      expect(out.pending).toBe(true);
      expect(out.qr).toBeNull();
      expect(out.connection.status).toBe('pairing');
    });

    test('generateQr reutiliza QR real válido e não expirado', async () => {
      const expiresAt = new Date(Date.now() + 90_000).toISOString();
      const realQrText = '2@hGqF7k...realQRdata';
      const settingsStore = {
        whatsapp_connections: {
          connections: [
            {
              id: 'conn-test-2',
              name: 'Test Connection 2',
              status: 'pairing',
              qr: { text: realQrText, token: 'real-token', expiresAt },
            },
          ],
        },
      };

      jest.doMock('../../api/services/tenantSettingsService', () => ({
        getSetting: jest.fn(async ({ key }) => ({ ok: true, value: settingsStore[key] || null })),
        upsertSetting: jest.fn(async ({ key, value }) => {
          settingsStore[key] = value;
          return { ok: true, value };
        }),
      }));

      const service = require('../../api/services/whatsappQrService');
      const out = await service.generateQr('tenant-1', 'conn-test-2');

      expect(out.ok).toBe(true);
      expect(out.isTestQr).toBe(false);
      expect(out.pending).toBe(false);
      expect(out.qr.text).toBe(realQrText);
    });

    test('generateQr retorna pending quando QR real estava expirado', async () => {
      const expiredAt = new Date(Date.now() - 5_000).toISOString();
      const settingsStore = {
        whatsapp_connections: {
          connections: [
            {
              id: 'conn-test-3',
              name: 'Test Connection 3',
              status: 'pairing',
              qr: { text: '2@expired...realQR', token: 'real-token', expiresAt: expiredAt },
            },
          ],
        },
      };

      jest.doMock('../../api/services/tenantSettingsService', () => ({
        getSetting: jest.fn(async ({ key }) => ({ ok: true, value: settingsStore[key] || null })),
        upsertSetting: jest.fn(async ({ key, value }) => {
          settingsStore[key] = value;
          return { ok: true, value };
        }),
      }));

      const service = require('../../api/services/whatsappQrService');
      const out = await service.generateQr('tenant-1', 'conn-test-3');

      expect(out.ok).toBe(true);
      expect(out.isTestQr).toBe(false);
      expect(out.pending).toBe(true);
      expect(out.qr).toBeNull();
    });
  });

  describe('Provider QR update via ingestConnectionEvent', () => {
    test('ingestConnectionEvent atualiza QR nulo para provider QR real', async () => {
      const settingsStore = {
        whatsapp_connections: {
          connections: [
            {
              id: 'conn-provider-1',
              name: 'Provider Connection',
              status: 'pairing',
              qr: null,
            },
          ],
        },
      };

      jest.doMock('../../api/services/tenantSettingsService', () => ({
        getSetting: jest.fn(async ({ key }) => ({ ok: true, value: settingsStore[key] || null })),
        upsertSetting: jest.fn(async ({ key, value }) => {
          settingsStore[key] = value;
          return { ok: true, value };
        }),
      }));

      const service = require('../../api/services/whatsappQrService');

      // Simula webhook do provider trazendo QR real
      const realQrText = '23@hDfpJq6D1VTmI6v5ylGc1zOHgq6qlJ9VWhE3nVvjDqGf6RXr51x0A8SfrcD1b0F5Y3';
      const out = await service.ingestConnectionEvent('tenant-1', 'conn-provider-1', {
        eventType: 'qr',
        qr: {
          text: realQrText,
          token: 'real-provider-token',
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        },
      });

      expect(out.ok).toBe(true);
      expect(out.connection.status).toBe('pairing');
      expect(out.connection.qr.text).toBe(realQrText);
      expect(out.connection.qr.token).toBe('real-provider-token');
      expect(out.connection.qr.text).not.toMatch(/^test:/);
    });

    test('ingestConnectionEvent com connected event limpa QR', async () => {
      const settingsStore = {
        whatsapp_connections: {
          connections: [
            {
              id: 'conn-connected-1',
              name: 'Connected Connection',
              status: 'pairing',
              qr: { text: '23@hDfpJq6...', token: 'abc123', expiresAt: new Date(Date.now() + 120_000).toISOString() },
            },
          ],
        },
      };

      jest.doMock('../../api/services/tenantSettingsService', () => ({
        getSetting: jest.fn(async ({ key }) => ({ ok: true, value: settingsStore[key] || null })),
        upsertSetting: jest.fn(async ({ key, value }) => {
          settingsStore[key] = value;
          return { ok: true, value };
        }),
      }));

      const service = require('../../api/services/whatsappQrService');

      const out = await service.ingestConnectionEvent('tenant-1', 'conn-connected-1', {
        eventType: 'connected',
      });

      expect(out.ok).toBe(true);
      expect(out.connection.status).toBe('connected');
      expect(out.connection.qr).toBeNull();
    });
  });

  describe('QR status and expiration', () => {
    test('getStatus detecta QR expirado e retorna disconnected', async () => {
      const expiredAt = new Date(Date.now() - 10_000).toISOString();
      const settingsStore = {
        whatsapp_connections: {
          connections: [
            {
              id: 'conn-expired-1',
              name: 'Expired Connection',
              status: 'pairing',
              qr: { text: 'test:conn-expired-1:abc:1234567890', token: 'abc', expiresAt: expiredAt },
            },
          ],
        },
      };

      jest.doMock('../../api/services/tenantSettingsService', () => ({
        getSetting: jest.fn(async ({ key }) => ({ ok: true, value: settingsStore[key] || null })),
        upsertSetting: jest.fn(async ({ key, value }) => {
          settingsStore[key] = value;
          return { ok: true, value };
        }),
      }));

      const service = require('../../api/services/whatsappQrService');

      const out = await service.getStatus('tenant-1', 'conn-expired-1');

      expect(out.ok).toBe(true);
      expect(out.status).toBe('disconnected');
      expect(out.qr).toBeNull();
    });

    test('getStatus retorna QR válido quando não expirado', async () => {
      const validUntil = new Date(Date.now() + 90_000).toISOString();
      const settingsStore = {
        whatsapp_connections: {
          connections: [
            {
              id: 'conn-valid-1',
              name: 'Valid Connection',
              status: 'pairing',
              qr: { text: 'test:conn-valid-1:xyz:1234567890', token: 'xyz', expiresAt: validUntil },
            },
          ],
        },
      };

      jest.doMock('../../api/services/tenantSettingsService', () => ({
        getSetting: jest.fn(async ({ key }) => ({ ok: true, value: settingsStore[key] || null })),
        upsertSetting: jest.fn(async ({ key, value }) => {
          settingsStore[key] = value;
          return { ok: true, value };
        }),
      }));

      const service = require('../../api/services/whatsappQrService');

      const out = await service.getStatus('tenant-1', 'conn-valid-1');

      expect(out.ok).toBe(true);
      expect(out.status).toBe('pairing');
      expect(out.qr).toEqual(expect.objectContaining({
        expiresAt: validUntil,
      }));
    });
  });
});
