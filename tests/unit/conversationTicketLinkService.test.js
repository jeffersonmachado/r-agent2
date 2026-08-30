/**
 * Testes unitários do ConversationTicketLinkService (Fase 2)
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('conversationTicketLinkService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('appendTicketMessage é idempotente por externalMessageId (inbound)', () => {
    // eslint-disable-next-line global-require
    const queueService = require('../../api/services/queueService');
    // eslint-disable-next-line global-require
    const { appendTicketMessage } = require('../../api/services/conversationTicketLinkService');

    const t = queueService.createTicket({
      tenantId: 'tenant-1',
      sessionId: 'whatsapp_5511999999999',
      queue: 'suporte',
      lastUserMessage: null,
      context: { mode: 'human' },
    });

    appendTicketMessage(t.id, {
      direction: 'in',
      text: 'oi',
      externalMessageId: 'wamid.1',
      timestamp: new Date('2026-01-19T12:00:00.000Z').toISOString(),
    });

    appendTicketMessage(t.id, {
      direction: 'in',
      text: 'oi (dup)',
      externalMessageId: 'wamid.1',
      timestamp: new Date('2026-01-19T12:00:01.000Z').toISOString(),
    });

    const msgs = queueService.getTicketMessages(t.id) || [];
    const matches = msgs.filter((m) => m && m.externalMessageId === 'wamid.1');
    expect(matches.length).toBe(1);
    expect(queueService.getTicket(t.id).lastUserMessage).toBe('oi');
  });

  test('buildSessionId normaliza telefone local para DDI 55 (whatsapp)', () => {
    // eslint-disable-next-line global-require
    const { buildSessionId } = require('../../api/services/conversationTicketLinkService');

    const sessionId = buildSessionId({
      channelType: 'whatsapp',
      externalConversationId: '11988648492',
      contactPhone: '11988648492',
    });

    expect(sessionId).toBe('whatsapp_5511988648492');
  });

  test('caseManagement=false: inbound cria apenas conversa, sem ticket', async () => {
    const conversationUpdate = jest.fn(async () => {});
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      ChannelConversation: jest.fn(() => ({
        findOne: jest.fn(async () => null),
        create: jest.fn(async (data) => ({ ...data, update: conversationUpdate })),
        update: jest.fn(async () => [1]),
      })),
      Ticket: jest.fn(),
    }));
    jest.doMock('../../api/services/planLimitsService', () => ({
      checkLimit: jest.fn(async () => ({ allowed: true, limit: 999, current: 1 })),
    }));
    jest.doMock('../../api/services/tenantCapabilitiesService', () => ({
      getTenantCapabilities: jest.fn(async () => ({ inbox: true, caseManagement: false, caseCreationPolicy: 'manual' })),
    }));
    jest.doMock('../../api/utils/config', () => ({
      get: jest.fn((key, fallback) => {
        if (key === 'tickets.createOnInbound') return true;
        if (key === 'flows.defaultQueue') return 'default';
        return fallback;
      }),
    }));

    // eslint-disable-next-line global-require
    const { resolveOrCreateTicketFromIncomingMessage } = require('../../api/services/conversationTicketLinkService');

    const result = await resolveOrCreateTicketFromIncomingMessage(
      'tenant-gated',
      'whatsapp',
      '5511999999998',
      { phone: '5511999999998' }
    );

    expect(result.ticket).toBeNull();
    expect(result.createdTicket).toBe(false);
    expect(result.created).toBe(false);
    expect(result.conversation).toMatchObject({
      tenant_key: 'tenant-gated',
      channel_type: 'whatsapp',
      current_ticket_id: null,
    });
  });

  test('caseManagement=true (default): comportamento atual preservado (cria ticket)', async () => {
    const conversationUpdate = jest.fn(async () => {});
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      ChannelConversation: jest.fn(() => ({
        findOne: jest.fn(async () => null),
        create: jest.fn(async (data) => ({ ...data, update: conversationUpdate })),
        update: jest.fn(async () => [1]),
      })),
      Ticket: jest.fn(() => ({
        findOne: jest.fn(async () => null),
        sequelize: { constructor: { Op: { ne: Symbol.for('ne') } } },
      })),
    }));
    jest.doMock('../../api/services/planLimitsService', () => ({
      checkLimit: jest.fn(async () => ({ allowed: true, limit: 999, current: 1 })),
    }));
    jest.doMock('../../api/services/tenantCapabilitiesService', () => ({
      getTenantCapabilities: jest.fn(async () => ({ inbox: true, caseManagement: true, caseCreationPolicy: 'manual' })),
    }));
    jest.doMock('../../api/utils/config', () => ({
      get: jest.fn((key, fallback) => {
        if (key === 'tickets.createOnInbound') return true;
        if (key === 'flows.defaultQueue') return 'default';
        return fallback;
      }),
    }));

    // eslint-disable-next-line global-require
    const { resolveOrCreateTicketFromIncomingMessage } = require('../../api/services/conversationTicketLinkService');

    const result = await resolveOrCreateTicketFromIncomingMessage(
      'tenant-legacy',
      'whatsapp',
      '5511999999997',
      { phone: '5511999999997' }
    );

    expect(result.ticket).not.toBeNull();
    expect(result.createdTicket).toBe(true);
    expect(result.ticket.tenantId).toBe('tenant-legacy');
  });
});

