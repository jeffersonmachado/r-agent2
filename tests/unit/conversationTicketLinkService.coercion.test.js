'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('conversationTicketLinkService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('normalizePhone não quebra com valor hostil', () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({
      ChannelConversation: jest.fn(),
      Ticket: jest.fn(),
    }));

    const { normalizePhone } = require('../../api/services/conversationTicketLinkService');
    const hostile = { toString() { throw new Error('boom-phone'); } };
    expect(() => normalizePhone(hostile)).not.toThrow();
    expect(normalizePhone(hostile)).toBeNull();
  });

  test('resolveOrCreateTicketFromIncomingMessage tolera contactId hostil (sem DB)', async () => {
    jest.doMock('../../api/utils/config', () => ({
      get: jest.fn((key, fallback) => {
        if (key === 'tickets.createOnInbound') return true;
        if (key === 'flows.defaultQueue') return 'default';
        return fallback;
      }),
    }));
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({
      ChannelConversation: jest.fn(),
      Ticket: jest.fn(),
    }));
    jest.doMock('../../api/services/planLimitsService', () => ({
      checkLimit: jest.fn(async () => ({ allowed: true, limit: 999, current: 1 })),
    }));

    const { resolveOrCreateTicketFromIncomingMessage } = require('../../api/services/conversationTicketLinkService');
    const hostileContact = { toString() { throw new Error('boom-contact'); } };

    await expect(resolveOrCreateTicketFromIncomingMessage(
      'tenant-1',
      'whatsapp',
      '5511999999999',
      { contactId: hostileContact, phone: '5511999999999' }
    )).resolves.toEqual(expect.objectContaining({
      createdTicket: expect.any(Boolean),
    }));
  });

  test('appendTicketMessage não quebra com text/externalMessageId/timestamp hostis', () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({
      ChannelConversation: jest.fn(),
      Ticket: jest.fn(),
    }));

    const queueService = require('../../api/services/queueService');
    const { appendTicketMessage } = require('../../api/services/conversationTicketLinkService');

    const ticket = queueService.createTicket({
      tenantId: 'tenant-1',
      sessionId: 'whatsapp_5511999999999',
      queue: 'default',
      context: { mode: 'bot' },
    });

    const hostile = { toString() { throw new Error('boom-msg'); } };
    expect(() => appendTicketMessage(ticket.id, {
      direction: 'in',
      text: hostile,
      externalMessageId: hostile,
      timestamp: hostile,
    })).not.toThrow();
  });

  test('não explode quando touchConversation recebe err.message hostil', () => {
    const hostileErr = {};
    Object.defineProperty(hostileErr, 'message', {
      get() { throw new Error('boom-touch-message'); },
      enumerable: true,
    });

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      ChannelConversation: jest.fn(() => ({
        update: jest.fn(async () => { throw hostileErr; }),
      })),
      Ticket: jest.fn(),
    }));

    const queueService = require('../../api/services/queueService');
    const { appendTicketMessage } = require('../../api/services/conversationTicketLinkService');

    const ticket = queueService.createTicket({
      tenantId: 'tenant-1',
      sessionId: 'whatsapp_5511999999999',
      queue: 'default',
      context: { mode: 'bot', conversationId: 'conv-1' },
    });

    expect(() => appendTicketMessage(ticket.id, {
      direction: 'in',
      text: 'oi',
      externalMessageId: 'x1',
      timestamp: new Date().toISOString(),
    })).not.toThrow();
  });
});
