'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('channelGatewayService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('normalizeIncoming(whatsapp) tolerates hostile from/messageId coercion', () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));
    jest.doMock('../../api/services/queueService', () => ({ getTicketBySession: jest.fn(() => null) }));
    jest.doMock('../../api/services/outboundQueueService', () => ({ enqueueOutbound: jest.fn() }));

    const { normalizeIncoming } = require('../../api/services/channelGatewayService');

    const payload = {
      message: {
        id: { toString: () => { throw new Error('boom-id'); } },
        from: { toString: () => { throw new Error('boom-from'); } },
        type: 'text',
        text: { body: 'Hello' },
      },
      value: { metadata: { phone_number_id: '12345' } },
    };

    const out = normalizeIncoming('whatsapp', payload);
    // When from/id throw, safeToString returns empty string, so externalId is empty (falsy check)
    expect(out.conversationKey.externalId).toBe('unknown');
    expect(out.message.externalMessageId).toBe('');
    expect(out.message.type).toBe('text');
  });

  test('normalizeIncoming(instagram) tolerates hostile senderId and mid coercion', () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));
    jest.doMock('../../api/services/queueService', () => ({ getTicketBySession: jest.fn(() => null) }));
    jest.doMock('../../api/services/outboundQueueService', () => ({ enqueueOutbound: jest.fn() }));

    const { normalizeIncoming } = require('../../api/services/channelGatewayService');

    const payload = {
      messaging: {
        sender: { id: { toString: () => { throw new Error('boom-sender'); } } },
        recipient: { id: { toString: () => { throw new Error('boom-recipient'); } } },
        message: {
          mid: { toString: () => { throw new Error('boom-mid'); } },
          text: 'IG message',
        },
      },
    };

    const out = normalizeIncoming('instagram', payload);
    // When senderId throws, safeToString returns empty string, so externalId is empty (treated as falsy -> 'unknown')
    expect(out.conversationKey.externalId).toBe('');
    expect(out.message.externalMessageId).toBe('');
    expect(out.message.body.text).toBe('IG message');
  });

  test('normalizeIncoming(messenger) tolerates hostile attachment type coercion', () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));
    jest.doMock('../../api/services/queueService', () => ({ getTicketBySession: jest.fn(() => null) }));
    jest.doMock('../../api/services/outboundQueueService', () => ({ enqueueOutbound: jest.fn() }));

    const { normalizeIncoming } = require('../../api/services/channelGatewayService');

    const payload = {
      messaging: {
        sender: { id: 'user-123' },
        recipient: { id: 'page-456' },
        message: {
          mid: 'msg-789',
          attachments: [
            {
              type: { toString: () => { throw new Error('boom-type'); } },
            },
          ],
        },
      },
    };

    const out = normalizeIncoming('messenger', payload);
    expect(out.conversationKey.externalId).toBe('user-123');
    // When attachment type throws, safeToString returns empty string (fallback)
    expect(out.message.type).toBe('');
    expect(out.message.body.attachments).toHaveLength(1);
  });
});
