'use strict';

jest.mock('../../db/sequelize', () => ({
  getSequelize: jest.fn(() => null),
}));

jest.mock('../../db/models', () => ({
  ChannelConversation: null,
  Ticket: null,
}));

jest.mock('../../context', () => ({
  getNormalizedContext: jest.fn(),
}));

jest.mock('../planLimitsService', () => ({
  checkLimit: jest.fn(async () => ({ allowed: true })),
}));

jest.mock('../../utils/config', () => ({
  get: jest.fn((key, fallback) => {
    if (key === 'tickets.createOnInbound') return true;
    if (key === 'flows.defaultQueue') return 'default';
    return fallback;
  }),
}));

jest.mock('../queueService', () => ({
  createTicket: jest.fn(() => ({ id: 'ticket-1', status: 'waiting' })),
  getTicketBySession: jest.fn(() => null),
  getTicketByConversationId: jest.fn(() => null),
  updateTicket: jest.fn((id, patch) => ({ id, ...patch })),
  getTicket: jest.fn(() => null),
  updateLastMessage: jest.fn(() => null),
}));

describe('conversationTicketLinkService with normalized context snapshot', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('injeta tags e normalized_context ao criar ticket inbound sem DB', async () => {
    const contextApi = require('../../context');
    const queueService = require('../queueService');
    const { resolveOrCreateTicketFromIncomingMessage } = require('../conversationTicketLinkService');

    contextApi.getNormalizedContext.mockResolvedValue({
      tenant_id: 'tenant-c1',
      session_id: 'whatsapp_5511999999999',
      tags: ['intent:support', 'severity:medium', 'topic:suporte'],
      entities: {
        order_id: { value: 'A-100', source: 'regex', confidence: 0.8, updated_at: new Date().toISOString() },
      },
      funnel_state: { stage: 'support', intent: 'support', severity: 'medium', next_action: 'educate' },
    });

    const out = await resolveOrCreateTicketFromIncomingMessage(
      'tenant-c1',
      'whatsapp',
      '5511999999999',
      { name: 'Ana' },
    );

    expect(out.createdTicket).toBe(true);
    expect(queueService.createTicket).toHaveBeenCalledTimes(1);

    const payload = queueService.createTicket.mock.calls[0][0];
    expect(payload.tenantId).toBe('tenant-c1');
    expect(payload.sessionId).toBe('whatsapp_5511999999999');
    expect(payload.tags).toEqual(expect.arrayContaining(['intent:support', 'severity:medium', 'topic:suporte']));
    expect(payload.context.normalized_context).toBeTruthy();
    expect(payload.context.metadata.normalized_context.entities.order_id.value).toBe('A-100');
  });
});
