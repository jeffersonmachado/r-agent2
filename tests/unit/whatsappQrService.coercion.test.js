'use strict';

describe('whatsappQrService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('createConnection tolerates hostile id/name/provider/status coercion', async () => {
    const settingsStore = { whatsapp_connections: { connections: [] } };

    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async ({ key }) => ({ ok: true, value: settingsStore[key] || null })),
      upsertSetting: jest.fn(async ({ key, value }) => {
        settingsStore[key] = value;
        return { ok: true, value };
      }),
    }));

    const svc = require('../../api/services/whatsappQrService');

    const out = await svc.createConnection('tenant-1', {
      id: { toString: () => { throw new Error('boom-id'); } },
      name: { toString: () => { throw new Error('boom-name'); } },
      provider: { toString: () => { throw new Error('boom-provider'); } },
      status: { toString: () => { throw new Error('boom-status'); } },
    });

    expect(out.ok).toBe(true);
    expect(out.connection).toEqual(expect.objectContaining({
      id: '',
      name: '',
      provider: 'whatsapp-qr',
      status: 'disconnected',
    }));
  });

  test('ingestConnectionEvent tolerates hostile qr fields and invalid expiresAt', async () => {
    const settingsStore = {
      whatsapp_connections: {
        connections: [
          {
            id: 'conn-1',
            name: 'Conn 1',
            provider: 'whatsapp-qr',
            status: 'disconnected',
            qr: null,
            metadata: {},
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

    const svc = require('../../api/services/whatsappQrService');

    const out = await svc.ingestConnectionEvent('tenant-1', 'conn-1', {
      eventType: 'qr',
      qr: {
        text: { toString: () => { throw new Error('boom-qr-text'); } },
        token: { toString: () => { throw new Error('boom-qr-token'); } },
        expiresAt: { toString: () => { throw new Error('boom-qr-exp'); } },
      },
    });

    expect(out.ok).toBe(true);
    expect(out.connection.status).toBe('pairing');
    expect(out.connection.qr).toEqual(expect.objectContaining({
      text: expect.any(String),
      token: expect.any(String),
      expiresAt: expect.any(String),
    }));
  });

  test('getStatus with hostile connectionId coercion returns not_found', async () => {
    const settingsStore = {
      whatsapp_connections: {
        connections: [
          {
            id: 'conn-2',
            name: 'Conn 2',
            provider: 'whatsapp-qr',
            status: 'disconnected',
            qr: null,
            metadata: {},
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

    const svc = require('../../api/services/whatsappQrService');

    const out = await svc.getStatus('tenant-1', {
      toString: () => { throw new Error('boom-conn-id'); },
    });

    expect(out).toEqual({ ok: false, error: 'not_found' });
  });
});
