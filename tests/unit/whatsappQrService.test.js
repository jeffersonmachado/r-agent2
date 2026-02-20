jest.mock('../../api/services/websocketService', () => ({
  emitEvent: jest.fn(),
}));

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
            qr: { text: 'waqr:conn-1:abc', token: 'abc', expiresAt: new Date(Date.now() + 60_000).toISOString() },
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
            qr: { text: 'waqr:conn-2:abc', token: 'abc', expiresAt: new Date(Date.now() - 5_000).toISOString() },
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
            qr: { text: 'waqr:conn-3:abc', token: 'abc', expiresAt: new Date(Date.now() + 60_000).toISOString() },
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
    const out = await service.ingestConnectionEvent('tenant-1', 'conn-3', {
      eventType: 'connected',
      metadata: { providerSessionId: 'p-1' },
    });
    expect(out.ok).toBe(true);
    expect(out.connection.status).toBe('connected');
    expect(out.connection.metadata.providerSessionId).toBe('p-1');
    expect(out.connection.metadata.lastProviderEventType).toBe('connected');
    expect(out.connection.qr).toBeNull();
  });

  test('listConnections aplica defaults retrocompatíveis para bot', async () => {
    const settingsStore = {
      whatsapp_connections: {
        connections: [
          {
            id: 'conn-legacy',
            name: 'Conexao Legada',
            status: 'disconnected',
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
    const out = await service.listConnections('tenant-1');
    expect(out.ok).toBe(true);
    expect(out.connections[0].botEnabled).toBe(false);
    expect(out.connections[0].botFlowId).toBeNull();
  });

  test('createConnection persiste configuração de bot/flow', async () => {
    const settingsStore = {
      whatsapp_connections: {
        connections: [],
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
    const out = await service.createConnection('tenant-1', {
      name: 'Conn com Bot',
      botEnabled: true,
      botFlowId: 'flow-abc',
    });

    expect(out.ok).toBe(true);
    expect(out.connection.botEnabled).toBe(true);
    expect(out.connection.botFlowId).toBe('flow-abc');
  });
});
