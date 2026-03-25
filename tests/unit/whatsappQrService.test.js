describe('whatsappQrService', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('atualiza status para connected e limpa QR', async () => {
    const settingsStore = {
      whatsapp_connections: {
        connections: [
          {
            id: 'conn-1',
            name: 'Conexao 1',
            status: 'pairing',
            qr: { text: '', token: '', expiresAt: new Date(Date.now() + 60_000).toISOString() },
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
    const out = await service.setConnectionStatus('tenant-1', 'conn-1', {
      status: 'connected',
      metadata: { providerSessionId: 'sess-123' },
    });
    expect(out.ok).toBe(true);
    expect(out.connection.status).toBe('connected');
    expect(out.connection.qr).toBeNull();
    expect(out.connection.lastConnectedAt).toBeTruthy();
    expect(out.connection.metadata.providerSessionId).toBe('sess-123');
  });

  test('status expira QR e retorna disconnected quando pairing passou do prazo', async () => {
    const settingsStore = {
      whatsapp_connections: {
        connections: [
          {
            id: 'conn-2',
            name: 'Conexao 2',
            status: 'pairing',
            qr: { text: '', token: '', expiresAt: new Date(Date.now() - 5_000).toISOString() },
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
    const out = await service.getStatus('tenant-1', 'conn-2');
    expect(out.ok).toBe(true);
    expect(out.status).toBe('disconnected');
    expect(out.qr).toBeNull();
  });

  test('ingestConnectionEvent atualiza para connected com metadata de provider', async () => {
    const settingsStore = {
      whatsapp_connections: {
        connections: [
          {
            id: 'conn-3',
            name: 'Conexao 3',
            status: 'pairing',
            qr: { text: '', token: '', expiresAt: new Date(Date.now() + 60_000).toISOString() },
          },
        ],
      },
    };

    const emitEvent = jest.fn();

    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async ({ key }) => ({ ok: true, value: settingsStore[key] || null })),
      upsertSetting: jest.fn(async ({ key, value }) => {
        settingsStore[key] = value;
        return { ok: true, value };
      }),
    }));
    jest.doMock('../../api/services/websocketService', () => ({
      emitEvent,
    }));

    const service = require('../../api/services/whatsappQrService');
    const out = await service.ingestConnectionEvent('tenant-1', 'conn-3', {
      eventType: 'connected',
      metadata: { providerSessionId: 'p-1' },
    });
    expect(out.ok).toBe(true);
    expect(out.connection.status).toBe('connected');
    expect(out.connection.metadata.providerSessionId).toBe('p-1');
    expect(out.connection.metadata.lastProviderEventType).toBe('connected');
    expect(out.connection.qr).toBeNull();
    expect(emitEvent).toHaveBeenCalledWith(
      'whatsapp.connection.updated',
      expect.objectContaining({
        connection: expect.objectContaining({ id: 'conn-3', status: 'connected' }),
      }),
      expect.objectContaining({ tenantId: 'tenant-1' })
    );
  });

  test('generateQr não fabrica QR sintético inválido quando ainda não há QR do provider', async () => {
    const settingsStore = {
      whatsapp_connections: {
        connections: [
          {
            id: 'conn-4',
            name: 'Conexao 4',
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
    const out = await service.generateQr('tenant-1', 'conn-4');
    expect(out.ok).toBe(true);
    expect(out.connection.status).toBe('pairing');
    expect(out.qr).toBeNull();
    expect(out.isTestQr).toBe(false);
    expect(out.pending).toBe(true);
  });

  test('retorna persistence_required quando tenant_settings não está disponível', async () => {
    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async () => ({ ok: false, error: 'db_unavailable' })),
      upsertSetting: jest.fn(async () => ({ ok: false, error: 'db_unavailable' })),
    }));

    const service = require('../../api/services/whatsappQrService');
    const out = await service.listConnections('tenant-1');

    expect(out.ok).toBe(false);
    expect(out.error).toBe('persistence_required');
    expect(out.details).toBe('db_unavailable');
  });

  test('ingestConnectionEvent cobre todos os eventType suportados', async () => {
    const baseConnection = {
      id: 'conn-events',
      name: 'Conexao Events',
      status: 'pairing',
      qr: { text: 'old', token: 'old', expiresAt: new Date(Date.now() + 60_000).toISOString() },
      metadata: {},
    };

    const settingsStore = {
      whatsapp_connections: {
        connections: [baseConnection],
      },
    };

    const emitEvent = jest.fn();

    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async ({ key }) => ({ ok: true, value: settingsStore[key] || null })),
      upsertSetting: jest.fn(async ({ key, value }) => {
        settingsStore[key] = value;
        return { ok: true, value };
      }),
    }));
    jest.doMock('../../api/services/websocketService', () => ({
      emitEvent,
    }));

    const service = require('../../api/services/whatsappQrService');

    const cases = [
      { eventType: 'qr', expectedStatus: 'pairing', hasQr: true },
      { eventType: 'pairing', expectedStatus: 'pairing', hasQr: true },
      { eventType: 'connected', expectedStatus: 'connected', hasQr: false },
      { eventType: 'ready', expectedStatus: 'connected', hasQr: false },
      { eventType: 'disconnected', expectedStatus: 'disconnected', hasQr: false },
      { eventType: 'logout', expectedStatus: 'disconnected', hasQr: false },
      { eventType: 'closed', expectedStatus: 'disconnected', hasQr: false },
      { eventType: 'error', expectedStatus: 'error', hasQr: false },
      { eventType: 'failed', expectedStatus: 'error', hasQr: false },
    ];

    for (const item of cases) {
      settingsStore.whatsapp_connections.connections[0] = {
        ...baseConnection,
        status: 'pairing',
        qr: { text: 'old', token: 'old', expiresAt: new Date(Date.now() + 60_000).toISOString() },
        metadata: {},
      };

      const out = await service.ingestConnectionEvent('tenant-1', 'conn-events', {
        eventType: item.eventType,
        qr: {
          text: `qr-${item.eventType}`,
          token: `token-${item.eventType}`,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        },
        metadata: { source: 'unit-test' },
      });

      expect(out.ok).toBe(true);
      expect(out.connection.status).toBe(item.expectedStatus);
      expect(Boolean(out.connection.qr)).toBe(item.hasQr);
      expect(out.connection.metadata.lastProviderEventType).toBe(item.eventType);
      expect(out.connection.metadata.source).toBe('unit-test');
    }

    expect(emitEvent).toHaveBeenCalledTimes(cases.length);
    expect(emitEvent).toHaveBeenLastCalledWith(
      'whatsapp.connection.updated',
      expect.objectContaining({
        connection: expect.objectContaining({ id: 'conn-events', status: 'error' }),
        context: expect.objectContaining({ action: 'ingest_event', eventType: 'failed' }),
      }),
      expect.objectContaining({ tenantId: 'tenant-1' })
    );
  });

  test('ingestConnectionEvent valida eventType obrigatório e inválido', async () => {
    const settingsStore = {
      whatsapp_connections: {
        connections: [
          {
            id: 'conn-events-validation',
            name: 'Conexao Validation',
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

    const missing = await service.ingestConnectionEvent('tenant-1', 'conn-events-validation', {});
    expect(missing).toEqual({ ok: false, error: 'event_type_required' });

    const invalid = await service.ingestConnectionEvent('tenant-1', 'conn-events-validation', { eventType: 'unexpected' });
    expect(invalid).toEqual({ ok: false, error: 'invalid_event_type' });
  });
});
