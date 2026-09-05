'use strict';

/**
 * Enrichment do contrato da listagem do Inbox (contactName/phoneNumber/
 * lastMessage/unreadCount), filtro q e atividade inbound (unread + WS).
 */

const mockQuery = jest.fn();
const mockConversationFindAndCountAll = jest.fn();
const mockLinkFindAll = jest.fn();
const mockEntityFindAll = jest.fn();
const mockEmitEvent = jest.fn();

const OP = { in: 'IN', or: 'OR', iLike: 'ILIKE' };

// Nota: resetMocks global — factories usam funções estáveis que delegam aos
// mocks externos para sobreviver ao reset por teste.
jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => ({}),
}));

jest.mock('../../api/db/models', () => ({
  ChannelConversation: () => ({
    sequelize: { constructor: { Op: OP }, query: (...a) => mockQuery(...a) },
    findAndCountAll: (...a) => mockConversationFindAndCountAll(...a),
  }),
  ChannelMessage: () => ({}),
  Ticket: () => ({ findAll: async () => [] }),
  WorkspaceEntityLink: () => ({ findAll: (...a) => mockLinkFindAll(...a) }),
  WorkspaceEntity: () => ({ findAll: (...a) => mockEntityFindAll(...a) }),
}));

jest.mock('../../api/services/channelGatewayService', () => ({
  backfillPersistedMessageMedia: jest.fn(),
  resolveWhatsAppAccountForBackfill: jest.fn(),
}));

jest.mock('../../api/services/websocketService', () => ({
  emitEvent: (...a) => mockEmitEvent(...a),
}));

const {
  listConversations,
  registerInboundMessageActivity,
} = require('../../api/services/channelConversationService');

function makeConversationRow(overrides = {}) {
  return {
    id: 'conv-1',
    tenant_key: 'tenant-1',
    channel_type: 'whatsapp',
    external_id: '5511999999999',
    contact_id: '5511999999999',
    status: 'open',
    current_ticket_id: null,
    assigned_to: null,
    metadata: {},
    last_message_at: new Date('2026-09-05T10:00:00Z'),
    created_at: new Date('2026-09-05T09:00:00Z'),
    updated_at: new Date('2026-09-05T10:00:00Z'),
    ...overrides,
  };
}

describe('channelConversationService.listConversations — enrichment do contrato', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue([]);
    mockLinkFindAll.mockResolvedValue([]);
    mockEntityFindAll.mockResolvedValue([]);
  });

  test('itens carregam contactName (metadata), phoneNumber, lastMessage e unreadCount', async () => {
    mockConversationFindAndCountAll.mockResolvedValue({
      count: 1,
      rows: [makeConversationRow({
        metadata: { contactName: 'Maria Silva', unread: { count: 4 } },
      })],
    });
    mockQuery.mockResolvedValue([
      {
        conversation_id: 'conv-1',
        body: { text: 'quero agendar' },
        type: 'text',
        direction: 'in',
        created_at: new Date('2026-09-05T10:00:00Z'),
      },
    ]);

    const out = await listConversations({ tenantId: 'tenant-1' });

    expect(out.items).toHaveLength(1);
    const item = out.items[0];
    expect(item.contactName).toBe('Maria Silva');
    expect(item.phoneNumber).toBe('5511999999999');
    expect(item.unreadCount).toBe(4);
    expect(item.lastMessage).toEqual({
      text: 'quero agendar',
      type: 'text',
      direction: 'in',
      createdAt: '2026-09-05T10:00:00.000Z',
    });
  });

  test('contactName cai para WorkspaceEntity via link quando metadata não tem nome', async () => {
    mockConversationFindAndCountAll.mockResolvedValue({
      count: 1,
      rows: [makeConversationRow()],
    });
    mockLinkFindAll.mockResolvedValue([{ source_id: 'conv-1', entity_id: 'ent-1' }]);
    mockEntityFindAll.mockResolvedValue([{ id: 'ent-1', name: 'João Workspace' }]);

    const out = await listConversations({ tenantId: 'tenant-1' });

    expect(out.items[0].contactName).toBe('João Workspace');
    expect(mockLinkFindAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ source_type: 'conversation' }),
    }));
  });

  test('sem nome em metadata nem entidade → contactName null; canal não-whatsapp → phoneNumber null', async () => {
    mockConversationFindAndCountAll.mockResolvedValue({
      count: 1,
      rows: [makeConversationRow({ channel_type: 'instagram', external_id: 'ig-user-1', contact_id: 'ig-user-1' })],
    });

    const out = await listConversations({ tenantId: 'tenant-1' });

    expect(out.items[0].contactName).toBeNull();
    expect(out.items[0].phoneNumber).toBeNull();
    expect(out.items[0].lastMessage).toBeNull();
    expect(out.items[0].unreadCount).toBe(0);
  });

  test('q aplica OR iLike sanitizado sobre external_id, contact_id e nomes em metadata', async () => {
    mockConversationFindAndCountAll.mockResolvedValue({ count: 0, rows: [] });

    await listConversations({ tenantId: 'tenant-1', q: '50%_' });

    const where = mockConversationFindAndCountAll.mock.calls[0][0].where;
    expect(where[OP.or]).toEqual([
      { external_id: { [OP.iLike]: '%50\\%\\_%' } },
      { contact_id: { [OP.iLike]: '%50\\%\\_%' } },
      { 'metadata.contactName': { [OP.iLike]: '%50\\%\\_%' } },
      { 'metadata.senderName': { [OP.iLike]: '%50\\%\\_%' } },
    ]);
  });
});

describe('channelConversationService.registerInboundMessageActivity', () => {
  function makeConversationRowWithUpdate(metadata) {
    return {
      id: 'conv-1',
      tenant_key: 'tenant-1',
      metadata,
      update: jest.fn(async () => null),
    };
  }

  test('incrementa metadata.unread.count preservando outras chaves e emite WS', async () => {
    const row = makeConversationRowWithUpdate({ unread: { count: 2 }, origin: 'webhook' });
    jest.resetModules();
    jest.doMock('../../api/db/models', () => ({
      ChannelConversation: () => ({ findOne: async () => row }),
      ChannelMessage: () => ({}),
      Ticket: () => ({}),
    }));
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: () => ({}) }));
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent: (...a) => mockEmitEvent(...a) }));
    jest.doMock('../../api/services/channelGatewayService', () => ({
      backfillPersistedMessageMedia: jest.fn(),
      resolveWhatsAppAccountForBackfill: jest.fn(),
    }));
    // eslint-disable-next-line global-require
    const service = require('../../api/services/channelConversationService');

    await service.registerInboundMessageActivity({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      channelType: 'whatsapp',
      message: {
        id: 'msg-1',
        direction: 'in',
        type: 'text',
        body: { text: 'oi' },
        createdAt: '2026-09-05T10:00:00.000Z',
      },
    });

    expect(row.update).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        origin: 'webhook',
        unread: expect.objectContaining({ count: 3, lastInboundAt: expect.any(String) }),
      }),
    }));
    expect(mockEmitEvent).toHaveBeenCalledWith('conversation.message.received', expect.objectContaining({
      conversationId: 'conv-1',
      channelType: 'whatsapp',
      tenantId: 'tenant-1',
      message: expect.objectContaining({ id: 'msg-1', direction: 'in', type: 'text', text: 'oi' }),
    }), { tenantId: 'tenant-1' });
  });

  test('falha do WebSocket não quebra o fluxo (best-effort)', async () => {
    const row = makeConversationRowWithUpdate({});
    mockEmitEvent.mockImplementation(() => { throw new Error('ws down'); });
    jest.resetModules();
    jest.doMock('../../api/db/models', () => ({
      ChannelConversation: () => ({ findOne: async () => row }),
      ChannelMessage: () => ({}),
      Ticket: () => ({}),
    }));
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: () => ({}) }));
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent: (...a) => mockEmitEvent(...a) }));
    jest.doMock('../../api/services/channelGatewayService', () => ({
      backfillPersistedMessageMedia: jest.fn(),
      resolveWhatsAppAccountForBackfill: jest.fn(),
    }));
    // eslint-disable-next-line global-require
    const service = require('../../api/services/channelConversationService');

    await expect(service.registerInboundMessageActivity({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      channelType: 'whatsapp',
      message: { id: 'msg-2', direction: 'in', type: 'text', body: { text: 'oi' } },
    })).resolves.toBeUndefined();

    expect(row.update).toHaveBeenCalled();
    expect(mockEmitEvent).toHaveBeenCalled();
  });

  test('trunca texto da mensagem em 200 caracteres no payload do WS', async () => {
    mockEmitEvent.mockImplementation(() => 0);
    const longText = 'x'.repeat(500);
    await registerInboundMessageActivity({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      channelType: 'whatsapp',
      message: { id: 'msg-3', direction: 'in', type: 'text', body: { text: longText } },
    });

    const payload = mockEmitEvent.mock.calls[0][1];
    expect(payload.message.text).toHaveLength(200);
  });
});
