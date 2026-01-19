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
});

