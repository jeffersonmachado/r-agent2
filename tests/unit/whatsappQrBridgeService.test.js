jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('whatsappQrBridgeService', () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    process.env = { ...originalEnv };
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('startWhatsAppQrBridge inicializa bridge com dependencias mockadas', async () => {
    process.env.WHATSAPP_QR_BRIDGE_TENANTS = 'system';
    process.env.WHATSAPP_QR_BRIDGE_SYNC_MS = '60000';

    const client = {
      on: jest.fn(),
      initialize: jest.fn(async () => {}),
      destroy: jest.fn(async () => {}),
    };

    jest.doMock('whatsapp-web.js', () => ({
      Client: jest.fn(() => client),
      LocalAuth: jest.fn(() => ({})),
    }), { virtual: true });

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
    const result = await svc.startWhatsAppQrBridge();
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    await svc.stopWhatsAppQrBridge();
  });

  test('sendTextViaConnection retorna qr_send_failed em erro getChat sem reciclar sessao', async () => {
    process.env.WHATSAPP_QR_BRIDGE_TENANTS = 'tenant-1';
    process.env.WHATSAPP_QR_BRIDGE_SYNC_MS = '60000';

    const makeClient = (sendImpl) => {
      const handlers = {};
      return {
        on: jest.fn((event, cb) => { handlers[event] = cb; }),
        initialize: jest.fn(async () => { if (handlers.ready) await handlers.ready(); }),
        destroy: jest.fn(async () => {}),
        sendMessage: jest.fn(sendImpl),
        _handlers: handlers,
      };
    };
    const firstClient = makeClient(async () => {
      throw new Error("Cannot read properties of undefined (reading 'getChat')");
    });
    // Cliente extra não deve ser criado no mesmo ciclo.
    const freshClient = makeClient(jest.fn());

    const clientFactory = jest.fn()
      .mockImplementationOnce(() => firstClient)
      .mockImplementationOnce(() => freshClient);

    jest.doMock('whatsapp-web.js', () => ({
      Client: clientFactory,
      LocalAuth: jest.fn(() => ({})),
    }), { virtual: true });

    const ingestConnectionEvent = jest.fn(async () => ({ ok: true }));
    jest.doMock('../../api/services/tenantService', () => ({
      listTenants: jest.fn(async () => [{ tenant_key: 'tenant-1' }]),
    }));
    jest.doMock('../../api/services/whatsappQrService', () => ({
      listConnections: jest.fn(async () => ({
        ok: true,
        connections: [{ id: 'conn-1', provider: 'whatsapp-qr', status: 'connected' }],
      })),
      ingestConnectionEvent,
    }));

    const svc = require('../../api/services/whatsappQrBridgeService');
    const out = await svc.sendTextViaConnection({
      tenantId: 'tenant-1',
      connectionId: 'conn-1',
      to: '5511999999999',
      text: 'Teste',
    });

    expect(out).toEqual(expect.objectContaining({
      ok: false,
      error: 'qr_send_failed',
    }));
    expect(firstClient.destroy).not.toHaveBeenCalled();
    expect(freshClient.sendMessage).not.toHaveBeenCalled();
    expect(ingestConnectionEvent).not.toHaveBeenCalledWith(
      'tenant-1',
      'conn-1',
      expect.objectContaining({ eventType: 'error' })
    );
    await svc.stopWhatsAppQrBridge();
  });

  test('sendTextViaConnection nao reinitializa cliente no mesmo ciclo apos erro', async () => {
    process.env.WHATSAPP_QR_BRIDGE_TENANTS = 'tenant-1';
    process.env.WHATSAPP_QR_BRIDGE_SYNC_MS = '60000';

    const handlers3 = {};
    const firstClient = {
      on: jest.fn((event, cb) => { handlers3[event] = cb; }),
      initialize: jest.fn(async () => { if (handlers3.ready) await handlers3.ready(); }),
      destroy: jest.fn(async () => {}),
      sendMessage: jest.fn(async () => {
        throw new Error("Cannot read properties of undefined (reading 'getChat')");
      }),
    };
    const clientFactory = jest.fn()
      .mockImplementationOnce(() => firstClient);

    jest.doMock('whatsapp-web.js', () => ({
      Client: clientFactory,
      LocalAuth: jest.fn(() => ({})),
    }), { virtual: true });

    jest.doMock('../../api/services/tenantService', () => ({
      listTenants: jest.fn(async () => [{ tenant_key: 'tenant-1' }]),
    }));
    jest.doMock('../../api/services/whatsappQrService', () => ({
      listConnections: jest.fn(async () => ({
        ok: true,
        connections: [{ id: 'conn-1', provider: 'whatsapp-qr', status: 'connected' }],
      })),
      ingestConnectionEvent: jest.fn(async () => ({ ok: true })),
    }));

    const svc = require('../../api/services/whatsappQrBridgeService');
    const out = await svc.sendTextViaConnection({
      tenantId: 'tenant-1',
      connectionId: 'conn-1',
      to: '5511999999999',
      text: 'Teste',
    });

    expect(out).toEqual(expect.objectContaining({
      ok: false,
      error: 'qr_send_failed',
    }));
    expect(clientFactory).toHaveBeenCalledTimes(1);
    await svc.stopWhatsAppQrBridge();
  });

  test('processa inbound sem texto (midia) e cria ticket com placeholder', async () => {
    process.env.WHATSAPP_QR_BRIDGE_TENANTS = 'tenant-1';
    process.env.WHATSAPP_QR_BRIDGE_SYNC_MS = '60000';

    const handlers = {};
    const client = {
      on: jest.fn((event, cb) => { handlers[event] = cb; }),
      initialize: jest.fn(async () => { if (handlers.ready) await handlers.ready(); }),
      destroy: jest.fn(async () => {}),
      getChats: jest.fn(async () => []),
    };

    jest.doMock('whatsapp-web.js', () => ({
      Client: jest.fn(() => client),
      LocalAuth: jest.fn(() => ({})),
    }), { virtual: true });

    jest.doMock('../../api/services/tenantService', () => ({
      listTenants: jest.fn(async () => [{ tenant_key: 'tenant-1' }]),
    }));
    jest.doMock('../../api/services/whatsappQrService', () => ({
      listConnections: jest.fn(async () => ({
        ok: true,
        connections: [{ id: 'conn-1', provider: 'whatsapp-qr', status: 'connected' }],
      })),
      ingestConnectionEvent: jest.fn(async () => ({ ok: true })),
    }));

    const resolveOrCreateTicketFromIncomingMessage = jest.fn(async () => ({
      ok: true,
      ticket: { id: 't-1', tenantId: 'tenant-1', assignedTo: null },
    }));
    const appendTicketMessage = jest.fn(() => ({ id: 't-1', tenantId: 'tenant-1', assignedTo: null }));
    jest.doMock('../../api/services/conversationTicketLinkService', () => ({
      resolveOrCreateTicketFromIncomingMessage,
      appendTicketMessage,
    }));

    const emitEvent = jest.fn();
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent }));

    const svc = require('../../api/services/whatsappQrBridgeService');
    await svc.startWhatsAppQrBridge();

    expect(typeof handlers.message).toBe('function');
    await handlers.message({
      fromMe: false,
      from: '5511999999999@c.us',
      body: '',
      type: 'image',
      timestamp: 1774460000,
      id: { _serialized: 'wamid.abc' },
      _data: { notifyName: 'Cliente X' },
    });
    // O handler do pacote é síncrono (fire-and-forget): o processamento inbound
    // do adaptador continua em microtasks após o emit. Drena a fila antes de
    // afirmar (antes o await na promise do handler cobria a cadeia inteira).
    await new Promise((resolve) => setImmediate(resolve));

    expect(resolveOrCreateTicketFromIncomingMessage).toHaveBeenCalledWith(
      'tenant-1',
      'whatsapp',
      '5511999999999',
      expect.objectContaining({ phone: '5511999999999', name: 'Cliente X' })
    );
    expect(appendTicketMessage).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ direction: 'in', text: '[imagem]' })
    );
    expect(emitEvent).toHaveBeenCalledWith(
      'ticket.message.received',
      expect.objectContaining({ ticketId: 't-1', message: '[imagem]' }),
      expect.any(Object)
    );

    await svc.stopWhatsAppQrBridge();
  });
});
