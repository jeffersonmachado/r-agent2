'use strict';

jest.mock('../../db/sequelize', () => ({
  getSequelize: jest.fn(() => null),
}));

const queueService = require('../queueService');

describe('queueService.createTicket with normalized context', () => {
  test('faz merge de tags explícitas com tags do normalized_context e preserva snapshot em metadata', () => {
    const ticket = queueService.createTicket({
      tenantId: 'tenant-q1',
      sessionId: 'whatsapp_5511999999999',
      queue: 'default',
      tags: ['topic:suporte', 'intent:support'],
      context: {
        normalized_context: {
          tenant_id: 'tenant-q1',
          session_id: 'whatsapp_5511999999999',
          tags: ['intent:support', 'severity:high', 'topic:billing'],
          entities: {
            email: { value: 'ana@example.com', source: 'regex', confidence: 0.9, updated_at: new Date().toISOString() },
          },
          funnel_state: { stage: 'support', intent: 'support', severity: 'high', next_action: 'handoff' },
        },
      },
    });

    expect(ticket.tenantId).toBe('tenant-q1');
    expect(ticket.tags).toEqual(expect.arrayContaining(['topic:suporte', 'intent:support', 'severity:high', 'topic:billing']));
    expect(ticket.context.metadata.normalized_context).toBeTruthy();
    expect(ticket.context.metadata.normalized_context.entities.email.value).toBe('ana@example.com');
  });
});
